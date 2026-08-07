import type { AcceptanceCriterion, Verdict } from '../types.js';
import type { ChatMessage, CompleteFn } from './provider.js';

/**
 * Custom skill: `propose-playwright-test`.
 *
 * Generates a candidate Playwright test update for an already-authorised
 * intentional contract change.
 *
 * This skill NEVER writes files, commits changes, or heals CI automatically.
 * It only proposes a patch for human ratification.
 */
export const PROPOSER_SYSTEM_PROMPT = `You are propose-playwright-test, the Playwright test update skill for Spec Drift Sentinel.

You are given:

1. A specific Acceptance Criterion that explicitly authorises a contract change.
2. The current TypeScript Playwright test source.
3. The git diff containing the implementation change.

Your job is to synthesize a minimal, valid, executable TypeScript Playwright test update that aligns STRICTLY with the authorising Acceptance Criterion.

NON-NEGOTIABLE RULES:

- Only change behaviour explicitly authorised by the supplied AC-ID.
- Do NOT infer requirements from the implementation alone.
- Do NOT weaken the test simply to make it pass.
- Do NOT delete unrelated assertions.
- Do NOT add .skip, .fixme, arbitrary sleeps, excessive timeouts, try/catch swallowing, or loose matchers just to make CI green.
- Preserve the existing Playwright coding style, imports, helpers, fixtures, selectors, and structure wherever possible.
- Update assertions, selectors, request payloads, API response expectations, or interaction steps only when the Acceptance Criterion requires it.
- The generated test code MUST include a top-level comment citing the authorising AC-ID in this exact form:

// Authorized by AC-N

For example:

// Authorized by AC-1

- The cited AC-ID MUST exactly match the Acceptance Criterion supplied to you.
- If the Acceptance Criterion does not honestly justify changing the test, return an empty patch rather than inventing behaviour.
- Return JSON only.
- Do not return Markdown.
- Do not wrap the JSON in code fences.
- Do not include prose outside the JSON object.

Return exactly this JSON shape:

{
  "testFile": "path/to/test.spec.ts",
  "patch": "unified diff containing the proposed Playwright test update",
  "citingAc": "AC-N",
  "explanation": "one or two sentences naming what changed and which part of the criterion requires it"
}`;

/** Kept so existing imports of the generic name keep working. */
export const SYSTEM_PROMPT = PROPOSER_SYSTEM_PROMPT;

export interface ProposeInput {
  verdict: Verdict;
  criterion: AcceptanceCriterion;

  /** Current contents of the test file being updated. */
  testSource: string;

  /** Git diff that introduced the authorised implementation change. */
  gitDiff?: string;
}

export interface ProposedDiffResult {
  testFile: string;
  patch: string;
  citingAc: string;
  /**
   * Why this edit follows from the criterion.
   *
   * Surfaced to the reviewer alongside the diff. The patch shows *what*
   * changed; this is the model's account of *why*, which is the part a human
   * has to agree with before ratifying.
   */
  explanation: string;
}

export interface ProposePlaywrightDiffParams {
  acId: string;
  acText: string;
  existingTestCode: string;
  gitDiff: string;
  testFile?: string;
}

interface RawProposedDiffResult {
  testFile?: unknown;
  patch?: unknown;
  citingAc?: unknown;
  explanation?: unknown;
}

function buildProposerMessages(params: ProposePlaywrightDiffParams): ChatMessage[] {
  return [
    { role: 'system', content: PROPOSER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## Authorising Acceptance Criterion',
        `AC-ID: ${params.acId}`,
        params.acText,
        '',
        '## Existing Playwright Test',
        `File: ${params.testFile ?? 'unknown'}`,
        '```ts',
        params.existingTestCode.slice(0, 12000),
        '```',
        '',
        '## Git Diff',
        '```diff',
        params.gitDiff.slice(0, 12000),
        '```',
        '',
        'Generate a minimal Playwright test update.',
        '',
        'MANDATORY: the generated test must contain this top-level comment:',
        `// Authorized by ${params.acId}`,
        '',
        'Return JSON only:',
        '{',
        '  "testFile": "path/to/test.spec.ts",',
        '  "patch": "unified diff",',
        `  "citingAc": "${params.acId}",`,
        '  "explanation": "what changed and why the criterion requires it"',
        '}',
      ].join('\n'),
    },
  ];
}

