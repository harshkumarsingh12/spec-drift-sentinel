import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseProposal,
  propose,
  proposePlaywrightDiff,
} from '../src/agent/proposer.js';
import type { CompleteFn } from '../src/agent/provider.js';
import type {
  AcceptanceCriterion,
  Verdict,
} from '../src/types.js';

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

const stubComplete: CompleteFn = async () => ({
  content: JSON.stringify({
    test_file: 'tests/checkout.spec.ts',
    patch: authorisedPatch,
    citing_ac: 'AC-2',
  }),
  model: 'test-model',
  provider: 'stub',
});

describe('parseProposal', () => {
  test('reads a diff and explanation', () => {
    const proposal = parseProposal(
      '{"diff":"--- a","explanation":"why"}',
    );

    assert.equal(proposal.diff, '--- a');
    assert.equal(proposal.explanation, 'why');
  });

  test('treats an empty diff as no proposal', () => {
    assert.equal(
      parseProposal(
        '{"diff":"","explanation":"cannot honestly update"}',
      ).diff,
      null,
    );
  });

  test('throws on a response with no JSON', () => {
    assert.throws(
      () => parseProposal('sorry, no'),
      /No JSON object found/,
    );
  });
});

describe('proposePlaywrightDiff', () => {
  test('returns an authorised Playwright patch', async () => {
    const result = await proposePlaywrightDiff(
      {
        acId: 'AC-2',
        acText: 'Orders of 500 or more ship free.',
        existingTestCode:
          'test("free shipping", async ({ page }) => {});',
        gitDiff: '+ threshold = 500;',
        testFile: 'tests/checkout.spec.ts',
      },
      stubComplete,
    );

    assert.equal(
      result.test_file,
      'tests/checkout.spec.ts',
    );

    assert.equal(result.citing_ac, 'AC-2');

    assert.match(
      result.patch,
      /\/\/ Authorized by AC-2/,
    );
  });

  test('rejects a proposal citing the wrong AC', async () => {
    const complete: CompleteFn = async () => ({
      content: JSON.stringify({
        test_file: 'tests/checkout.spec.ts',
        patch:
          '// Authorized by AC-99\n' +
          'test("x", async () => {});',
        citing_ac: 'AC-99',
      }),
      model: 'test-model',
      provider: 'stub',
    });

    await assert.rejects(
      proposePlaywrightDiff(
        {
          acId: 'AC-2',
          acText: criterion.text,
          existingTestCode: 'test("x", async () => {});',
          gitDiff: '',
          testFile: 'tests/checkout.spec.ts',
        },
        complete,
      ),
      /expected AC-2/,
    );
  });

  test('rejects a non-empty patch without the mandatory AC comment', async () => {
    const complete: CompleteFn = async () => ({
      content: JSON.stringify({
        test_file: 'tests/checkout.spec.ts',
        patch:
          'test("x", async ({ page }) => {' +
          ' await expect(page).toBeTruthy(); });',
        citing_ac: 'AC-2',
      }),
      model: 'test-model',
      provider: 'stub',
    });

    await assert.rejects(
      proposePlaywrightDiff(
        {
          acId: 'AC-2',
          acText: criterion.text,
          existingTestCode: 'test("x", async () => {});',
          gitDiff: '',
          testFile: 'tests/checkout.spec.ts',
        },
        complete,
      ),
      /missing mandatory comment/,
    );
  });

  test('rejects an invalid AC identifier', async () => {
    await assert.rejects(
      proposePlaywrightDiff(
        {
          acId: 'requirement-two',
          acText: criterion.text,
          existingTestCode: '',
          gitDiff: '',
          testFile: 'tests/checkout.spec.ts',
        },
        stubComplete,
      ),
      /Invalid authorising Acceptance Criterion ID/,
    );
  });
});

describe('propose', () => {
  test('attaches a diff for an authorised intentional change', async () => {
    const result = await propose(
      {
        verdict: base,
        criterion,
        testSource:
          'test("free shipping", async ({ page }) => {});',
        gitDiff: '+ threshold = 500;',
      },
      stubComplete,
    );

    assert.equal(
      result.proposedDiff,
      authorisedPatch,
    );

    assert.match(
      result.reasoning,
      /authorised by AC-2/,
    );
  });

  test('refuses to propose anything for a regression', async () => {
    await assert.rejects(
      propose(
        {
          verdict: {
            ...base,
            kind: 'regression',
            acId: null,
          },
          criterion,
          testSource: '',
        },
        stubComplete,
      ),
      /Refusing to propose/,
    );
  });

  test('refuses when the verdict cites a different AC than the one supplied', async () => {
    await assert.rejects(
      propose(
        {
          verdict: {
            ...base,
            acId: 'AC-9',
          },
          criterion,
          testSource: '',
        },
        stubComplete,
      ),
      /but was given AC-2/,
    );
  });

  test('does not mutate the verdict it was given', async () => {
    await propose(
      {
        verdict: base,
        criterion,
        testSource: '',
      },
      stubComplete,
    );

    assert.equal(base.proposedDiff, null);
  });
});
