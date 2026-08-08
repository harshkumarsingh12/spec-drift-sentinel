/**
 * The frozen contract between the analysis backend and the dashboard.
 *
 * Freeze this early. The frontend builds against mock objects shaped like these
 * while the backend is still being written, so neither half blocks the other.
 * Changing a field here means coordinating across both halves — do it deliberately.
 */

/** An acceptance criterion parsed out of spec/PRD.md. */
export interface AcceptanceCriterion {
  /** Stable identifier, e.g. "AC-1". */
  id: string;
  title: string;
  /** Full criterion prose, used as evidence when classifying drift. */
  text: string;
  sourceFile: string;
  line: number;
}

/** A single failing test, normalised from the test runner's report. */
export interface TestFailure {
  testFile: string;
  testName: string;
  message: string;
}

/**
 * What the classifier concluded about a failure.
 *
 * - `regression`         — the code broke a contract the spec still asserts.
 *                          The test is right. CI stays red. No test is modified.
 * - `intentional_change` — an acceptance criterion authorises the new behaviour.
 *                          A test update may be *proposed* for human ratification.
 * - `unknown`            — not enough evidence. Treated as `regression` (fail safe).
 */
export type VerdictKind = 'regression' | 'intentional_change' | 'unknown';

export interface Verdict {
  id: string;
  /** The AC that authorises this change, or null when nothing authorises it. */
  acId: string | null;
  kind: VerdictKind;
  /** 0..1. Low confidence on `intentional_change` should be surfaced in the UI. */
  confidence: number;
  /** Why the classifier reached this conclusion. Shown verbatim to the human. */
  reasoning: string;
  failure: TestFailure;
  /**
   * Unified diff updating the test, or null.
   * Only ever non-null when kind === 'intentional_change'.
   * NEVER applied without an explicit human decision.
   */
  proposedDiff: string | null;
  /** Which model produced this verdict, for the audit trail. */
  model: string;
  createdAt: string;
}

export type HumanDecision = 'pending' | 'approved' | 'rejected';

/** One append-only row in the audit log. */
export interface AuditEntry {
  verdictId: string;
  acId: string | null;
  kind: VerdictKind;
  /** 0..1. Carried through so the dashboard can surface low-confidence verdicts. */
  confidence: number;
  reasoning: string;
  /** What broke. Carried through so the dashboard never has to invent it. */
  failure: TestFailure;
  model: string;
  /** Short sha256 of the proposed diff, so the log stays verifiable even if the full text is stripped. */
  proposedDiffHash: string | null;
  /** Full diff text, or null. The only place this is persisted — the dashboard reads it from here. */
  proposedDiff: string | null;
  humanDecision: HumanDecision;
  /** Who ratified it. null while pending. */
  decidedBy: string | null;
  timestamp: string;
}

/** A forbidden dependency edge, checked deterministically with no LLM involved. */
export interface DependencyRule {
  /** Glob of files the rule applies to, e.g. "src/web/**". */
  from: string;
  /** Glob those files must not import, e.g. "src/db/**". */
  forbid: string;
  reason?: string;
}

export interface ArchitectureViolation {
  file: string;
  line: number;
  importPath: string;
  /** Repo-relative path the import resolved to. */
  resolved: string;
  rule: DependencyRule;
}

/** Links an acceptance criterion to the code and tests that claim to cover it. */
export interface TraceabilityRow {
  acId: string;
  title: string;
  /** Files carrying a `@covers AC-n` annotation. */
  coveredBy: string[];
  testFiles: string[];
  status: 'covered' | 'untested' | 'orphaned';
}
