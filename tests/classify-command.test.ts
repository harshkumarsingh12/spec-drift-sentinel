import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatOutcome, runClassify, specWasChanged } from '../src/commands/classify.js';
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

/** A diff that touches the spec — required for an intentional change to stand. */
const SPEC_DIFF = [
  'diff --git a/spec/PRD.md b/spec/PRD.md',
  '--- a/spec/PRD.md',
  '+++ b/spec/PRD.md',
  '-Orders of 300 or more ship free.',
  '+Orders of 500 or more ship free.',
  'diff --git a/src/shipping.ts b/src/shipping.ts',
  '+ threshold = 500;',
].join('\n');

/** A diff that changes only code — nothing here authorises anything. */
const CODE_ONLY_DIFF = [
  'diff --git a/src/shipping.ts b/src/shipping.ts',
  '--- a/src/shipping.ts',
  '+++ b/src/shipping.ts',
  '- const FEE = 4.99;',
  '+ const FEE = 9.99;',
].join('\n');

const options = (root: string, propose = false, diff: string = SPEC_DIFF) => ({
  root,
  specFile: 'spec/PRD.md',
  diff,
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

describe('specWasChanged', () => {
  test('sees a spec change in the diff headers', () => {
    assert.equal(specWasChanged(SPEC_DIFF, 'spec/PRD.md'), true);
  });

  test('reports false for a code-only change', () => {
    assert.equal(specWasChanged(CODE_ONLY_DIFF, 'spec/PRD.md'), false);
  });

  test('ignores the spec merely being mentioned in a code line', () => {
    // A criterion quoted in a comment or fixture must not read as a spec change.
    const diff = [
      'diff --git a/src/thing.ts b/src/thing.ts',
      '+++ b/src/thing.ts',
      '+// see spec/PRD.md for the rule',
    ].join('\n');

    assert.equal(specWasChanged(diff, 'spec/PRD.md'), false);
  });

  test('tolerates windows-style separators', () => {
    assert.equal(specWasChanged('+++ b/spec\\PRD.md', 'spec/PRD.md'), true);
  });

  test('reports false for an empty diff', () => {
    assert.equal(specWasChanged('', 'spec/PRD.md'), false);
  });
});

describe('no spec change means no authorisation', () => {
  test('downgrades an intentional change when the spec was not touched', async () => {
    // Observed in rehearsal: the fee was changed with no spec change and the
    // classifier cited the very criterion that mandates the old value.
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, false, CODE_ONLY_DIFF),
      scriptedComplete(AUTHORISED),
    );

    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.acId, null);
    assert.match(verdict.reasoning, /does not touch spec\/PRD\.md/);
    assert.match(verdict.reasoning, /not the same as one that permits changing it/);
  });

  test('keeps the model reasoning visible after downgrading', async () => {
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, false, CODE_ONLY_DIFF),
      scriptedComplete(AUTHORISED),
    );

    assert.match(verdict.reasoning, /Model reasoning:/);
    assert.match(verdict.reasoning, /AC-2 raised it/);
  });

  test('proposes nothing once downgraded, even with --propose', async () => {
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, true, CODE_ONLY_DIFF),
      scriptedComplete(AUTHORISED, PROPOSAL),
    );

    assert.equal(verdict.proposedDiff, null);
  });

  test('allows an intentional change when the spec did move', async () => {
    const root = workspace();
    const { verdict } = await runClassify(
      options(root, false, SPEC_DIFF),
      scriptedComplete(AUTHORISED),
    );

    assert.equal(verdict.kind, 'intentional_change');
    assert.equal(verdict.acId, 'AC-2');
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
