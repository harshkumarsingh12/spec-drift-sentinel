import { randomUUID } from 'node:crypto';

import type {
  AcceptanceCriterion,
  TestFailure,
  Verdict,
  VerdictKind,
} from '../types.js';
import type { ChatMessage, CompleteFn } from './provider.js';
import { parseAcceptanceCriteriaFromText } from '../analyzers/traceability.js';

/**
 * Custom agent: `drift-classifier`.
 *
 * The specification is the authority.
 *
 * An intentional contract change is only possible when an explicit AC-ID
 * in PRD.md authorises the changed behaviour. Otherwise the safe verdict
 * is regression and CI remains red.
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are drift-classifier, the classification agent for Spec Drift Sentinel.

You are given:

1. The acceptance criteria currently in force.
2. A failing Playwright end-to-end test.
3. The git diff that caused the failure.

Decide between exactly two outcomes:

"regression"
The implementation violated a contract that the specification still requires.
The test is correct and the code is wrong.

"intentional_change"
A specific acceptance criterion explicitly authorises the new behaviour.
The code reflects the new requirement and the existing test is stale.

NON-NEGOTIABLE GOVERNANCE RULE:

An intentional contract change exists only when a specific, explicit Acceptance
Criterion in the supplied specification authorises the changed behaviour.

If NO explicit AC-ID authorises the changed behaviour, classify it as "regression".

The code diff itself is never authorisation.
Implementation intent is never authorisation.
A stale-looking or inconvenient test is never authorisation.
Absence of a criterion forbidding a behaviour is NOT authorisation.

Rules you must follow:

- To answer "intentional_change", you MUST cite the exact AC-ID that authorises it.
- If the cited AC-ID does not exist in the supplied criteria, the decision is invalid.
- When genuinely uncertain, answer "regression".
- Never rewrite or approve a test merely to make CI green.
- Return structured JSON only.
- Do not return Markdown.
- Do not return code fences.
- Do not return prose outside the JSON object.

Respond with exactly one JSON object:

{
  "kind": "regression" | "intentional_change",
  "acId": "AC-3" | null,
  "confidence": 0.0,
  "reasoning": "one or two evidence-based sentences a reviewer can verify against the specification"
}`;

// Backwards-compatible export for existing callers and tests.
export const SYSTEM_PROMPT = CLASSIFIER_SYSTEM_PROMPT;

export interface ClassifyInput {
  failure: TestFailure;
  criteria: AcceptanceCriterion[];
  diff: string;
}

export interface ClassifyDriftParams {
  prdContent: string;
  gitDiff: string;
  testFailureLog: string;
  /** Where the PRD came from, recorded on each criterion so citations resolve. */
  specFile?: string;
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
      ? input.criteria
          .map((ac) => `### ${ac.id}: ${ac.title}\n${ac.text}`)
          .join('\n\n')
      : '(no acceptance criteria are in scope for the changed files)';

  return [
    {
      role: 'system',
      content: CLASSIFIER_SYSTEM_PROMPT,
    },
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

/**
 * Pull the JSON object out of a reply that may be fenced or padded with prose.
 *
 * Provider JSON mode should normally make this unnecessary, but keeping this
 * function preserves compatibility and gives us a defensive parser.
 */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = fenced?.[1] ?? content;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `No JSON object found in model response: ${content.slice(0, 200)}`,
    );
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Normalise a raw model reply into the frozen Verdict contract.
 *
 * Anything malformed, unrecognised, or claiming intentional_change without
 * citing a valid AC collapses to regression.
 */
