/**
 * Verifies each configured LLM provider actually responds.
 *
 * Run this after filling in .env, and again on the morning of the build — a key
 * that silently stopped working is much cheaper to find now than mid-demo.
 *
 *   npm run check:providers
 *
 * Never prints key material. Reports only whether each provider answered.
 */

const PROVIDERS = [
  {
    name: 'NVIDIA Build',
    keyVar: 'NVIDIA_API_KEY',
    modelVar: 'NVIDIA_MODEL',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    name: 'Groq',
    keyVar: 'GROQ_API_KEY',
    modelVar: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
];

/** Show enough of a key to identify it, never enough to use it. */
function fingerprint(key) {
  return key.length <= 10 ? '(too short)' : `${key.slice(0, 6)}…${key.slice(-4)}`;
}

async function check({ name, keyVar, modelVar, defaultModel, baseUrl }) {
  const key = process.env[keyVar];
  const model = process.env[modelVar] ?? defaultModel;

  if (!key || key.startsWith('nvapi-...') || key.startsWith('gsk_...')) {
    console.log(`  SKIP  ${name} — ${keyVar} not set (still the placeholder?)`);
    return null;
  }

  process.stdout.write(`  ....  ${name} [${fingerprint(key)}] model=${model}`);

  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const elapsed = Date.now() - started;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      process.stdout.write('\r');
      console.log(`  FAIL  ${name} — HTTP ${response.status} (${elapsed}ms)`);
      if (response.status === 401) console.log('        Key rejected. Regenerate it.');
      else if (response.status === 404) console.log(`        Model "${model}" not found. Check the provider's current catalogue and update ${modelVar}.`);
      else if (response.status === 429) console.log('        Rate limited. The key works, but quota is exhausted right now.');
      else console.log(`        ${body.slice(0, 200)}`);
      return false;
    }

    const payload = await response.json();
    const reply = payload.choices?.[0]?.message?.content?.trim() ?? '(empty)';
    process.stdout.write('\r');
    console.log(`  OK    ${name} — replied in ${elapsed}ms: "${reply.slice(0, 40)}"`);
    return true;
  } catch (error) {
    process.stdout.write('\r');
    console.log(`  FAIL  ${name} — ${error.name === 'TimeoutError' ? 'timed out' : error.message}`);
    return false;
  }
}

console.log('\nChecking LLM providers...\n');

const results = [];
for (const provider of PROVIDERS) results.push(await check(provider));

const working = results.filter((r) => r === true).length;
const failed = results.filter((r) => r === false).length;

console.log(`\n${working} working, ${failed} failed, ${results.filter((r) => r === null).length} not configured\n`);

if (working === 0) {
  console.log('No provider is answering. Classification and proposals will not run.');
  console.log('The deterministic commands (arch, trace, audit) still work — see AC-6.\n');
  process.exitCode = 1;
} else if (working === 1) {
  console.log('Only one provider is working. Configure the other so a 429 does not stall you.\n');
}
