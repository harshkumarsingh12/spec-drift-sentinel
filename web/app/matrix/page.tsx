import React from 'react';
import { getTraceability } from '@/lib/data';
import type { TraceabilityRow } from '@/lib/types';

// Scans spec/PRD.md and the repo tree at request time — must not be
// prerendered, or coverage changes would not appear until the next build.
export const dynamic = 'force-dynamic';

/**
 * Traceability matrix — Person D.
 *
 * Every acceptance criterion and what claims to cover it, colour-coded by
 * coverage status so spec rot is visible at a glance.
 *
 * @covers AC-4  (the matrix view itself is gate-item coverage for Person D)
 */

/** Derive the file to show in "COVERED BY": tests take priority over code. */
function coveredByText(row: TraceabilityRow): { text: string; nothing: boolean } {
  if (row.testFiles.length > 0) {
    return { text: row.testFiles.join(', '), nothing: false };
  }
  if (row.coveredBy.length > 0) {
    return { text: row.coveredBy.join(', '), nothing: false };
  }
  return { text: 'nothing claims this criterion', nothing: true };
}

function StatusBadge({ status }: { status: TraceabilityRow['status'] }) {
  const cls =
    status === 'covered'
      ? 'badge badge-ok'
      : status === 'untested'
        ? 'badge badge-warn'
        : 'badge badge-danger';
  return <span className={cls}>{status}</span>;
}

export default function MatrixPage() {
  const traceability = getTraceability();
  const covered  = traceability.filter((r) => r.status === 'covered').length;
  const untested = traceability.filter((r) => r.status === 'untested').length;
  const orphaned = traceability.filter((r) => r.status === 'orphaned').length;

  return (
    <div className="stack">
      {/* Page header */}
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Traceability matrix</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every acceptance criterion and what claims to cover it.
        </p>
      </div>

      {/* Summary strip */}
      <div className="matrix-summary">
        <span className="matrix-summary-pill ok">
          <span className="dot" />
          {covered} covered
        </span>
        <span className="matrix-summary-pill warn">
          <span className="dot" />
          {untested} untested
        </span>
        <span className="matrix-summary-pill bad">
          <span className="dot" />
          {orphaned} orphaned
        </span>
      </div>

      {/* Main table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="matrix-table">
          <thead>
            <tr>
              <th>AC</th>
              <th>Criterion</th>
              <th>Covered by</th>
              <th className="matrix-status-col">Status</th>
            </tr>
          </thead>
          <tbody>
            {traceability.map((row) => {
              const { text, nothing } = coveredByText(row);
              return (
                <tr key={row.acId} data-testid="matrix-row">
                  <td className="matrix-ac">{row.acId}</td>
                  <td>
                    <span className={`matrix-criterion ${row.status}`}>
                      {row.title}
                    </span>
                  </td>
                  <td>
                    <span className={`matrix-covered-by${nothing ? ' nothing' : ''}`}>
                      {text}
                    </span>
                  </td>
                  <td className="matrix-status-col">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
