#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Seeds `.sentinel/audit.jsonl` with real backend output for local dev and for
 * Playwright, which needs deterministic content on a clean clone with no
 * network access or API keys.
 *
 * This runs the actual compiled backend pipeline — `runClassify`, the real
 * spec parser, the real audit-log writer — the same code path `sentinel
 * classify` uses. Only the model call is stubbed, exactly like
 * `tests/classify-command.test.ts` does, so the run is deterministic. The
 * live model integration is real and demoed separately; see README's
 * "Demo script" for running it against NVIDIA/Groq for real.
 *
 * Run automatically before Playwright's dev server starts (see
 * playwright.config.ts) and manually with `npm run seed`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

if (!existsSync(join(REPO_ROOT, 'dist', 'src', 'commands', 'classify.js'))) {
  console.error('dist/ not found — build the root package first: npm run build (from the repo root).');
  process.exit(1);
}

const { runClassify } = await import(
  pathToFileURL(join(REPO_ROOT, 'dist', 'src', 'commands', 'classify.js')).href
);
const { appendEntry, entryFromVerdict } = await import(
  pathToFileURL(join(REPO_ROOT, 'dist', 'src', 'audit', 'log.js')).href
);

const AUDIT_LOG_PATH = '.sentinel/audit.jsonl';
const absoluteLogPath = resolve(REPO_ROOT, AUDIT_LOG_PATH);

// Start clean so re-seeding (every Playwright run) is idempotent.
rmSync(absoluteLogPath, { force: true });
mkdirSync(dirname(absoluteLogPath), { recursive: true });

/** Queues canned model replies; each runClassify call consumes one or two. */
function scripted(...replies) {
  let index = 0;
  return async () => {
    const content = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return { content, model: 'llama-3.3-70b-versatile', provider: 'seed-fixture' };
  };
}

const REGRESSION_DIFF = [
  'diff --git a/fixture-app/server.mjs b/fixture-app/server.mjs',
  '--- a/fixture-app/server.mjs',
  '+++ b/fixture-app/server.mjs',
  '@@',
  '-const STANDARD_SHIPPING_FEE = 4.99;',
  '+const STANDARD_SHIPPING_FEE = 9.99;',
].join('\n');

const REGRESSION_FAILURE = [
  '1) [chromium] › fixture-app/e2e/fixture.spec.ts:16:7 › cart API › charges the flat fee below the threshold',
  '',
  '  Error: expect(received).toEqual(expected)',
  '',
  '  Expected: {"subtotal": 400, "shippingFee": 4.99, "total": 404.99}',
  '  Received: {"subtotal": 400, "shippingFee": 9.99, "total": 409.99}',
].join('\n');

const THRESHOLD_DIFF = [
  'diff --git a/spec/PRD.md b/spec/PRD.md',
  '--- a/spec/PRD.md',
  '+++ b/spec/PRD.md',
  '@@ AC-7 @@',
  '-An order with a subtotal below 500 is charged a shipping fee of 4.99.',
  '+An order with a subtotal below 300 is charged a shipping fee of 4.99.',
  '@@ AC-8 @@',
  '-An order with a subtotal of 500 or more is charged a shipping fee of 0.00.',
  '+An order with a subtotal of 300 or more is charged a shipping fee of 0.00.',
  'diff --git a/fixture-app/server.mjs b/fixture-app/server.mjs',
  '--- a/fixture-app/server.mjs',
  '+++ b/fixture-app/server.mjs',
  '@@',
  '-const FREE_SHIPPING_THRESHOLD = 500;',
  '+const FREE_SHIPPING_THRESHOLD = 300;',
].join('\n');

const THRESHOLD_FAILURE = [
  '2) [chromium] › fixture-app/e2e/fixture.spec.ts:16:7 › cart API › charges the flat fee below the threshold',
  '',
  '  Error: expect(received).toEqual(expected)',
  '',
  '  Expected: {"subtotal": 400, "shippingFee": 4.99, "total": 404.99}',
  '  Received: {"subtotal": 400, "shippingFee": 0, "total": 400}',
].join('\n');

const FORMATTING_DIFF = [
  'diff --git a/spec/PRD.md b/spec/PRD.md',
  '--- a/spec/PRD.md',
  '+++ b/spec/PRD.md',
  '@@ AC-9 @@',
  '-decimal places, so a zero fee reads `0.00` rather than `0`.',
  '+decimal places, except a zero fee, which reads `0` for a cleaner cart screen.',
  'diff --git a/fixture-app/public/index.html b/fixture-app/public/index.html',
  '--- a/fixture-app/public/index.html',
  '+++ b/fixture-app/public/index.html',
  '@@',
  "-shippingFeeEl.textContent = fee.toFixed(2);",
  "+shippingFeeEl.textContent = fee === 0 ? '0' : fee.toFixed(2);",
].join('\n');

const FORMATTING_FAILURE = [
  '3) [chromium] › fixture-app/e2e/fixture.spec.ts:61:7 › cart screen › shows a free fee as 0.00, not 0',
  '',
  '  Error: expect(locator).toHaveText(expected)',
  '',
  '  Expected string: "0.00"',
  '  Received string: "0"',
].join('\n');

