import { randomUUID } from 'node:crypto';
import type { AcceptanceCriterion, TestFailure, Verdict, VerdictKind } from '../types.js';
import type { ChatMessage, CompleteFn } from './provider.js';

/**
 * Custom agent: `drift-classifier`.
 *
 * Given a failing test and the acceptance criteria in scope, decides whether the
 * failure is an unintended regression or a change the spec authorises.
 *
 * The bias is deliberate and load-bearing: absent clear authorisation in an
 * acceptance criterion, the answer is `regression` and the test stays red. We do
 * not heal CI to green — a test rewritten to match the implementation is a
 * tautology, not a test.
 */

export const SYSTEM_PROMPT = `You are drift-classifier, a specialist agent that decides why an end-to-end test failed.

You are given:
  1. The acceptance criteria currently in force (the specification).
  2. A failing test, with its assertion message.
  3. The diff of what changed in the code.

Decide between exactly two outcomes:

  "regression"         The code violated a contract the specification still asserts.
                       The test is correct and the code is wrong.

  "intentional_change" A specific acceptance criterion authorises the new behaviour.
                       The code is correct and the test is stale.

Rules you must follow:
  - To answer "intentional_change" you MUST cite the exact AC id that authorises it.
    If no acceptance criterion clearly authorises the new behaviour, answer "regression".
  - Absence of a criterion forbidding something is NOT authorisation.
  - A test being inconvenient, brittle or outdated-looking is NOT authorisation.
  - When genuinely uncertain, answer "regression". Failing safe keeps CI honest.

Respond with a single JSON object and nothing else:
{
  "kind": "regression" | "intentional_change",
  "acId": "AC-3" | null,
  "confidence": 0.0 to 1.0,
  "reasoning": "one or two sentences a reviewer can check against the spec"
}`;

export interface ClassifyInput {
  failure: TestFailure;
  criteria: AcceptanceCriterion[];
  diff: string;
}

interface RawVerdict {
  kind?: string;
  acId?: string | null;
  confidence?: number;
  reasoning?: string;
}

export function buildMessages(input: ClassifyInput): ChatMessage[] {
  const criteria =
    input.criteria.length > 0
      ? input.criteria.map((ac) => `### ${ac.id}: ${ac.title}\n${ac.text}`).join('\n\n')
      : '(no acceptance criteria are in scope for the changed files)';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        '## Acceptance criteria in force',
        criteria,
        '',
        '## Failing test',
        `File: ${input.failure.testFile}`,
        `Test: ${input.failure.testName}`,
        `Failure: ${input.failure.message}`,
        '',
        '## Code diff',
        '```diff',
        input.diff.slice(0, 8000),
        '```',
      ].join('\n'),
    },
  ];
}

/** Pull the JSON object out of a reply that may be fenced or padded with prose. */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in model response: ${content.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Normalise a raw model reply into a Verdict.
 *
 * Anything malformed, unrecognised, or claiming `intentional_change` without
 * citing an AC collapses to `regression`. The model cannot talk its way past the
 * citation requirement.
 */
export function normaliseVerdict(
  raw: unknown,
  failure: TestFailure,
  model: string,
  validAcIds: Set<string>,
): Verdict {
  const parsed = (raw ?? {}) as RawVerdict;
  const acId = typeof parsed.acId === 'string' && validAcIds.has(parsed.acId) ? parsed.acId : null;

  let kind: VerdictKind = parsed.kind === 'intentional_change' ? 'intentional_change' : 'regression';
  let reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';

  if (kind === 'intentional_change' && acId === null) {
    kind = 'regression';
    reasoning =
      'Classified as a regression: the model proposed an intentional change but cited no valid ' +
      `acceptance criterion.${reasoning ? ` Model reasoning: ${reasoning}` : ''}`;
  }

  const confidence =
    typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0;

  return {
    id: randomUUID(),
    acId,
    kind,
    confidence,
    reasoning: reasoning || 'No reasoning supplied by the model.',
    failure,
    proposedDiff: null,
    model,
    createdAt: new Date().toISOString(),
  };
}

/** Classify one failure. `complete` is injected so tests never hit the network. */
export async function classify(input: ClassifyInput, complete: CompleteFn): Promise<Verdict> {
  const validAcIds = new Set(input.criteria.map((ac) => ac.id));
  const result = await complete(buildMessages(input));
  return normaliseVerdict(extractJson(result.content), input.failure, result.model, validAcIds);
}