/**
 * Extract a JSON object from a model response.
 *
 * Provider JSON mode should normally guarantee this, but stubbed providers and
 * older models can still wrap output in fences or prose.
 */
function extractProposalJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in proposal response: ${content.slice(0, 200)}`);
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function parseProposedDiffResult(content: string, expectedAcId: string): ProposedDiffResult {
  const parsed = extractProposalJson(content) as RawProposedDiffResult;

  const testFile = typeof parsed.testFile === 'string' ? parsed.testFile.trim() : '';
  const patch = typeof parsed.patch === 'string' ? parsed.patch : '';
  const citingAc = typeof parsed.citingAc === 'string' ? parsed.citingAc.trim() : '';
  const explanation =
    typeof parsed.explanation === 'string' && parsed.explanation.trim().length > 0
      ? parsed.explanation.trim()
      : 'No explanation supplied.';

  if (!testFile) {
    throw new Error('Proposal response did not include testFile.');
  }

  if (citingAc !== expectedAcId) {
    throw new Error(`Proposal cited ${citingAc || 'no AC'} but expected ${expectedAcId}.`);
  }

  // An empty patch is a legitimate answer — it means the criterion did not
  // honestly justify a change. Only a real patch must carry its authorisation.
  if (patch.trim().length > 0 && !patch.includes(`// Authorized by ${expectedAcId}`)) {
    throw new Error(
      `Proposal patch is missing mandatory comment "// Authorized by ${expectedAcId}".`,
    );
  }

  return { testFile, patch, citingAc, explanation };
}

/**
 * Generate a candidate Playwright test diff.
 *
 * Networking is injected through CompleteFn so unit tests never require API
 * keys or live provider access.
 */
export async function proposePlaywrightDiff(
  params: ProposePlaywrightDiffParams,
  complete: CompleteFn,
): Promise<ProposedDiffResult> {
  if (!/^AC-\d+$/.test(params.acId)) {
    throw new Error(`Invalid authorising Acceptance Criterion ID: ${params.acId}`);
  }

  if (!params.acText.trim()) {
    throw new Error(`Cannot propose a Playwright change without text for ${params.acId}.`);
  }

  const result = await complete(buildProposerMessages(params));
  return parseProposedDiffResult(result.content, params.acId);
}

/**
 * Attach a proposed diff to an existing Verdict.
 *
 * Refuses outright unless the classifier already determined that the change is
 * authorised by the exact Acceptance Criterion supplied here. A regression must
 * never receive a proposed "fix", or the product's central guarantee is worthless.
 */
export async function propose(input: ProposeInput, complete: CompleteFn): Promise<Verdict> {
  if (input.verdict.kind !== 'intentional_change') {
    throw new Error(
      `Refusing to propose a test change for a ${input.verdict.kind} verdict. ` +
        'Only changes authorised by an acceptance criterion may be proposed.',
    );
  }

  if (input.verdict.acId !== input.criterion.id) {
    throw new Error(
      `Verdict cites ${input.verdict.acId ?? 'no AC'} but was given ${input.criterion.id}.`,
    );
  }

  const result = await proposePlaywrightDiff(
    {
      acId: input.criterion.id,
      acText: [input.criterion.title, input.criterion.text].filter(Boolean).join('\n'),
      existingTestCode: input.testSource,
      gitDiff: input.gitDiff ?? '',
      testFile: input.verdict.failure.testFile,
    },
    complete,
  );

  return {
    ...input.verdict,
    proposedDiff: result.patch.trim().length > 0 ? result.patch : null,
    reasoning:
      `${input.verdict.reasoning}\n\n` +
      `Proposed update, authorised by ${result.citingAc}: ${result.explanation}`,
  };
}
