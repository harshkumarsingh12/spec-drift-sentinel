import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { propose, proposePlaywrightDiff } from '../src/agent/proposer.js';
import type { CompleteFn } from '../src/agent/provider.js';
import type { AcceptanceCriterion, Verdict } from '../src/types.js';

/**
 * @covers AC-2
 *
 * The proposer must be unreachable for regressions, and a patch must always
 * carry the criterion that authorises it. If it can be talked into drafting a
 * "fix" for a genuine break, or into emitting an unattributed patch, the
 * product's central guarantee is worthless.
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
  failure: {
    testFile: 'tests/checkout.spec.ts',
    testName: 'free shipping',
    message: 'expected 0',
  },
  proposedDiff: null,
  model: 'test-model',
  createdAt: '2026-08-08T00:00:00.000Z',
};

const authorisedPatch = [
  '--- a/tests/checkout.spec.ts',
  '+++ b/tests/checkout.spec.ts',
  '@@',
  '+// Authorized by AC-2',
  '+test("free shipping", async ({ page }) => {',
  '+  await expect(page.getByTestId("shipping")).toHaveText("0");',
  '+});',
].join('\n');

function stub(payload: Record<string, unknown>): CompleteFn {
  return async () => ({
    content: JSON.stringify(payload),
    model: 'test-model',
    provider: 'stub',
  });
}

const stubComplete = stub({
  testFile: 'tests/checkout.spec.ts',
  patch: authorisedPatch,
  citingAc: 'AC-2',
  explanation: 'Raises the asserted threshold from 300 to 500 as AC-2 requires.',
});

describe('proposePlaywrightDiff', () => {
  test('returns an authorised Playwright patch', async () => {
    const result = await proposePlaywrightDiff(
      {
        acId: 'AC-2',
        acText: criterion.text,
        existingTestCode: 'test("free shipping", async ({ page }) => {});',
        gitDiff: '+ threshold = 500;',
        testFile: 'tests/checkout.spec.ts',
      },
      stubComplete,
    );

    assert.equal(result.testFile, 'tests/checkout.spec.ts');
    assert.equal(result.citingAc, 'AC-2');
    assert.match(result.patch, /\/\/ Authorized by AC-2/);
    assert.match(result.explanation, /threshold/);
  });

  test('rejects a proposal citing the wrong AC', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        {
          acId: 'AC-2',
          acText: criterion.text,
          existingTestCode: 'test("x", async () => {});',
          gitDiff: '',
        },
        stub({
          testFile: 'tests/checkout.spec.ts',
          patch: '// Authorized by AC-99\ntest("x", async () => {});',
          citingAc: 'AC-99',
        }),
      ),
      /expected AC-2/,
    );
  });

  test('rejects a non-empty patch without the mandatory AC comment', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        {
          acId: 'AC-2',
          acText: criterion.text,
          existingTestCode: 'test("x", async () => {});',
          gitDiff: '',
        },
        stub({
          testFile: 'tests/checkout.spec.ts',
          patch: 'test("x", async ({ page }) => { await expect(page).toBeTruthy(); });',
          citingAc: 'AC-2',
        }),
      ),
      /missing mandatory comment/,
    );
  });

  test('accepts an empty patch — the honest answer when nothing justifies a change', async () => {
    const result = await proposePlaywrightDiff(
      { acId: 'AC-2', acText: criterion.text, existingTestCode: '', gitDiff: '' },
      stub({
        testFile: 'tests/checkout.spec.ts',
        patch: '',
        citingAc: 'AC-2',
        explanation: 'The criterion does not describe the observed behaviour.',
      }),
    );

    assert.equal(result.patch, '');
    assert.match(result.explanation, /does not describe/);
  });

  test('rejects an invalid AC identifier', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        { acId: 'requirement-two', acText: criterion.text, existingTestCode: '', gitDiff: '' },
        stubComplete,
      ),
      /Invalid authorising Acceptance Criterion ID/,
    );
  });

  test('rejects an empty criterion — nothing to authorise against', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        { acId: 'AC-2', acText: '   ', existingTestCode: '', gitDiff: '' },
        stubComplete,
      ),
      /without text for AC-2/,
    );
  });

  test('throws when the response contains no JSON', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        { acId: 'AC-2', acText: criterion.text, existingTestCode: '', gitDiff: '' },
        async () => ({ content: 'sorry, no', model: 'm', provider: 'stub' }),
      ),
      /No JSON object found/,
    );
  });

  test('throws when testFile is missing', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        { acId: 'AC-2', acText: criterion.text, existingTestCode: '', gitDiff: '' },
        stub({ patch: '', citingAc: 'AC-2' }),
      ),
      /did not include testFile/,
    );
  });
});

describe('propose', () => {
  test('attaches a diff for an authorised intentional change', async () => {
    const result = await propose(
      {
        verdict: base,
        criterion,
        testSource: 'test("free shipping", async ({ page }) => {});',
        gitDiff: '+ threshold = 500;',
      },
      stubComplete,
    );

    assert.equal(result.proposedDiff, authorisedPatch);
  });

  test("carries the model's explanation through to the reviewer", async () => {
    const result = await propose({ verdict: base, criterion, testSource: '' }, stubComplete);

    assert.match(result.reasoning, /authorised by AC-2/);
    // The reviewer needs the "why", not just the diff.
    assert.match(result.reasoning, /Raises the asserted threshold from 300 to 500/);
  });

  test('records no diff when the model honestly declines to propose one', async () => {
    const result = await propose(
      { verdict: base, criterion, testSource: '' },
      stub({
        testFile: 'tests/checkout.spec.ts',
        patch: '',
        citingAc: 'AC-2',
        explanation: 'Nothing in AC-2 justifies this change.',
      }),
    );

    assert.equal(result.proposedDiff, null);
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
