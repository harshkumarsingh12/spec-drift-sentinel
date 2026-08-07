/**
 * OpenAI-compatible chat client with automatic failover.
 *
 * Free tiers rate-limit aggressively during a hackathon. Rather than waiting out
 * a 429 we fall straight through to the next configured provider. Order is
 * deliberate: NVIDIA Build carries the bulk inference loop, Groq is the fast
 * fallback. Each team member supplies their own keys — free limits are per account.
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
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY,
      model: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
    });
  }

  if (env.GROQ_API_KEY) {
    providers.push({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    });
  }

  return providers;
}

/** True for errors worth retrying on a different provider. */
function isFailoverStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function callProvider(provider: Provider, messages: ChatMessage[]): Promise<CompletionResult> {
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
    }),
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
 * Try each provider in order, falling through on rate limits and server errors.
 * A malformed-request error is not retried — it would fail identically elsewhere.
 */
export function createCompleter(providers: Provider[]): CompleteFn {
  if (providers.length === 0) throw new NoProviderConfiguredError();

  return async (messages) => {
    let lastError: unknown;
    for (const provider of providers) {
      try {
        return await callProvider(provider, messages);
      } catch (error) {
        lastError = error;
        const status = (error as Error & { status?: number }).status;
        if (status !== undefined && !isFailoverStatus(status)) throw error;
      }
    }
    throw lastError instanceof Error
      ? new Error(`All providers failed. Last error: ${lastError.message}`)
      : new Error('All providers failed.');
  };
}
