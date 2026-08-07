import type { AcceptanceCriterion, Verdict } from '../types.js';
import type { ChatMessage, CompleteFn } from './provider.js';

/**
 * Custom skill: `propose-playwright-test`.
 *
 * Drafts an updated test for a verdict that has already been classified as an
 * intentional contract change, citing the acceptance criterion that authorises it.
 *
 * This only ever *proposes*. Nothing here writes to disk, commits, or touches CI.
 * The output is a patch a human reads, checks against the cited AC, and ratifies
 * in the dashboard. That approval step is the point of the product, not overhead.
 */

export const SYSTEM_PROMPT = `You are propose-playwright-test, a skill that rewrites a stale end-to-end test.

The failure you are given has ALREADY been judged an intentional contract change, authorised by a specific acceptance criterion. Your job is to update the test so it asserts the behaviour the criterion now describes.

Rules:
  - Assert what the acceptance criterion says, not what the implementation happens to do.
    You are encoding intent, not transcribing current output.
  - Change as little as possible. Touch only assertions the criterion actually moved.
  - Never weaken a test to make it pass: no deleted assertions, no loosened matchers,
    no try/catch swallowing, no .skip, no timeouts inflated to hide a race.
  - Keep the existing style, imports and helpers of the surrounding file.
  - If the criterion does not actually describe the observed behaviour, say so instead
    of inventing an assertion.

Respond with a single JSON object and nothing else:
{
  "diff": "unified diff updating the test file, or empty string if no honest update is possible",
  "explanation": "one or two sentences on what changed and which part of the AC requires it"
}`;

export interface ProposeInput {
  verdict: Verdict;
  criterion: AcceptanceCriterion;
  /** Current contents of the test file being updated. */
  testSource: string;
}

export interface Proposal {
  diff: string | null;
  explanation: string;
}

export function buildMessages(input: ProposeInput): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## Authorising acceptance criterion',
        `### ${input.criterion.id}: ${input.criterion.title}`,
        input.criterion.text,
        '',
        '## Why this was judged an intentional change',
        input.verdict.reasoning,
        '',
        '## Failing test',
        `File: ${input.verdict.failure.testFile}`,
        `Test: ${input.verdict.failure.testName}`,
        `Failure: ${input.verdict.failure.message}`,
        '',
        '## Current test file',
        '```',
        input.testSource.slice(0, 8000),
        '```',
      ].join('\n'),
    },
  ];
}

export function parseProposal(content: string): Proposal {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in proposal response: ${content.slice(0, 200)}`);
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
    diff?: string;
    explanation?: string;
  };
  const diff = typeof parsed.diff === 'string' && parsed.diff.trim().length > 0 ? parsed.diff : null;

  return {
    diff,
    explanation:
      typeof parsed.explanation === 'string' && parsed.explanation.trim().length > 0
        ? parsed.explanation.trim()
        : 'No explanation supplied.',
  };
}

/**
 * Attach a proposed diff to a verdict.
 *
 * Refuses outright unless the verdict is an authorised intentional change — a
 * regression must never receive a proposed "fix", or the guarantee is worthless.
 */
export async function propose(
  input: ProposeInput,
  complete: CompleteFn,
): Promise<Verdict> {
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

  const result = await complete(buildMessages(input));
  const proposal = parseProposal(result.content);

  return {
    ...input.verdict,
    proposedDiff: proposal.diff,
    reasoning: `${input.verdict.reasoning}\n\nProposed update: ${proposal.explanation}`,
  };
}
