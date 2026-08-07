/**
 * Mirror of `src/types.ts` — the shared contract with the analysis backend.
 *
 * ⚠️ KEEP IN SYNC. `src/types.ts` is the source of truth. If you change a shape
 * there, change it here in the same commit.
 *
 * The duplication exists because `web/` is a separate npm package and cannot
 * import across the boundary cleanly. The proper fix is npm workspaces — worth
 * doing if there is spare time, not worth doing under pressure.
 */

export interface AcceptanceCriterion {
  id: string;
  title: string;
  text: string;
  sourceFile: string;
  line: number;
}

export interface TestFailure {
  testFile: string;
  testName: string;
  message: string;
}

export type VerdictKind = 'regression' | 'intentional_change' | 'unknown';

export interface Verdict {
  id: string;
  acId: string | null;
  kind: VerdictKind;
  confidence: number;
  reasoning: string;
  failure: TestFailure;
  proposedDiff: string | null;
  model: string;
  createdAt: string;
}

export type HumanDecision = 'pending' | 'approved' | 'rejected';

export interface AuditEntry {
  verdictId: string;
  acId: string | null;
  kind: VerdictKind;
  reasoning: string;
  model: string;
  proposedDiffHash: string | null;
  humanDecision: HumanDecision;
  decidedBy: string | null;
  timestamp: string;
}

export interface TraceabilityRow {
  acId: string;
  title: string;
  coveredBy: string[];
  testFiles: string[];
  status: 'covered' | 'untested' | 'orphaned';
}