export function normaliseVerdict(
  raw: unknown,
  failure: TestFailure,
  model: string,
  validAcIds: Set<string>,
): Verdict {
  const parsed = (raw ?? {}) as RawVerdict;

  const acId =
    typeof parsed.acId === 'string' && validAcIds.has(parsed.acId)
      ? parsed.acId
      : null;

  let kind: VerdictKind =
    parsed.kind === 'intentional_change'
      ? 'intentional_change'
      : 'regression';

  let reasoning =
    typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';

  if (kind === 'intentional_change' && acId === null) {
    kind = 'regression';

    reasoning =
      'Classified as a regression: the model proposed an intentional change ' +
      'but cited no valid acceptance criterion.' +
      (reasoning ? ` Model reasoning: ${reasoning}` : '');
  }

  const confidence =
    typeof parsed.confidence === 'number' &&
    Number.isFinite(parsed.confidence) &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
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

/**
 * Matches a Playwright failure header, e.g.
 *
 *   1) [chromium] › e2e/checkout.spec.ts:18:7 › checkout › applies free shipping
 *
 * The leading index and browser project are both optional so this also works on
 * `--reporter=line` output and on a single pasted failure.
 */
const PLAYWRIGHT_FAILURE =
  /(?:\d+\)\s*)?(?:\[[^\]]+\]\s*›\s*)?([^\s›]+\.(?:spec|test)\.[cm]?[jt]sx?):\d+:\d+\s*›\s*(.+)/;

/** First line that looks like an assertion failure, used as the message. */
const FAILURE_MESSAGE = /^\s*(Error:|AssertionError:|Timeout.*exceeded).*$/m;

/**
 * Pull the real test file and name out of Playwright output.
 *
 * These values end up in the audit log and on the dashboard, so inventing them
 * is not harmless — a reviewer needs to know which test broke. When the log
 * genuinely cannot be parsed we say so plainly rather than fabricating a
 * plausible-looking file name.
 */
export function parseTestFailure(testFailureLog: string): TestFailure {
  const header = PLAYWRIGHT_FAILURE.exec(testFailureLog);
  const message = FAILURE_MESSAGE.exec(testFailureLog)?.[0]?.trim();

  if (!header?.[1] || !header[2]) {
    return {
      testFile: '(unparsed)',
      testName: '(unparsed)',
      message: message ?? testFailureLog.trim().slice(0, 2000),
    };
  }

  // The trail is "suite › nested suite › test name"; the test name is the last.
  // Playwright appends a duration — "applies free shipping (42ms)" — which is
  // noise in an audit record, so strip it.
  const segments = header[2]
    .split('›')
    .map((part) => part.trim())
    .filter(Boolean);

  const testName = (segments[segments.length - 1] ?? header[2].trim())
    .replace(/\s*\(\d+(?:\.\d+)?m?s\)\s*$/, '')
    .trim();

  return {
    // Playwright reports Windows paths with backslashes. Normalise, or nothing
    // downstream can resolve the file — not the proposer, not the dashboard.
    testFile: header[1].split('\\').join('/'),
    testName,
    message: message ?? testFailureLog.trim().slice(0, 2000),
  };
}

/**
 * Core classifier.
 *
 * `complete` is injected so unit tests never hit the network.
 *
 * Any malformed model response fails safe to regression rather than crashing
 * or permitting an unauthorised test update.
 */
export async function classify(
  input: ClassifyInput,
  complete: CompleteFn,
): Promise<Verdict> {
  const validAcIds = new Set(input.criteria.map((ac) => ac.id));
  const result = await complete(buildMessages(input));

  try {
    return normaliseVerdict(
      extractJson(result.content),
      input.failure,
      result.model,
      validAcIds,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown classifier parsing error';

    return {
      id: randomUUID(),
      acId: null,
      kind: 'regression',
      confidence: 0,
      reasoning:
        'Fail-safe regression: classifier returned malformed structured output. ' +
        message,
      failure: input.failure,
      proposedDiff: null,
      model: result.model,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Higher-level Phase 2 entry point for callers that have raw PRD content,
 * git diff text and Playwright failure output.
 *
 * Networking remains outside the classifier. The caller injects CompleteFn
 * from provider.ts, preserving deterministic tests and provider independence.
 */
export async function classifyDrift(
  params: ClassifyDriftParams,
  complete: CompleteFn,
): Promise<Verdict> {
  return classify(
    {
      criteria: parseAcceptanceCriteriaFromText(
        params.prdContent,
        params.specFile ?? 'spec/PRD.md',
      ),
      diff: params.gitDiff,
      failure: parseTestFailure(params.testFailureLog),
    },
    complete,
  );
}
