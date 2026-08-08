import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AcceptanceCriterion, TraceabilityRow } from '../types.js';
import { collectSourceFiles } from './architecture.js';

/**
 * Builds the acceptance-criterion → code → test map.
 *
 * Acceptance criteria are declared in spec/PRD.md as headings of the form:
 *
 *   ### AC-3: Refunds under the auto-approve limit skip human review
 *   The system must ...
 *
 * They may also be declared as bullet points:
 *
 *   - AC-3: Refunds under the auto-approve limit skip human review
 *
 * Code and tests claim coverage with a `@covers` annotation naming the
 * criterion id, e.g. `AC-3`, in a comment. That annotation is the only link
 * between spec and implementation, which keeps the mapping explicit and
 * greppable rather than inferred.
 */

const AC_HEADING = /^#{2,4}\s*(AC-\d+)\s*[::-]?\s*(.*)$/;
const AC_BULLET = /^\s*[-*+]\s+(AC-\d+)\s*[::-]?\s*(.*)$/;
const COVERS_ANNOTATION = /@covers\s+(AC-\d+)/g;

/**
 * The comment text of a source file — `//` line comments and `/* … *\/`
 * block comments (including `/**` JSDoc) — with string and template literal
 * contents stripped out.
 *
 * `coveredIds` scans only this, not the raw source, so a `@covers AC-n`
 * mentioned inside a test fixture string is not mistaken for a real
 * annotation. Not a full parser — deliberately so: it tracks only quote and
 * comment delimiters, which is enough to get comments-vs-strings right
 * without a language toolchain dependency. It does not special-case regex
 * literals; none of this codebase's regexes contain a `//` or `/*` run, so
 * plain `/` characters inside them fall through as ordinary code untouched.
 */
export function extractComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += source.slice(i, stop) + '\n';
      i = stop;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop) + '\n';
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    i++;
  }

  return out;
}

/**
 * Parse acceptance criteria out of PRD markdown already in memory.
 *
 * This is the single implementation. Callers holding a path use
 * `parseAcceptanceCriteria`; callers holding raw content (the classifier, which
 * receives PRD text rather than reading the disk) use this directly. Two copies
 * of this parser would drift, and the AC id is the thing the whole product
 * hinges on.
 */
export function parseAcceptanceCriteriaFromText(
  content: string,
  sourceFile: string,
): AcceptanceCriterion[] {
  const lines = content.split('\n');
  const criteria: AcceptanceCriterion[] = [];

  lines.forEach((line, index) => {
    const headingMatch = AC_HEADING.exec(line);
    const bulletMatch = AC_BULLET.exec(line);
    const match = headingMatch ?? bulletMatch;

    if (!match?.[1]) return;

    const body: string[] = [];

    if (headingMatch) {
      // Heading bodies run until the next heading or explicit AC bullet.
      for (let i = index + 1; i < lines.length; i++) {
        const next = lines[i] ?? '';
        if (next.startsWith('#') || AC_BULLET.test(next)) break;
        body.push(next);
      }
    }

    criteria.push({
      id: match[1],
      title: (match[2] ?? '').trim(),
      text: headingMatch ? body.join('\n').trim() : (match[2] ?? '').trim(),
      sourceFile,
      line: index + 1,
    });
  });

  return criteria;
}

/** Parse acceptance criteria out of a PRD markdown file. */
export function parseAcceptanceCriteria(prdPath: string): AcceptanceCriterion[] {
  return parseAcceptanceCriteriaFromText(readFileSync(prdPath, 'utf8'), prdPath);
}

/** Every `@covers AC-n` annotation found in a file's comments — not its strings. */
export function coveredIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of extractComments(source).matchAll(COVERS_ANNOTATION)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

function isTestFile(path: string): boolean {
  return /(^|\/)tests?\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/**
 * Cross-reference criteria against the tree.
 *
 * - `covered`  — at least one test file claims it
 * - `untested` — code claims it but no test does
 * - `orphaned` — nothing claims it at all
 */
export function buildTraceability(root: string, criteria: AcceptanceCriterion[]): TraceabilityRow[] {
  const coverage = new Map<string, { code: string[]; tests: string[] }>();
  for (const ac of criteria) coverage.set(ac.id, { code: [], tests: [] });

  for (const file of collectSourceFiles(root)) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const id of coveredIds(source)) {
      const bucket = coverage.get(id);
      if (!bucket) continue;
      if (isTestFile(file)) bucket.tests.push(file);
      else bucket.code.push(file);
    }
  }

  return criteria.map((ac) => {
    const bucket = coverage.get(ac.id) ?? { code: [], tests: [] };
    const status: TraceabilityRow['status'] =
      bucket.tests.length > 0
        ? 'covered'
        : bucket.code.length > 0
          ? 'untested'
          : 'orphaned';
    return {
      acId: ac.id,
      title: ac.title,
      coveredBy: bucket.code,
      testFiles: bucket.tests,
      status,
    };
  });
}

const DIFF_NEW_FILE = /^\+\+\+ b\/(.+)$/;
const DIFF_OLD_FILE = /^--- a\/(.+)$/;

/**
 * Repo-relative paths touched by a unified diff, deduplicated.
 *
 * Reads `+++ b/…` and `--- a/…` headers rather than `diff --git` lines, so it
 * also catches the pre-image side of a rename or delete. `/dev/null` (an
 * added or deleted file's missing side) never matches, since it carries no
 * `a/`/`b/` prefix.
 */
export function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();

  for (const line of diff.split('\n')) {
    const added = DIFF_NEW_FILE.exec(line);
    if (added?.[1]) {
      files.add(added[1].split('\\').join('/'));
      continue;
    }
    const removed = DIFF_OLD_FILE.exec(line);
    if (removed?.[1]) {
      files.add(removed[1].split('\\').join('/'));
    }
  }

  return [...files];
}

/** Criteria plausibly affected by a set of changed files. */
export function affectedCriteria(
  changedFiles: string[],
  rows: TraceabilityRow[],
): TraceabilityRow[] {
  const changed = new Set(changedFiles.map((f) => f.split('\\').join('/')));
  return rows.filter(
    (row) =>
      row.coveredBy.some((f) => changed.has(f)) || row.testFiles.some((f) => changed.has(f)),
  );
}

/*
 * `parseTraceabilityMap` was removed here.
 *
 * It mapped every acceptance criterion to the same two hardcoded paths
 * regardless of content, and neither path existed in the repository. That is
 * not traceability, it is a constant — and a tool whose entire purpose is
 * detecting drift between spec and code cannot ship a function that fabricates
 * its own coverage.
 *
 * `buildTraceability` above does the real thing: it scans for `@covers`
 * annotations and reports honestly when a criterion is orphaned.
 */
