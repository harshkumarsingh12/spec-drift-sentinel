import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyDrift } from '../agent/classifier.js';
import { propose } from '../agent/proposer.js';
import type { CompleteFn } from '../agent/provider.js';
import { parseAcceptanceCriteriaFromText } from '../analyzers/traceability.js';
import { appendEntry, entryFromVerdict } from '../audit/log.js';
import type { Verdict } from '../types.js';

/**
 * The classify command — the seam where the whole pipeline finally runs.
 *
 * Reads the spec, a git diff and a test-failure log; asks the classifier whether
 * the failure is a regression or an authorised contract change; optionally asks
 * the proposer to draft a test update; records the decision.
 *
 * Nothing here writes to a test file. A proposal is recorded and displayed, and
 * a human ratifies it in the dashboard — that separation is the product.
 */

export interface ClassifyOptions {
  root: string;
  specFile: string;
  diff: string;
  failureLog: string;
  /** Whether to ask for a candidate test diff when the change is authorised. */
  propose: boolean;
  auditLogPath: string;
}

export interface ClassifyOutcome {
  verdict: Verdict;
  /** Set when a proposal was attempted but could not be made. */
  proposalSkipped?: string;
}

/**
 * Load the test file a proposal would edit.
 *
 * Returns null when the path is unknown or missing — the classifier records
 * '(unparsed)' when it cannot read a real path out of the failure log, and
 * proposing an edit to a file we cannot read would be guesswork.
 */
function readTestSource(root: string, testFile: string): string | null {
  if (!testFile || testFile === '(unparsed)') return null;
  const path = resolve(root, testFile);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export async function runClassify(
  options: ClassifyOptions,
  complete: CompleteFn,
): Promise<ClassifyOutcome> {
  const prdPath = resolve(options.root, options.specFile);
  if (!existsSync(prdPath)) {
    throw new Error(`Spec file not found: ${options.specFile}`);
  }
  const prdContent = readFileSync(prdPath, 'utf8');

  let verdict = await classifyDrift(
    {
      prdContent,
      gitDiff: options.diff,
      testFailureLog: options.failureLog,
      specFile: options.specFile,
    },
    complete,
  );

  let proposalSkipped: string | undefined;

  // A regression never gets a proposed fix. That is enforced inside propose()
  // as well, but skipping the call entirely keeps the intent obvious here.
  if (options.propose && verdict.kind === 'intentional_change' && verdict.acId) {
    const criterion = parseAcceptanceCriteriaFromText(prdContent, options.specFile).find(
      (ac) => ac.id === verdict.acId,
    );
    const testSource = readTestSource(options.root, verdict.failure.testFile);

    if (!criterion) {
      proposalSkipped = `criterion ${verdict.acId} not found in ${options.specFile}`;
    } else if (testSource === null) {
      proposalSkipped = `could not read test file "${verdict.failure.testFile}"`;
    } else {
      try {
        verdict = await propose(
          { verdict, criterion, testSource, gitDiff: options.diff },
          complete,
        );
      } catch (error) {
        // A failed proposal must not discard the verdict — the classification
        // is the valuable part and still belongs in the audit log.
        proposalSkipped = error instanceof Error ? error.message : String(error);
      }
    }
  }

  appendEntry(entryFromVerdict(verdict), resolve(options.root, options.auditLogPath));

  return { verdict, proposalSkipped };
}

/** Human-readable report for the terminal. */
export function formatOutcome(outcome: ClassifyOutcome): string {
  const { verdict, proposalSkipped } = outcome;
  const lines: string[] = [];

  lines.push('');
  lines.push(`  verdict     ${verdict.kind}`);
  lines.push(`  criterion   ${verdict.acId ?? '— none cited'}`);
  lines.push(`  confidence  ${Math.round(verdict.confidence * 100)}%`);
  lines.push(`  test        ${verdict.failure.testName}`);
  lines.push(`  file        ${verdict.failure.testFile}`);
  lines.push(`  model       ${verdict.model}`);
  lines.push('');
  lines.push('  reasoning');
  for (const line of verdict.reasoning.split('\n')) lines.push(`    ${line}`);
  lines.push('');

  if (verdict.kind === 'regression') {
    lines.push('  No acceptance criterion authorises this change.');
    lines.push('  The test is correct and stays as it is. Fix the code.');
  } else if (verdict.proposedDiff) {
    lines.push('  Proposed test update — NOT applied, awaiting human ratification:');
    lines.push('');
    for (const line of verdict.proposedDiff.split('\n')) lines.push(`    ${line}`);
    lines.push('');
    lines.push('  Review and approve it in the dashboard (cd web && npm run dev).');
  } else if (proposalSkipped) {
    lines.push(`  No proposal generated: ${proposalSkipped}`);
  }

  lines.push('');
  return lines.join('\n');
}
