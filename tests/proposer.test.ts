import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposal, propose } from '../src/agent/proposer.js';
import type { CompleteFn } from '../src/agent/provider.js';
import type { AcceptanceCriterion, Verdict } from '../src/types.js';

/**
 * @covers AC-2
 *
 * The proposer must be unreachable for regressions. If it can be talked into
 * drafting a "fix" for a genuine break, the whole guarantee collapses.
 */

const criterion: AcceptanceCriterion = {
  id: 'AC-2',
  title: 'Free shipping threshold is 500',
  text: 'Orders of 500 or more ship free.',
  sourceFile: 'spec/PRD.md',
  line: 10,
};

const base: Verdict = {
  id: 'v-1',
  acId: 'AC-2',
  kind: 'intentional_change',
  confidence: 0.9,
  reasoning: 'AC-2 raised the threshold.',
  failure: { testFile: 'a.spec.ts', testName: 'free shipping', message: 'expected 0' },
  proposedDiff: null,
  model: 'test-model',
  createdAt: '2026-08-08T00:00:00.000Z',
};

const stubComplete: CompleteFn = async () => ({
  content: '{"diff":"--- a\\n+++ b\\n","explanation":"threshold 300 → 500 per AC-2"}',
  model: 'test-model',
  provider: 'stub',
});

describe('parseProposal', () => {
  test('reads a diff and explanation', () => {
    const proposal = parseProposal('{"diff":"--- a","explanation":"why"}');
    assert.equal(proposal.diff, '--- a');
    assert.equal(proposal.explanation, 'why');
  });

  test('treats an empty diff as no proposal', () => {
    assert.equal(parseProposal('{"diff":"","explanation":"cannot honestly update"}').diff, null);
  });

  test('throws on a response with no JSON', () => {
    assert.throws(() => parseProposal('sorry, no'), /No JSON object found/);
  });
});

describe('propose', () => {
  test('attaches a diff for an authorised intentional change', async () => {
    const result = await propose(
      { verdict: base, criterion, testSource: 'test source' },
      stubComplete,
    );
    assert.equal(result.proposedDiff, '--- a\n+++ b\n');
    assert.match(result.reasoning, /threshold 300 → 500/);
  });

  test('refuses to propose anything for a regression', async () => {
    await assert.rejects(
      propose(
        { verdict: { ...base, kind: 'regression', acId: null }, criterion, testSource: '' },
        stubComplete,
      ),
      /Refusing to propose/,
    );
  });

  test('refuses when the verdict cites a different AC than the one supplied', async () => {
    await assert.rejects(
      propose({ verdict: { ...base, acId: 'AC-9' }, criterion, testSource: '' }, stubComplete),
      /but was given AC-2/,
    );
  });

  test('does not mutate the verdict it was given', async () => {
    await propose({ verdict: base, criterion, testSource: '' }, stubComplete);
    assert.equal(base.proposedDiff, null);
  });
});
