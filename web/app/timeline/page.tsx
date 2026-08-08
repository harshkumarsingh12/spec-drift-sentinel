import { getAuditLog } from '@/lib/data';
import type { AuditEntry } from '@/lib/types';

// Reads .sentinel/audit.jsonl at request time — must not be prerendered, or
// new decisions would not appear until the next build.
export const dynamic = 'force-dynamic';

/**
 * Audit timeline — Person D.
 *
 * Every row ever appended to `.sentinel/audit.jsonl`, newest first. Designed
 * to be skimmable: a judge scrolls this to reconstruct who signed off on
 * what and when.
 *
 * @covers AC-4
 */

/** Map humanDecision to the badge CSS class. */
function decisionBadgeClass(decision: AuditEntry['humanDecision']): string {
  if (decision === 'approved') return 'badge badge-ok';
  if (decision === 'rejected') return 'badge badge-danger';
  return 'badge badge-warn';
}

/** The circular node that sits on the rail. */
function StatusNode({ decision }: { decision: AuditEntry['humanDecision'] }) {
  if (decision === 'approved') {
    return (
      <div className="timeline-node ok" aria-label="approved">
        {/* checkmark */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (decision === 'rejected') {
    return (
      <div className="timeline-node danger" aria-label="rejected">
        {/* cross */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 2L10 10M10 2L2 10" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  // pending — muted with a gear/dot
  return (
    <div className="timeline-node muted" aria-label="pending">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
      </svg>
    </div>
  );
}

export default function TimelinePage() {
  const entries = [...getAuditLog()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

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
      {/* Page header */}
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Audit timeline</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every decision, automated and human, in the order it happened.
        </p>
      </div>

      {/* Rail + cards */}
      <div className="timeline-rail-wrap">
        {entries.map((entry, idx) => (
          <div
            className="timeline-item"
            // Two rows for the same verdict (classified, then ratified) can land in the
            // same millisecond, so the timestamp alone is not a unique key.
            key={`${entry.verdictId}-${entry.humanDecision}-${idx}`}
            data-last={idx === entries.length - 1 ? 'true' : undefined}
          >
            {/* Node on the rail */}
            <StatusNode decision={entry.humanDecision} />

            {/* Decision card */}
            <div className="panel timeline-card" data-testid="timeline-entry">
              {/* Top row: badges + timestamp */}
              <div className="timeline-card-header">
                <div className="row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                  <span className={decisionBadgeClass(entry.humanDecision)}>
                    {entry.humanDecision}
                  </span>
                  <span className="badge badge-muted mono">
                    {entry.acId ?? 'no AC'}
                  </span>
                  <span className="badge badge-muted">
                    {entry.kind.replace('_', ' ')}
                  </span>
                </div>
                <span
                  className="small muted mono"
                  data-testid="timeline-timestamp"
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {entry.timestamp}
                </span>
              </div>

              {/* Reasoning */}
              <p className="timeline-reasoning">{entry.reasoning}</p>

              {/* Footer: model · ratified by · diff */}
              <p className="timeline-footer">
                <span className="mono">{entry.model}</span>
                {entry.decidedBy && (
                  <>
                    <span className="timeline-footer-sep">·</span>
                    <span>
                      {'ratified by '}
                      <span className="mono">{entry.decidedBy}</span>
                    </span>
                  </>
                )}
                {entry.proposedDiffHash && (
                  <>
                    <span className="timeline-footer-sep">·</span>
                    <span>
                      {'⇒ '}
                      <span className="timeline-diff-chip mono">{`diff ${entry.proposedDiffHash}`}</span>
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
