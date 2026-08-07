import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify, classifyDrift, parseTestFailure } from '../src/agent/classifier.js';
import type { CompleteFn } from '../src/agent/provider.js';
import type { TestFailure } from '../src/types.js';

/**
 * @covers AC-1
 * @covers AC-6
 *
 * Covers the parts of the classifier added alongside `classifyDrift`: the
 * fail-safe path when a model returns garbage, and the parsing of real
 * Playwright output. Both feed the audit log, so getting them wrong is not
 * cosmetic — a fabricated test name is a lie recorded permanently.
 */

const PLAYWRIGHT_LOG = `
  1) [chromium] › e2e/checkout.spec.ts:18:7 › checkout › applies free shipping over the threshold

    Error: expect(received).toHaveText(expected)

    Expected string: "0.00"
    Received string: "4.99"
`;

const PRD = `# Spec

### AC-1: Free shipping threshold is 500
Orders of 500 or more ship free.

### AC-2: Expired codes are rejected
An expired discount code must not alter the total.
`;

function stub(content: string): CompleteFn {
  return async () => ({ content, model: 'test-model', provider: 'stub' });
}

describe('parseTestFailure', () => {
  test('extracts the real file and test name from Playwright output', () => {
    const failure = parseTestFailure(PLAYWRIGHT_LOG);
    assert.equal(failure.testFile, 'e2e/checkout.spec.ts');
    assert.equal(failure.testName, 'applies free shipping over the threshold');
  });

  test('takes the last segment as the test name, not the suite', () => {
    const failure = parseTestFailure(
      '1) [chromium] › tests/a.spec.ts:1:1 › outer › inner › the actual test',
    );
    assert.equal(failure.testName, 'the actual test');
  });

  test('extracts the assertion message', () => {
    assert.match(parseTestFailure(PLAYWRIGHT_LOG).message, /expect\(received\)\.toHaveText/);
  });

  test('works without the index and browser prefix', () => {
    const failure = parseTestFailure('tests/login.spec.ts:4:2 › login › rejects a bad password');
    assert.equal(failure.testFile, 'tests/login.spec.ts');
    assert.equal(failure.testName, 'rejects a bad password');
  });

  test('says so plainly when the log cannot be parsed', () => {
    // Inventing a plausible file name here would put a fabricated value in the
    // audit log, which is worse than admitting we do not know.
    const failure = parseTestFailure('something went wrong somewhere');
    assert.equal(failure.testFile, '(unparsed)');
    assert.equal(failure.testName, '(unparsed)');
    assert.match(failure.message, /something went wrong/);
  });
});

describe('classify — fail-safe behaviour', () => {
  const failure: TestFailure = {
    testFile: 'a.spec.ts',
    testName: 'does a thing',
    message: 'boom',
  };

  test('a malformed response becomes a regression rather than throwing', async () => {
    const verdict = await classify(
      { failure, criteria: [], diff: '' },
      stub('the model rambled and produced no JSON at all'),
    );

    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.confidence, 0);
    assert.match(verdict.reasoning, /Fail-safe regression/);
  });

  test('a fail-safe verdict never carries a proposed diff', async () => {
    const verdict = await classify({ failure, criteria: [], diff: '' }, stub('garbage'));
    assert.equal(verdict.proposedDiff, null);
    assert.equal(verdict.acId, null);
  });

  test('truncated JSON also fails safe', async () => {
    const verdict = await classify(
      { failure, criteria: [], diff: '' },
      stub('{"kind":"intentional_change","acId":"AC-1"'),
    );
    assert.equal(verdict.kind, 'regression');
  });
});

describe('classifyDrift', () => {
  test('parses criteria out of raw PRD content', async () => {
    const verdict = await classifyDrift(
      {
        prdContent: PRD,
        gitDiff: 'diff --git a/x b/x',
        testFailureLog: PLAYWRIGHT_LOG,
      },
      stub('{"kind":"intentional_change","acId":"AC-1","confidence":0.9,"reasoning":"AC-1 allows it."}'),
    );

    assert.equal(verdict.kind, 'intentional_change');
    assert.equal(verdict.acId, 'AC-1');
  });

  test('carries the real failure through to the verdict', async () => {
    const verdict = await classifyDrift(
      { prdContent: PRD, gitDiff: '', testFailureLog: PLAYWRIGHT_LOG },
      stub('{"kind":"regression","confidence":0.8,"reasoning":"broken"}'),
    );

    assert.equal(verdict.failure.testFile, 'e2e/checkout.spec.ts');
    assert.equal(verdict.failure.testName, 'applies free shipping over the threshold');
  });

  test('rejects a citation that is not in the supplied PRD', async () => {
    const verdict = await classifyDrift(
      { prdContent: PRD, gitDiff: '', testFailureLog: PLAYWRIGHT_LOG },
      stub('{"kind":"intentional_change","acId":"AC-99","confidence":1,"reasoning":"AC-99 allows it."}'),
    );

    assert.equal(verdict.kind, 'regression', 'a hallucinated AC must not authorise anything');
    assert.equal(verdict.acId, null);
  });

  test('an empty PRD authorises nothing', async () => {
    const verdict = await classifyDrift(
      { prdContent: '# No criteria here', gitDiff: '', testFailureLog: PLAYWRIGHT_LOG },
      stub('{"kind":"intentional_change","acId":"AC-1","confidence":0.9,"reasoning":"sure"}'),
    );

    assert.equal(verdict.kind, 'regression');
  });
});
