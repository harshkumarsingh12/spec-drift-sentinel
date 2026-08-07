import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NoProviderConfiguredError,
  createCompleter,
  isRetryable,
  providersFromEnv,
} from '../src/agent/provider.js';

/**
 * @covers AC-6
 *
 * These exist because the original client had no request timeout. A provider
 * that accepted the connection and then never answered blocked forever, so the
 * failover never ran — the exact failure we hit during setup, with nothing to
 * catch it. Two implementations of this client shipped without a single test
 * between them.
 */

describe('providersFromEnv', () => {
  test('returns nothing when no key is configured', () => {
    assert.deepEqual(providersFromEnv({}), []);
  });

  test('orders NVIDIA first, Groq as fallback', () => {
    const providers = providersFromEnv({ NVIDIA_API_KEY: 'n', GROQ_API_KEY: 'g' });
    assert.deepEqual(
      providers.map((p) => p.name),
      ['nvidia', 'groq'],
    );
  });

  test('works with only one provider configured', () => {
    assert.equal(providersFromEnv({ NVIDIA_API_KEY: 'n' }).length, 1);
    assert.equal(providersFromEnv({ GROQ_API_KEY: 'g' }).length, 1);
  });

  test('honours model and base-url overrides', () => {
    const [groq] = providersFromEnv({
      GROQ_API_KEY: 'g',
      GROQ_MODEL: 'custom-model',
      GROQ_BASE_URL: 'https://example.test/v1',
    });
    assert.equal(groq?.model, 'custom-model');
    assert.equal(groq?.baseUrl, 'https://example.test/v1');
  });
});

describe('isRetryable', () => {
  test('retries a timeout, which carries no status', () => {
    assert.equal(isRetryable(new Error('timed out')), true);
  });

  test('retries a rate limit', () => {
    assert.equal(isRetryable(Object.assign(new Error('429'), { status: 429 })), true);
  });

  test('retries a 401 — the next provider holds a different key', () => {
    assert.equal(isRetryable(Object.assign(new Error('401'), { status: 401 })), true);
  });

  test('retries a 404 — the next provider serves different models', () => {
    assert.equal(isRetryable(Object.assign(new Error('404'), { status: 404 })), true);
  });

  test('does not retry a 400 — our own malformed request', () => {
    assert.equal(isRetryable(Object.assign(new Error('400'), { status: 400 })), false);
  });
});

describe('createCompleter', () => {
  test('throws immediately when nothing is configured', () => {
    assert.throws(() => createCompleter([]), NoProviderConfiguredError);
  });

  test('names every provider that failed', async () => {
    const complete = createCompleter(
      [
        { name: 'alpha', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'm' },
        { name: 'beta', baseUrl: 'http://127.0.0.1:2', apiKey: 'k', model: 'm' },
      ],
      { timeoutMs: 100 },
    );

    await assert.rejects(complete([{ role: 'user', content: 'hi' }]), (error: Error) => {
      assert.match(error.message, /All providers failed/);
      assert.match(error.message, /alpha:/, 'the first failure should be named');
      assert.match(error.message, /beta:/, 'the second failure should be named');
      return true;
    });
  });

  test('a stalled provider times out instead of hanging forever', async () => {
    // 203.0.113.0/24 is TEST-NET-3: reserved and routable nowhere, so the
    // connection stalls rather than being refused — the real failure we hit.
    const complete = createCompleter(
      [{ name: 'stalled', baseUrl: 'http://203.0.113.1', apiKey: 'k', model: 'm' }],
      { timeoutMs: 300 },
    );

    const started = Date.now();
    await assert.rejects(complete([{ role: 'user', content: 'hi' }]), (error: Error) => {
      assert.match(error.message, /no response within 300ms/);
      return true;
    });

    assert.ok(Date.now() - started < 5_000, 'should give up quickly rather than hang');
  });

  test('falls through to the next provider when the first stalls', async () => {
    // Proves the timeout and the failover work together: without the timeout
    // the stalled provider would block and the second would never be tried.
    const complete = createCompleter(
      [
        { name: 'stalled', baseUrl: 'http://203.0.113.1', apiKey: 'k', model: 'm' },
        { name: 'refused', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'm' },
      ],
      { timeoutMs: 300 },
    );

    await assert.rejects(complete([{ role: 'user', content: 'hi' }]), (error: Error) => {
      assert.match(error.message, /stalled: no response within 300ms/);
      assert.match(error.message, /refused:/, 'the second provider must still be attempted');
      return true;
    });
  });
});
