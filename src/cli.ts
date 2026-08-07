#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkArchitecture, formatViolation } from './analyzers/architecture.js';
import { buildTraceability, parseAcceptanceCriteria } from './analyzers/traceability.js';
import { readEntries } from './audit/log.js';
import { formatOutcome, runClassify } from './commands/classify.js';
import {
  NoProviderConfiguredError,
  createCompleter,
  providersFromEnv,
} from './agent/provider.js';
import { loadConfig } from './config.js';

/**
 * Spec Drift Sentinel CLI.
 *
 * Exit codes matter — this runs as a CI gate:
 *   0  clean
 *   1  violations or drift found (fail the build)
 *   2  bad usage or missing configuration
 */

const USAGE = `spec-drift-sentinel

Usage: sentinel <command> [--root <dir>]

Commands:
  arch      Check architecture dependency rules (deterministic, no LLM)
  trace     Print the acceptance-criterion → code → test matrix
            --strict  exit non-zero if any criterion is uncovered
  audit     Print the decision log
  classify  Diagnose a failing test against the specification
            --failures <file>  Playwright output (default: stdin)
            --diff <file>      git diff (default: git diff HEAD)
            --propose          also draft a candidate test update
  help      Show this message

arch, trace and audit need no API key. classify requires a provider —
see .env.example.
`;

function parseRoot(argv: string[]): string {
  const index = argv.indexOf('--root');
  const value = index !== -1 ? argv[index + 1] : undefined;
  return resolve(value ?? process.cwd());
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

/** Read stdin to completion, for piping test output straight in. */
function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** The diff under review. Falls back to whatever is uncommitted right now. */
function resolveDiff(root: string, file: string | undefined): string {
  if (file) return readFileSync(resolve(root, file), 'utf8');
  try {
    return execFileSync('git', ['diff', 'HEAD'], { cwd: root, encoding: 'utf8' });
  } catch {
    return '';
  }
}

async function commandClassify(root: string, argv: string[]): Promise<number> {
  const config = loadConfig(root);

  const failuresFile = flagValue(argv, '--failures');
  const failureLog = failuresFile
    ? readFileSync(resolve(root, failuresFile), 'utf8')
    : readStdin();

  if (!failureLog.trim()) {
    console.error('No test failure supplied.');
    console.error('Pass --failures <file>, or pipe test output in:');
    console.error('  npx playwright test 2>&1 | sentinel classify');
    return 2;
  }

  let complete;
  try {
    complete = createCompleter(providersFromEnv());
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const outcome = await runClassify(
    {
      root,
      specFile: config.specFile,
      diff: resolveDiff(root, flagValue(argv, '--diff')),
      failureLog,
      propose: argv.includes('--propose'),
      auditLogPath: config.auditLog,
    },
    complete,
  );

  console.log(formatOutcome(outcome));

  // A classified failure means the build is not clean, whichever way it went.
  // An authorised change still needs a human to ratify it before CI goes green.
  return 1;
}

function commandArch(root: string): number {
  const config = loadConfig(root);

  if (config.rules.length === 0) {
    console.log('No dependency rules configured — nothing to check.');
    console.log(`Add a "rules" array to sentinel.config.json to enforce boundaries.`);
    return 0;
  }

  const violations = checkArchitecture(root, config.rules);

  if (violations.length === 0) {
    console.log(`Architecture OK — ${config.rules.length} rule(s) upheld.`);
    return 0;
  }

  console.error(`Architecture violations: ${violations.length}\n`);
  for (const violation of violations) console.error(`${formatViolation(violation)}\n`);
  return 1;
}

function commandTrace(root: string, strict: boolean): number {
  const config = loadConfig(root);
  const specPath = resolve(root, config.specFile);

  if (!existsSync(specPath)) {
    console.error(`Spec file not found: ${config.specFile}`);
    return 2;
  }

  const criteria = parseAcceptanceCriteria(specPath);
  if (criteria.length === 0) {
    console.error(`No acceptance criteria found in ${config.specFile}.`);
    console.error('Declare them as headings, e.g. "### AC-1: Title".');
    return 2;
  }

  const rows = buildTraceability(root, criteria);
  const orphaned = rows.filter((row) => row.status === 'orphaned');
  const untested = rows.filter((row) => row.status === 'untested');

  for (const row of rows) {
    const marker = row.status === 'covered' ? 'ok  ' : row.status === 'untested' ? 'warn' : 'FAIL';
    console.log(`[${marker}] ${row.acId}  ${row.title}`);
    if (row.testFiles.length > 0) console.log(`         tests: ${row.testFiles.join(', ')}`);
    else if (row.coveredBy.length > 0) console.log(`         code:  ${row.coveredBy.join(', ')}`);
  }

  console.log(
    `\n${rows.length} criteria — ${rows.length - untested.length - orphaned.length} covered, ` +
      `${untested.length} untested, ${orphaned.length} orphaned`,
  );

  // Report-only by default: an unimplemented criterion is information, not a build
  // failure, while the project is still being built out. Turn on --strict once every
  // criterion is expected to be covered, and the matrix becomes a gate.
  if (orphaned.length > 0 && !strict) {
    console.log('(orphaned criteria are not yet implemented — run with --strict to fail on them)');
  }

  return strict && orphaned.length > 0 ? 1 : 0;
}

function commandAudit(root: string): number {
  const config = loadConfig(root);
  const entries = readEntries(resolve(root, config.auditLog));

  if (entries.length === 0) {
    console.log('No decisions recorded yet.');
    return 0;
  }

  for (const entry of entries) {
    console.log(
      `${entry.timestamp}  ${entry.kind.padEnd(19)} ${(entry.acId ?? '—').padEnd(6)} ` +
        `${entry.humanDecision.padEnd(8)} ${entry.decidedBy ?? ''}`,
    );
    console.log(`    ${entry.reasoning}`);
  }

  console.log(`\n${entries.length} decision(s).`);
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const command = argv[0];
  const root = parseRoot(argv);

  switch (command) {
    case 'arch':
      return commandArch(root);
    case 'trace':
      return commandTrace(root, argv.includes('--strict'));
    case 'audit':
      return commandAudit(root);
    case 'classify':
      return commandClassify(root, argv);
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(command ? `Unknown command: ${command}\n` : 'No command given.\n');
      console.error(USAGE);
      return 2;
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  },
);
