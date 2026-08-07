import OpenAI from 'openai';

const NVIDIA_BASE_URL =
  process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

const PRIMARY_MODEL =
  process.env.PRIMARY_MODEL || 'meta/llama-3.3-70b-instruct';
const FALLBACK_MODEL =
  process.env.FALLBACK_MODEL || 'llama-3.3-70b-versatile';

const nvidiaClient = new OpenAI({
  baseURL: NVIDIA_BASE_URL,
  apiKey: process.env.NVIDIA_API_KEY,
});

const groqClient = new OpenAI({
  baseURL: GROQ_BASE_URL,
  apiKey: process.env.GROQ_API_KEY,
});

export interface PromptExecutionResult {
  content: string;
  modelUsed: string;
}

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

function isRateLimitError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error).toLowerCase();

  return status === 429 || message.includes('rate');
}

async function executeWithClient(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<PromptExecutionResult> {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error(
      `LLM provider returned an empty response for model "${model}".`,
    );
  }

  return {
    content,
    modelUsed: model,
  };
}

export async function executePromptWithFallback(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; modelUsed: string }> {
  try {
    return await executeWithClient(
      nvidiaClient,
      PRIMARY_MODEL,
      systemPrompt,
      userPrompt,
    );
  } catch (primaryError: unknown) {
    if (!isRateLimitError(primaryError)) {
      throw new Error(
        `NVIDIA Build request failed without a rate-limit condition: ${getErrorMessage(primaryError)}`,
        { cause: primaryError },
      );
    }

    console.warn(
      `[Spec Drift Sentinel] NVIDIA Build rate limit detected. Falling back to Groq (${FALLBACK_MODEL}).`,
    );

    try {
      return await executeWithClient(
        groqClient,
        FALLBACK_MODEL,
        systemPrompt,
        userPrompt,
      );
    } catch (fallbackError: unknown) {
      throw new Error(
        `Groq fallback request failed after NVIDIA Build was rate-limited: ${getErrorMessage(fallbackError)}`,
        { cause: fallbackError },
      );
    }
  }
}