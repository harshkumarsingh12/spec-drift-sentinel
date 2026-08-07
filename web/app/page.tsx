import Link from 'next/link';
import { mockAuditLog, mockTraceability, mockVerdicts } from '@/lib/mock-data';

export default function OverviewPage() {
  const pending = mockVerdicts.length;
  const actionable = mockVerdicts.filter((v) => v.kind === 'intentional_change').length;
  const regressions = mockVerdicts.filter((v) => v.kind === 'regression').length;
  const orphaned = mockTraceability.filter((r) => r.status === 'orphaned').length;
  const decided = mockAuditLog.filter((e) => e.humanDecision !== 'pending').length;

  return (
    <div className="stack">
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Overview</h1>
        <p className="muted" style={{ margin: 0 }}>
          Proposed test changes wait here until a human checks them against the criterion that
          claims to authorise them.
        </p>
      </div>

      <div className="grid-2">
        <Link href="/inbox" className="panel" style={{ color: 'inherit' }}>
          <p className="panel-title">Drift inbox</p>
          <div className="row">
            <strong style={{ fontSize: 28 }}>{pending}</strong>
            <span className="muted small">pending</span>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {actionable} awaiting ratification · {regressions} regression
            {regressions === 1 ? '' : 's'}
          </p>
        </Link>

        <Link href="/matrix" className="panel" style={{ color: 'inherit' }}>
          <p className="panel-title">Traceability</p>
          <div className="row">
            <strong style={{ fontSize: 28 }}>{mockTraceability.length}</strong>
            <span className="muted small">criteria</span>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {orphaned} orphaned — nothing claims to cover {orphaned === 1 ? 'it' : 'them'}
          </p>
        </Link>
      </div>

      <Link href="/timeline" className="panel" style={{ color: 'inherit' }}>
        <p className="panel-title">Audit timeline</p>
        <div className="row">
          <strong style={{ fontSize: 28 }}>{mockAuditLog.length}</strong>
          <span className="muted small">recorded decisions</span>
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {decided} ratified by a human
        </p>
      </Link>

      <p className="small muted">
        Showing mock data. See <span className="mono">WEB.md</span> for the plan and{' '}
        <span className="mono">web/lib/mock-data.ts</span> for the fixtures.
      </p>
    </div>
  );
}