const options = (diff, failureLog, propose) => ({
  root: REPO_ROOT,
  specFile: 'spec/PRD.md',
  diff,
  failureLog,
  propose,
  auditLogPath: AUDIT_LOG_PATH,
});

const REGRESSION_REPLY = JSON.stringify({
  kind: 'regression',
  acId: null,
  confidence: 0.95,
  reasoning:
    'No acceptance criterion authorises raising the shipping fee. AC-7 fixes it at 4.99, ' +
    'and this diff only touches fixture-app/server.mjs — the specification did not move.',
});

const THRESHOLD_REPLY = JSON.stringify({
  kind: 'intentional_change',
  acId: 'AC-8',
  confidence: 0.93,
  reasoning:
    'AC-7 and AC-8 both moved the free-shipping threshold from 500 to 300. The test still ' +
    'asserts the old threshold at a subtotal of 400, which now ships free under the updated criterion.',
});

const THRESHOLD_PROPOSAL = JSON.stringify({
  testFile: 'fixture-app/e2e/fixture.spec.ts',
  patch: [
    '--- a/fixture-app/e2e/fixture.spec.ts',
    '+++ b/fixture-app/e2e/fixture.spec.ts',
    '@@ -14,7 +14,8 @@',
    "   test('charges the flat fee below the threshold', async ({ request }) => {",
    "     const res = await request.get('/api/cart?subtotal=400');",
    '     expect(res.status()).toBe(200);',
    '',
    '-    expect(await res.json()).toEqual({ subtotal: 400, shippingFee: 4.99, total: 404.99 });',
    '+    // Authorized by AC-8',
    '+    expect(await res.json()).toEqual({ subtotal: 400, shippingFee: 0, total: 400 });',
    '   });',
  ].join('\n'),
  citingAc: 'AC-8',
  explanation: 'AC-8 lowered the free-shipping threshold to 300, so a 400 subtotal now ships free.',
});

const FORMATTING_REPLY = JSON.stringify({
  kind: 'intentional_change',
  acId: 'AC-9',
  confidence: 0.42,
  reasoning:
    'AC-9 requires exactly two decimal places, and the diff appears to special-case a zero fee. ' +
    'It is not clear whether that reads as a formatting improvement or a violation of "0.00 rather ' +
    'than 0" — a human should confirm the intent before this is treated as authorised.',
});

const FORMATTING_PROPOSAL = JSON.stringify({
  testFile: 'fixture-app/e2e/fixture.spec.ts',
  patch: [
    '--- a/fixture-app/e2e/fixture.spec.ts',
    '+++ b/fixture-app/e2e/fixture.spec.ts',
    '@@ -64,7 +64,8 @@',
    "     await page.getByTestId('quote-button').click();",
    '',
    '-    // Authorized by AC-9',
    "-    await expect(page.getByTestId('shipping-fee')).toHaveText('0.00');",
    '+    // Authorized by AC-9',
    "+    await expect(page.getByTestId('shipping-fee')).toHaveText('0');",
    "     await expect(page.getByTestId('total')).toHaveText('500.00');",
  ].join('\n'),
  citingAc: 'AC-9',
  explanation: 'Tentatively updated to match a zero fee rendering as "0" — needs human confirmation.',
});

console.log('Seeding .sentinel/audit.jsonl through the real classify pipeline (scripted model, no network)...');

const { verdict: regression } = await runClassify(
  options(REGRESSION_DIFF, REGRESSION_FAILURE, true),
  scripted(REGRESSION_REPLY),
);
console.log(`  regression        ${regression.id}`);

const { verdict: threshold } = await runClassify(
  options(THRESHOLD_DIFF, THRESHOLD_FAILURE, true),
  scripted(THRESHOLD_REPLY, THRESHOLD_PROPOSAL),
);
console.log(`  intentional_change ${threshold.id}  (pending — this is the diff-viewer headline case)`);

const { verdict: lowConfidence } = await runClassify(
  options(FORMATTING_DIFF, FORMATTING_FAILURE, true),
  scripted(FORMATTING_REPLY, FORMATTING_PROPOSAL),
);
console.log(`  intentional_change ${lowConfidence.id}  (pending — low confidence)`);

// A verdict a reviewer already ratified in an earlier session: classify once
// (pending), then append the human decision the same way the dashboard does.
const { verdict: alreadyApproved } = await runClassify(
  options(THRESHOLD_DIFF, THRESHOLD_FAILURE, true),
  scripted(THRESHOLD_REPLY, THRESHOLD_PROPOSAL),
);
appendEntry(entryFromVerdict(alreadyApproved, 'approved', 'demo-reviewer'), absoluteLogPath);
console.log(`  intentional_change ${alreadyApproved.id}  (approved)`);

const { verdict: alreadyRejected } = await runClassify(
  options(FORMATTING_DIFF, FORMATTING_FAILURE, true),
  scripted(FORMATTING_REPLY, FORMATTING_PROPOSAL),
);
appendEntry(entryFromVerdict(alreadyRejected, 'rejected', 'demo-reviewer'), absoluteLogPath);
console.log(`  intentional_change ${alreadyRejected.id}  (rejected)`);

console.log('Done.');
