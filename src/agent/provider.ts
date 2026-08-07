/**
 * OpenAI-compatible chat client with automatic failover.
 *
 * One client for the whole agent layer. It replaces an earlier second
 * implementation (`client.ts`), folding in that version's two good ideas —
 * JSON response mode and environment-configurable base URLs — while keeping the
 * injectable `CompleteFn` shape the classifier and proposer are built and tested
 * against.
 *
 * Order is deliberate: NVIDIA Build carries the bulk inference loop, Groq is the
 * fast fallback. Each team member supplies their own keys — free limits are per
 * account, so four accounts is four times the capacity.
 *
 * Every request carries a timeout. Without one, a provider that accepts the
 * connection and then never responds blocks forever and the failover below never
 * runs — which is exactly what happened during setup, with NVIDIA reachable and
 * authenticated but silent while Groq answered in under half a second.
 */

export interface Provider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  provider: string;
}

/** Signature the agents depend on, so tests can inject a stub instead of a network call. */
export type CompleteFn = (messages: ChatMessage[]) => Promise<CompletionResult>;

export interface CompleterOptions {
  /** Per-request timeout. A stalled provider must not block the failover. */
  timeoutMs?: number;
  /**
   * Ask the provider to constrain output to a JSON object.
   *
   * Both agents parse structured JSON, so this is on by default — it turns a
   * whole class of "the model wrapped it in prose" failures into a non-issue.
   */
  json?: boolean;
}

export const REQUEST_TIMEOUT_MS = 60_000;

export class NoProviderConfiguredError extends Error {
  constructor() {
    super(
      'No LLM provider configured. Set NVIDIA_API_KEY or GROQ_API_KEY ' +
        '(see .env.example). Deterministic checks still run without one.',
    );
    this.name = 'NoProviderConfiguredError';
  }
}

/** Read providers from the environment, in failover order. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const providers: Provider[] = [];

  if (env.NVIDIA_API_KEY) {
    providers.push({
      name: 'nvidia',
      baseUrl: env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY,
      model: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
    });
  }

  if (env.GROQ_API_KEY) {
    providers.push({
      name: 'groq',
      baseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    });
  }

  return providers;
}

/**
 * Whether a failure is worth trying the next provider for.
 *
 * Almost everything is. Providers hold different keys and serve different
 * models, so a 401 or a 404 on one says nothing about the next. Only a 400 is
 * genuinely our own malformed request and will fail identically everywhere.
 *
 * A timeout or network error carries no status at all, and must be retryable —
 * a stalled primary is the single most likely failure during a hackathon.
 */
export function isRetryable(error: unknown): boolean {
  const status = (error as Error & { status?: number }).status;
  if (status === undefined) return true;
  return status !== 400;
}

/** Human-readable failure reason, with timeouts named rather than left cryptic. */
function describeFailure(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `no response within ${timeoutMs}ms`;
  }
  return error.message;
}

async function callProvider(
  provider: Provider,
  messages: ChatMessage[],
  options: Required<CompleterOptions>,
): Promise<CompletionResult> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.1,
      max_tokens: 1500,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    // Without this a stalled provider hangs forever and failover never fires.
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`${provider.name} returned ${response.status}: ${body.slice(0, 300)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`${provider.name} returned no message content`);
  }

  return { content, model: provider.model, provider: provider.name };
}

/**
 * Try each provider in turn, returning the first that answers.
 *
 * Failures are collected rather than swallowed: if every provider fails, the
 * thrown error names each one and why, so a stalled key is obvious instead of
 * hiding behind a generic message.
 */
export function createCompleter(providers: Provider[], options: CompleterOptions = {}): CompleteFn {
  if (providers.length === 0) throw new NoProviderConfiguredError();

  const resolved: Required<CompleterOptions> = {
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    json: options.json ?? true,
  };

  return async (messages) => {
    const failures: string[] = [];

    for (const provider of providers) {
      try {
        return await callProvider(provider, messages, resolved);
      } catch (error) {
        failures.push(`${provider.name}: ${describeFailure(error, resolved.timeoutMs)}`);
        if (!isRetryable(error)) break;
      }
    }

    throw new Error(`All providers failed.\n  ${failures.join('\n  ')}`);
  };
}
