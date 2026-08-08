import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { AuditEntry, HumanDecision, Verdict } from '../types.js';

/**
 * Append-only decision log, one JSON object per line.
 *
 * Deliberately a flat file, not a database. Every automated decision and every
 * human ratification lands here so a judge can reconstruct exactly what happened
 * and who signed off. Keep it that way — this is a log, not a subsystem.
 */

/*
 * There is exactly one audit log, and this is its path.
 *
 * A second log (audit_log.jsonl, holding full Verdict snapshots with
 * PENDING/RATIFIED/REJECTED) was briefly added alongside this one. Two
 * append-only logs with different shapes and two vocabularies for the same
 * decision makes AC-4 unanswerable: a reviewer asking "where is the record?"
 * would get two answers, one of which nothing ever wrote to.
 */
export const DEFAULT_LOG_PATH = '.sentinel/audit.jsonl';

/** Short, stable fingerprint of a proposed diff. */
export function hashDiff(diff: string | null): string | null {
  if (diff === null) return null;
  return createHash('sha256').update(diff).digest('hex').slice(0, 12);
}

export function entryFromVerdict(
  verdict: Verdict,
  humanDecision: HumanDecision = 'pending',
  decidedBy: string | null = null,
): AuditEntry {
  return {
    verdictId: verdict.id,
    acId: verdict.acId,
    kind: verdict.kind,
    confidence: verdict.confidence,
    reasoning: verdict.reasoning,
    failure: verdict.failure,
    model: verdict.model,
    proposedDiffHash: hashDiff(verdict.proposedDiff),
    proposedDiff: verdict.proposedDiff,
    humanDecision,
    decidedBy,
    timestamp: new Date().toISOString(),
  };
}

export function appendEntry(entry: AuditEntry, logPath: string = DEFAULT_LOG_PATH): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readEntries(logPath: string = DEFAULT_LOG_PATH): AuditEntry[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}

/**
 * Full history for one verdict, oldest first.
 * A verdict typically appears twice: once pending, once ratified.
 */
export function historyFor(verdictId: string, logPath: string = DEFAULT_LOG_PATH): AuditEntry[] {
  return readEntries(logPath).filter((e) => e.verdictId === verdictId);
}

/** The latest human decision recorded for a verdict. */
export function currentDecision(
  verdictId: string,
  logPath: string = DEFAULT_LOG_PATH,
): HumanDecision {
  const history = historyFor(verdictId, logPath);
  const last = history[history.length - 1];
  return last?.humanDecision ?? 'pending';
}

