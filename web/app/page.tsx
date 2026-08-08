import Link from 'next/link';
import { getAuditLog, getPendingVerdicts, getTraceability } from '@/lib/data';

// Reads .sentinel/audit.jsonl and spec/PRD.md at request time — never prerender
// this at build time, or a ratification would not show up until the next build.
export const dynamic = 'force-dynamic';

function Mascot({ greeting }: { greeting: string }) {
  return (
    <div className="mascot-wrap" aria-hidden="true">
      <div className="speech-bubble">{greeting}</div>
      <svg width="92" height="92" viewBox="0 0 92 92" fill="none">
        <rect x="30" y="4" width="6" height="14" rx="3" fill="#c7c9e6" />
        <circle cx="33" cy="6" r="4" fill="#5b52e8" />
        <rect x="14" y="18" width="64" height="46" rx="18" fill="#ffffff" stroke="#e7e8f3" strokeWidth="2" />
        <rect x="24" y="28" width="44" height="26" rx="10" fill="#1c1f2e" />
        <path d="M36 41c0 3 2.5 5.5 5.5 5.5S47 44 47 41" stroke="#7bdff2" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M50 41c0 3 2.5 5.5 5.5 5.5S61 44 61 41" stroke="#7bdff2" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="6" y="34" width="8" height="18" rx="4" fill="#ffffff" stroke="#e7e8f3" strokeWidth="2" />
        <rect x="78" y="34" width="8" height="18" rx="4" fill="#ffffff" stroke="#e7e8f3" strokeWidth="2" />
        <rect x="20" y="66" width="52" height="20" rx="10" fill="#ffffff" stroke="#e7e8f3" strokeWidth="2" />
      </svg>
    </div>
  );
}

export default function OverviewPage() {
  const pendingVerdicts = getPendingVerdicts();
  const traceability = getTraceability();
  const auditLog = getAuditLog();

  const pending = pendingVerdicts.length;
  const actionable = pendingVerdicts.filter((v) => v.kind === 'intentional_change').length;
  const regressions = pendingVerdicts.filter((v) => v.kind === 'regression').length;
  const orphaned = traceability.filter((r) => r.status === 'orphaned').length;
  const decided = auditLog.filter((e) => e.humanDecision !== 'pending').length;

  const greeting =
    pending > 0
      ? `Hey! ${pending} verdict${pending === 1 ? '' : 's'} need${pending === 1 ? 's' : ''} you 👋`
      : "You're all caught up 🎉";

  return (
    <div className="stack">
      <div className="hero">
        <h1>
          Hi there, ready to <span className="accent-word">ratify some drift</span>?
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          Proposed test changes wait here until a human checks them against the criterion that
          claims to authorise them. Nothing is ever applied automatically.
        </p>
        <Mascot greeting={greeting} />
      </div>

      <div className="card-grid">
        <Link href="/inbox" className="feature-card">
          <span className="feature-icon accent">📥</span>
          <p className="feature-card-stat">{pending}</p>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {actionable} awaiting ratification · {regressions} regression
            {regressions === 1 ? '' : 's'}
          </p>
          <p className="feature-card-label">Drift inbox</p>
        </Link>

        <Link href="/matrix" className="feature-card">
          <span className="feature-icon ok">🗺️</span>
          <p className="feature-card-stat">{traceability.length}</p>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {orphaned} orphaned — nothing claims to cover {orphaned === 1 ? 'it' : 'them'}
          </p>
          <p className="feature-card-label">Traceability</p>
        </Link>

        <Link href="/timeline" className="feature-card">
          <span className="feature-icon warn">🕒</span>
          <p className="feature-card-stat">{auditLog.length}</p>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {decided} ratified by a human
          </p>
          <p className="feature-card-label">Audit timeline</p>
        </Link>
      </div>

      <div className="footer-bar">
        <div className="footer-bar-top">
          <span>
            <span className="glow">Determinism where possible.</span> Only the regression-vs-intent
            call needs a model.
          </span>
          <span>drift-classifier · NVIDIA Build → Groq</span>
        </div>
        <div className="chip-row">
          <Link className="chip" href="/inbox">
            📥 Review inbox
          </Link>
          <Link className="chip" href="/matrix">
            🗺️ Traceability matrix
          </Link>
          <Link className="chip" href="/timeline">
            🕒 Audit timeline
          </Link>
          <a
            className="chip"
            href="https://github.com/harshkumarsingh12/spec-drift-sentinel/blob/main/ARCHITECTURE.md"
            target="_blank"
            rel="noreferrer"
          >
            📄 Architecture docs
          </a>
        </div>
      </div>

      <p className="small muted">
        Reading live from <span className="mono">.sentinel/audit.jsonl</span> and{' '}
        <span className="mono">spec/PRD.md</span>. See <span className="mono">WEB.md</span> for the plan.
      </p>
    </div>
  );
}
