import { mockTraceability } from '@/lib/mock-data';

/**
 * Traceability matrix — Person D.
 *
 * STUB: renders the rows but is deliberately plain. Make it the view that shows
 * spec rot at a glance.
 *
 * To finish it:
 *   1. Lay it out as a real table with aligned columns.
 *   2. Lean on the status colours — that is the whole point of this screen.
 *   3. Show the covering files, not just the counts.
 *   4. Consider a summary strip: N covered / N untested / N orphaned.
 */

export default function MatrixPage() {
  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Traceability matrix</h1>
        <p className="muted" style={{ margin: 0 }}>
          Every acceptance criterion and what claims to cover it.
        </p>
      </div>

      {mockTraceability.map((row) => (
        <div className="panel" key={row.acId} data-testid="matrix-row">
          <div className="spread">
            <div className="row">
              <span className="badge badge-muted mono">{row.acId}</span>
              <span>{row.title}</span>
            </div>
            <span
              className={
                row.status === 'covered'
                  ? 'badge badge-ok'
                  : row.status === 'untested'
                    ? 'badge badge-warn'
                    : 'badge badge-danger'
              }
            >
              {row.status}
            </span>
          </div>
          <p className="small muted mono" style={{ margin: '10px 0 0' }}>
            {row.testFiles.length > 0
              ? `tests: ${row.testFiles.join(', ')}`
              : row.coveredBy.length > 0
                ? `code: ${row.coveredBy.join(', ')}`
                : 'nothing claims this criterion'}
          </p>
        </div>
      ))}
    </div>
  );
}
