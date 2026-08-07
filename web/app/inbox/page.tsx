import Link from 'next/link';
import { pendingVerdicts } from '@/lib/mock-data';
import type { Verdict } from '@/lib/types';

/**
 * Drift inbox — Person C.
 *
 * This page is the reference pattern for the rest of the dashboard: read from
 * mock-data, type everything against lib/types, use the design tokens, and put
 * a data-testid on anything Playwright will need. Copy this shape.
 *
 * Note the asymmetry: a regression is shown but is NOT actionable. It carries no
 * proposed diff because the fix belongs in the code, not the test. Do not add an
 * approve button to those rows.
 */

function KindBadge({ kind }: { kind: Verdict['kind'] }) {
  if (kind === 'intentional_change') {
    return (
      <span className="badge badge-accent" data-testid="verdict-kind">
        intentional change
      </span>
    );
  }
  return (
    <span className="badge badge-danger" data-testid="verdict-kind">
      regression
    </span>
  );
}

function VerdictRow({ verdict }: { verdict: Verdict }) {
  const actionable = verdict.kind === 'intentional_change';
  const lowConfidence = actionable && verdict.confidence < 0.6;

  const body = (
    <div className="panel" data-testid="verdict-row">
      <div className="spread">
        <div className="row">
          <KindBadge kind={verdict.kind} />
          {verdict.acId ? (
            <span className="badge badge-muted mono">{verdict.acId}</span>
          ) : (
            <span className="badge badge-muted">no criterion</span>
          )}
          {lowConfidence && (
            <span className="badge badge-warn" data-testid="low-confidence">
              low confidence {Math.round(verdict.confidence * 100)}%
            </span>
          )}
        </div>
        <span className="small muted mono">{verdict.id}</span>
      </div>

      <p style={{ margin: '12px 0 4px', fontWeight: 500 }}>{verdict.failure.testName}</p>
      <p className="small muted mono" style={{ margin: 0 }}>
        {verdict.failure.testFile}
      </p>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        {verdict.reasoning}
      </p>

      {!actionable && (
        <p className="small" style={{ margin: '10px 0 0', color: 'var(--danger)' }}>
          Not actionable — no criterion authorises this. Fix the code, not the test.
        </p>
      )}
    </div>
  );

  // Only an authorised change leads anywhere: there is nothing to ratify otherwise.
  return actionable ? (
    <Link href={`/inbox/${verdict.id}`} style={{ color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export default function InboxPage() {
  if (pendingVerdicts.length === 0) {
    return (
      <div className="empty">
        <p style={{ fontSize: 18, margin: '0 0 4px' }}>No pending decisions</p>
        <p className="small" style={{ margin: 0 }}>
          Every classified failure has been ratified.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Drift inbox</h1>
        <p className="muted" style={{ margin: 0 }}>
          {pendingVerdicts.length} verdict{pendingVerdicts.length === 1 ? '' : 's'} awaiting review.
        </p>
      </div>

      {pendingVerdicts.map((verdict) => (
        <VerdictRow key={verdict.id} verdict={verdict} />
      ))}
    </div>
  );
}
