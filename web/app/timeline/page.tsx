import { mockAuditLog } from '@/lib/mock-data';

/**
 * Audit timeline — Person D.
 *
 * STUB: lists entries newest first. This is the traceability story for the
 * panel, so make it skimmable — a judge should be able to scroll it and
 * reconstruct who signed off on what.
 *
 * To finish it:
 *   1. Add a visual timeline rail so the ordering reads at a glance.
 *   2. Format timestamps readably, and group by day if the list grows.
 *   3. Consider filters: pending / approved / rejected.
 */

export default function TimelinePage() {
  const entries = [...mockAuditLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (entries.length === 0) {
    return (
      <div className="empty">
        <p style={{ fontSize: 18, margin: '0 0 4px' }}>No decisions recorded yet</p>
        <p className="small" style={{ margin: 0 }}>
          Classifications and ratifications will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Audit timeline</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every decision, automated and human, in the order it happened.
        </p>
      </div>

      {entries.map((entry) => (
        <div className="panel" key={`${entry.verdictId}-${entry.timestamp}`} data-testid="timeline-entry">
          <div className="spread">
            <div className="row">
              <span
                className={
                  entry.humanDecision === 'approved'
                    ? 'badge badge-ok'
                    : entry.humanDecision === 'rejected'
                      ? 'badge badge-danger'
                      : 'badge badge-muted'
                }
              >
                {entry.humanDecision}
              </span>
              <span className="badge badge-muted mono">{entry.acId ?? 'no AC'}</span>
              <span className="small muted">{entry.kind.replace('_', ' ')}</span>
            </div>
            <span className="small muted mono" data-testid="timeline-timestamp">
              {entry.timestamp}
            </span>
          </div>

          <p className="small" style={{ margin: '10px 0 0' }}>
            {entry.reasoning}
          </p>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {entry.model}
            {entry.decidedBy && ` · ratified by ${entry.decidedBy}`}
            {entry.proposedDiffHash && ` · diff ${entry.proposedDiffHash}`}
          </p>
        </div>
      ))}
    </div>
  );
}
