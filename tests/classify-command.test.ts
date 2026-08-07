import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatOutcome, runClassify } from '../src/commands/classify.js';
import { readEntries } from '../src/audit/log.js';
import type { CompleteFn } from '../src/agent/provider.js';

/**
 * @covers AC-1
 * @covers AC-2
 * @covers AC-4
 * @covers AC-5
 *
 * End-to-end coverage of the pipeline the CLI now exposes: classify, optionally
 * propose, record. The load-bearing assertions are that a regression never
 * receives a proposed fix, and that nothing is ever written to a test file —
 * only recorded for a human to ratify.
 */

const PRD = `# Spec

### AC-2: Free shipping threshold is 500
Orders of 500 or more ship free.
`;

const FAILURE_LOG = `
  1) [chromium] › tests/checkout.spec.ts:18:7 › checkout › applies free shipping

    Error: expect(received).toHaveText(expected)
`;

const PATCH = ['--- a/tests/checkout.spec.ts', '+++ b', '@@', '+// Authorized by AC-2'].join('\n');

/** Answers the classifier first, then the proposer. */
function scriptedComplete(...responses: string[]): CompleteFn {
  let call = 0;
  return async () => ({
    content: responses[Math.min(call++, responses.length - 1)] ?? '',
    model: 'test-model',
    provider: 'stub',
  });
}

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-classify-'));
  mkdirSync(join(root, 'spec'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'spec', 'PRD.md'), PRD);
  writeFileSync(join(root, 'tests', 'checkout.spec.ts'), 'test("applies free shipping", () => {});');
  return root;
}

const options = (root: string, propose = false) => ({
  root,
  specFile: 'spec/PRD.md',
  diff: '+ threshold = 500;',
  failureLog: FAILURE_LOG,
  propose,
  auditLogPath: '.sentinel/audit.jsonl',
});

const REGRESSION = '{"kind":"regression","confidence":0.9,"reasoning":"Nothing authorises this."}';
const AUTHORISED =
  '{"kind":"intentional_change","acId":"AC-2","confidence":0.9,"reasoning":"AC-2 raised it."}';
const PROPOSAL = JSON.stringify({
  testFile: 'tests/checkout.spec.ts',
  patch: PATCH,
  citingAc: 'AC-2',
  explanation: 'Raises the asserted threshold to 500.',
});

describe('runClassify', () => {
  test('classifies a regression and records it', async () => {
    const root = workspace();
    const { verdict } = await runClassify(options(root), scriptedComplete(REGRESSION));

    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.proposedDiff, null);

    const entries = readEntries(join(root, '.sentinel', 'audit.jsonl'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.kind, 'regression');
    assert.equal(entries[0]?.humanDecision, 'pending');
  });

  test('never proposes a fix for a regression, even when asked to', async () => {
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, true),
      scriptedComplete(REGRESSION, PROPOSAL),
    );

    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.proposedDiff, null, 'a regression must never carry a proposed fix');
  });

  test('proposes an update for an authorised change', async () => {
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, true),
      scriptedComplete(AUTHORISED, PROPOSAL),
    );

    assert.equal(verdict.kind, 'intentional_change');
    assert.equal(verdict.acId, 'AC-2');
    assert.match(verdict.proposedDiff ?? '', /Authorized by AC-2/);
  });

  test('does not propose unless asked', async () => {
    const root = workspace();
    const { verdict } = await runClassify(options(root), scriptedComplete(AUTHORISED));
    assert.equal(verdict.proposedDiff, null);
  });

  test('leaves the test file untouched', async () => {
    const root = workspace();
    const before = readEntries(join(root, '.sentinel', 'audit.jsonl'));
    await runClassify(options(root, true), scriptedComplete(AUTHORISED, PROPOSAL));

    const source = readFileSync(join(root, 'tests', 'checkout.spec.ts'), 'utf8');
    assert.equal(source, 'test("applies free shipping", () => {});');
    assert.equal(before.length, 0);
  });

  test('records the verdict even when the proposal fails', async () => {
    const root = workspace();
    const { verdict, proposalSkipped } = await runClassify(
      options(root, true),
      scriptedComplete(AUTHORISED, 'not json at all'),
    );

    assert.equal(verdict.kind, 'intentional_change');
    assert.ok(proposalSkipped, 'the failure should be reported');
    assert.equal(readEntries(join(root, '.sentinel', 'audit.jsonl')).length, 1);
  });

  test('skips the proposal when the test file cannot be read', async () => {
    const root = workspace();
    const { proposalSkipped } = await runClassify(
      { ...options(root, true), failureLog: 'no parseable playwright header here' },
      scriptedComplete(AUTHORISED, PROPOSAL),
    );

    assert.match(proposalSkipped ?? '', /could not read test file/);
  });

  test('throws a clear error when the spec is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sentinel-nospec-'));
    await assert.rejects(
      runClassify(options(root), scriptedComplete(REGRESSION)),
      /Spec file not found/,
    );
  });
});

describe('formatOutcome', () => {
  test('tells the reader to fix the code on a regression', async () => {
    const root = workspace();
    const outcome = await runClassify(options(root), scriptedComplete(REGRESSION));
    const text = formatOutcome(outcome);

    assert.match(text, /No acceptance criterion authorises this change/);
    assert.match(text, /Fix the code/);
  });

  test('states plainly that a proposal is not applied', async () => {
    const root = workspace();
    const outcome = await runClassify(
      options(root, true),
      scriptedComplete(AUTHORISED, PROPOSAL),
    );

    assert.match(formatOutcome(outcome), /NOT applied, awaiting human ratification/);
  });
});
