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
 * Code and tests claim coverage with a `@covers AC-3` annotation in a comment.
 * That annotation is the only link between spec and implementation, which keeps
 * the mapping explicit and greppable rather than inferred.
 */

const AC_HEADING = /^#{2,4}\s*(AC-\d+)\s*[::-]?\s*(.*)$/;
const COVERS_ANNOTATION = /@covers\s+(AC-\d+)/g;

/** Parse acceptance criteria out of a PRD markdown file. */
export function parseAcceptanceCriteria(prdPath: string): AcceptanceCriterion[] {
  const lines = readFileSync(prdPath, 'utf8').split('\n');
  const criteria: AcceptanceCriterion[] = [];

  lines.forEach((line, index) => {
    const match = AC_HEADING.exec(line);
    if (!match?.[1]) return;

    // Body runs until the next heading of any level.
    const body: string[] = [];
    for (let i = index + 1; i < lines.length; i++) {
      const next = lines[i] ?? '';
      if (next.startsWith('#')) break;
      body.push(next);
    }

    criteria.push({
      id: match[1],
      title: (match[2] ?? '').trim(),
      text: body.join('\n').trim(),
      sourceFile: prdPath,
      line: index + 1,
    });
  });

  return criteria;
}

/** Every `@covers AC-n` annotation found in a file. */
export function coveredIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(COVERS_ANNOTATION)) {
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
