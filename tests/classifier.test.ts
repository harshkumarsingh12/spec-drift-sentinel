import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, normaliseVerdict, buildMessages } from '../src/agent/classifier.js';
import type { TestFailure } from '../src/types.js';

/**
 * @covers AC-1
 * @covers AC-2
 *
 * These guard the load-bearing safety property: a model cannot get a test
 * rewritten unless it cites an acceptance criterion that actually exists.
 */

const failure: TestFailure = {
  testFile: 'tests/checkout.spec.ts',
  testName: 'applies free shipping over the threshold',
  message: 'expected 0 but received 4.99',
};

const validIds = new Set(['AC-1', 'AC-2']);

describe('extractJson', () => {
  test('parses a bare JSON object', () => {
    const parsed = extractJson('{"kind":"regression"}') as { kind: string };
    assert.equal(parsed.kind, 'regression');
  });

  test('parses JSON inside a fenced block', () => {
    const parsed = extractJson('```json\n{"kind":"regression"}\n```') as { kind: string };
    assert.equal(parsed.kind, 'regression');
  });

  test('parses JSON padded with prose', () => {
    const parsed = extractJson('Here is my answer:\n{"kind":"regression"}\nHope that helps.') as {
      kind: string;
    };
    assert.equal(parsed.kind, 'regression');
  });

  test('throws when there is no object at all', () => {
    assert.throws(() => extractJson('I could not decide.'), /No JSON object found/);
  });
});

describe('normaliseVerdict', () => {
  test('accepts an intentional change that cites a real AC', () => {
    const verdict = normaliseVerdict(
      { kind: 'intentional_change', acId: 'AC-2', confidence: 0.9, reasoning: 'AC-2 raised it.' },
      failure,
      'test-model',
      validIds,
    );
    assert.equal(verdict.kind, 'intentional_change');
    assert.equal(verdict.acId, 'AC-2');
  });

  test('downgrades an intentional change that cites no AC', () => {
    const verdict = normaliseVerdict(
      { kind: 'intentional_change', acId: null, confidence: 0.95, reasoning: 'Looks deliberate.' },
      failure,
      'test-model',
      validIds,
    );
    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.acId, null);
    assert.match(verdict.reasoning, /cited no valid/);
  });

  test('downgrades an intentional change citing an AC that does not exist', () => {
    const verdict = normaliseVerdict(
      { kind: 'intentional_change', acId: 'AC-99', confidence: 1, reasoning: 'AC-99 allows it.' },
      failure,
      'test-model',
      validIds,
    );
    assert.equal(verdict.kind, 'regression', 'a hallucinated AC must not authorise anything');
    assert.equal(verdict.acId, null);
  });

  test('treats an unrecognised kind as a regression', () => {
    const verdict = normaliseVerdict({ kind: 'probably_fine' }, failure, 'test-model', validIds);
    assert.equal(verdict.kind, 'regression');
  });

  test('treats an empty response as a regression', () => {
    const verdict = normaliseVerdict({}, failure, 'test-model', validIds);
    assert.equal(verdict.kind, 'regression');
    assert.equal(verdict.confidence, 0);
  });

  test('clamps an out-of-range confidence to zero', () => {
    const verdict = normaliseVerdict(
      { kind: 'regression', confidence: 42 },
      failure,
      'test-model',
      validIds,
    );
    assert.equal(verdict.confidence, 0);
  });

  test('never attaches a proposed diff at classification time', () => {
    const verdict = normaliseVerdict(
      { kind: 'intentional_change', acId: 'AC-1', confidence: 0.8, reasoning: 'ok' },
      failure,
      'test-model',
      validIds,
    );
    assert.equal(verdict.proposedDiff, null);
  });
});

describe('buildMessages', () => {
  test('states the no-criteria case explicitly rather than sending an empty section', () => {
    const [, user] = buildMessages({ failure, criteria: [], diff: 'x' });
    assert.match(user?.content ?? '', /no acceptance criteria are in scope/);
  });

  test('includes the failure message so the model can reason about it', () => {
    const [, user] = buildMessages({ failure, criteria: [], diff: 'x' });
    assert.match(user?.content ?? '', /expected 0 but received 4\.99/);
  });
});
