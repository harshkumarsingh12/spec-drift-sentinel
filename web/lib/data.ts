import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { AcceptanceCriterion, AuditEntry, TraceabilityRow, Verdict } from './types';

/**
 * Real data access for the dashboard.
 *
 * No mocks, no database. `.sentinel/audit.jsonl` and `spec/PRD.md` are the same
 * files the CLI reads and writes — this module reads them directly in server
 * components, exactly as WEB.md's "wiring to real data" section describes.
 *
 * The parsing here (spec headings, `@covers` scanning) intentionally mirrors
 * `src/analyzers/traceability.ts`. It is duplicated rather than imported
 * because `web/` is a separate npm package — the same documented trade-off as
 * `lib/types.ts` mirroring `src/types.ts`. Keep the two in sync.
 */

/** Repo root, one level up from the Next.js app's cwd. */
const REPO_ROOT = resolve(process.cwd(), '..');

const AUDIT_LOG_PATH = join(REPO_ROOT, '.sentinel', 'audit.jsonl');
const SPEC_PATH = join(REPO_ROOT, 'spec', 'PRD.md');

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** Every row ever appended, oldest first. Malformed lines are skipped, not fatal. */
export function readAuditLog(): AuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return [];

  return readFileSync(AUDIT_LOG_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        return [];
      }
    });
}

/**
 * The latest row per verdict, in first-seen order.
 *
 * A verdict typically appears twice — once when classified (pending), once
 * when a human ratifies it — so "latest" is what is currently true about it.
 */
function latestByVerdict(entries: AuditEntry[]): AuditEntry[] {
  const order: string[] = [];
  const latest = new Map<string, AuditEntry>();

  for (const entry of entries) {
    if (!latest.has(entry.verdictId)) order.push(entry.verdictId);
    latest.set(entry.verdictId, entry);
  }

  return order.map((id) => latest.get(id)!);
}

function toVerdict(entry: AuditEntry): Verdict {
  return {
    id: entry.verdictId,
    acId: entry.acId,
    kind: entry.kind,
    confidence: entry.confidence,
    reasoning: entry.reasoning,
    failure: entry.failure,
    proposedDiff: entry.proposedDiff,
    model: entry.model,
    createdAt: entry.timestamp,
  };
}

/** Every verdict currently awaiting a human decision. */
export function getPendingVerdicts(): Verdict[] {
  return latestByVerdict(readAuditLog())
    .filter((entry) => entry.humanDecision === 'pending')
    .map(toVerdict);
}

/** The latest raw row for a verdict, humanDecision and all — used by the decision API. */
export function findLatestEntry(verdictId: string): AuditEntry | undefined {
  return latestByVerdict(readAuditLog()).find((e) => e.verdictId === verdictId);
}

/** A verdict by id, whatever its current state — used by the diff viewer. */
export function findVerdict(verdictId: string): Verdict | undefined {
  const entry = findLatestEntry(verdictId);
  return entry ? toVerdict(entry) : undefined;
}

/** The full decision history, oldest first — every classification and ratification. */
export function getAuditLog(): AuditEntry[] {
  return readAuditLog();
}

// ---------------------------------------------------------------------------
// Acceptance criteria (spec/PRD.md)
// ---------------------------------------------------------------------------

const AC_HEADING = /^#{2,4}\s*(AC-\d+)\s*[::-]?\s*(.*)$/;
const AC_BULLET = /^\s*[-*+]\s+(AC-\d+)\s*[::-]?\s*(.*)$/;

function parseAcceptanceCriteriaFromText(content: string, sourceFile: string): AcceptanceCriterion[] {
  const lines = content.split('\n');
  const criteria: AcceptanceCriterion[] = [];

  lines.forEach((line, index) => {
    const headingMatch = AC_HEADING.exec(line);
    const bulletMatch = AC_BULLET.exec(line);
    const match = headingMatch ?? bulletMatch;

    if (!match?.[1]) return;

    const body: string[] = [];

    if (headingMatch) {
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

/** Every acceptance criterion currently declared in spec/PRD.md. */
export function getCriteria(): AcceptanceCriterion[] {
  if (!existsSync(SPEC_PATH)) return [];
  return parseAcceptanceCriteriaFromText(readFileSync(SPEC_PATH, 'utf8'), 'spec/PRD.md');
}

export function findCriterion(id: string | null): AcceptanceCriterion | undefined {
  if (id === null) return undefined;
  return getCriteria().find((criterion) => criterion.id === id);
}

// ---------------------------------------------------------------------------
// Traceability (scans the tree for @covers annotations)
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  'build',
  'coverage',
  '.sentinel',
  'playwright-report',
  'test-results',
]);
const COVERS_ANNOTATION = /@covers\s+(AC-\d+)/g;

function collectSourceFiles(root: string, dir: string = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(root, full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(relative(root, full).split('\\').join('/'));
    }
  }
  return found;
}

function isTestFile(path: string): boolean {
  return /(^|\/)tests?\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** Every acceptance criterion cross-referenced against what claims to cover it. */
export function getTraceability(): TraceabilityRow[] {
  const criteria = getCriteria();
  const coverage = new Map<string, { code: string[]; tests: string[] }>();
  for (const ac of criteria) coverage.set(ac.id, { code: [], tests: [] });

  for (const file of collectSourceFiles(REPO_ROOT)) {
    const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    const ids = new Set<string>();
    for (const match of source.matchAll(COVERS_ANNOTATION)) {
      if (match[1]) ids.add(match[1]);
    }
    for (const id of ids) {
      const bucket = coverage.get(id);
      if (!bucket) continue;
      if (isTestFile(file)) bucket.tests.push(file);
      else bucket.code.push(file);
    }
  }

  return criteria.map((ac) => {
    const bucket = coverage.get(ac.id) ?? { code: [], tests: [] };
    const status: TraceabilityRow['status'] =
      bucket.tests.length > 0 ? 'covered' : bucket.code.length > 0 ? 'untested' : 'orphaned';
    return {
      acId: ac.id,
      title: ac.title,
      coveredBy: bucket.code,
      testFiles: bucket.tests,
      status,
    };
  });
}
