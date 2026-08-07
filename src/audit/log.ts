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

export const DEFAULT_LOG_PATH = '.sentinel/audit.jsonl';
export const FULL_AUDIT_LOG_PATH = 'audit_log.jsonl';

export type AuditHumanDecision = 'PENDING' | 'RATIFIED' | 'REJECTED';

export interface AuditLogRecord extends Verdict {
  human_decision: AuditHumanDecision;
  logged_at: string;
}

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
    reasoning: verdict.reasoning,
    model: verdict.model,
    proposedDiffHash: hashDiff(verdict.proposedDiff),
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

/**
 * Append a complete Verdict snapshot to the Phase-4 audit log.
 *
 * This complements the compact AuditEntry log above rather than replacing it.
 * The optional log path follows the same pattern as the existing audit helpers
 * and keeps the function deterministic and testable.
 */
export function appendAuditLog(
  verdict: Verdict,
  humanDecision: AuditHumanDecision = 'PENDING',
  logPath: string = FULL_AUDIT_LOG_PATH,
): void {
  const record: AuditLogRecord = {
    ...verdict,
    human_decision: humanDecision,
    logged_at: new Date().toISOString(),
  };

  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

/** Read all complete Verdict snapshots from the Phase-4 audit log. */
export function readAuditLogs(logPath: string = FULL_AUDIT_LOG_PATH): AuditLogRecord[] {
  if (!existsSync(logPath)) return [];

  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditLogRecord);
}
