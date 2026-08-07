import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendAuditLog,
  appendEntry,
  currentDecision,
  entryFromVerdict,
  hashDiff,
  historyFor,
  readAuditLogs,
  readEntries,
} from '../src/audit/log.js';
import type { Verdict } from '../src/types.js';

/** @covers AC-4 */

function logPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'sentinel-audit-')), 'nested', 'audit.jsonl');
}

const verdict: Verdict = {
  id: 'v-1',
  acId: 'AC-2',
  kind: 'intentional_change',
  confidence: 0.9,
  reasoning: 'AC-2 raised the free-shipping threshold.',
  failure: { testFile: 'a.spec.ts', testName: 'free shipping', message: 'expected 0' },
  proposedDiff: '--- a\n+++ b\n',
  model: 'test-model',
  createdAt: '2026-08-08T00:00:00.000Z',
};

describe('hashDiff', () => {
  test('is stable for the same input', () => {
    assert.equal(hashDiff('abc'), hashDiff('abc'));
  });

  test('differs for different input', () => {
    assert.notEqual(hashDiff('abc'), hashDiff('abd'));
  });

  test('passes null through, so regressions record no diff', () => {
    assert.equal(hashDiff(null), null);
  });
});

describe('append and read', () => {
  test('creates missing directories and round-trips an entry', () => {
    const path = logPath();
    appendEntry(entryFromVerdict(verdict), path);

    const entries = readEntries(path);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.verdictId, 'v-1');
    assert.equal(entries[0]?.humanDecision, 'pending');
    assert.equal(entries[0]?.proposedDiffHash, hashDiff(verdict.proposedDiff));
  });

  test('returns an empty list when the log does not exist yet', () => {
    assert.deepEqual(readEntries(join(tmpdir(), 'sentinel-does-not-exist', 'audit.jsonl')), []);
  });

  test('appends rather than overwrites, preserving history', () => {
    const path = logPath();
    appendEntry(entryFromVerdict(verdict), path);
    appendEntry(entryFromVerdict(verdict, 'approved', 'harsh'), path);

    const history = historyFor('v-1', path);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.humanDecision, 'pending');
    assert.equal(history[1]?.humanDecision, 'approved');
    assert.equal(history[1]?.decidedBy, 'harsh');
  });
});

describe('currentDecision', () => {
  test('defaults to pending for an unknown verdict', () => {
    assert.equal(currentDecision('nope', logPath()), 'pending');
  });

  test('reports the most recent decision', () => {
    const path = logPath();
    appendEntry(entryFromVerdict(verdict), path);
    appendEntry(entryFromVerdict(verdict, 'rejected', 'harsh'), path);
    assert.equal(currentDecision('v-1', path), 'rejected');
  });
});

describe('full verdict audit log', () => {
  test('round-trips a complete pending verdict', () => {
    const path = logPath();

    appendAuditLog(verdict, 'PENDING', path);

    const entries = readAuditLogs(path);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.id, 'v-1');
    assert.equal(entries[0]?.acId, 'AC-2');
    assert.equal(entries[0]?.failure.testName, 'free shipping');
    assert.equal(entries[0]?.human_decision, 'PENDING');
    assert.ok(entries[0]?.logged_at);
  });

  test('appends ratification rather than replacing the pending record', () => {
    const path = logPath();

    appendAuditLog(verdict, 'PENDING', path);
    appendAuditLog(verdict, 'RATIFIED', path);

    const entries = readAuditLogs(path);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.human_decision, 'PENDING');
    assert.equal(entries[1]?.human_decision, 'RATIFIED');
  });

  test('returns an empty list when the full audit log does not exist', () => {
    assert.deepEqual(
      readAuditLogs(join(tmpdir(), `sentinel-full-audit-missing-${Date.now()}`, 'audit.jsonl')),
      [],
    );
  });
});
