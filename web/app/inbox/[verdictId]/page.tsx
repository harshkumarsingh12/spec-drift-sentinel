import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findCriterion, findVerdict } from '@/lib/mock-data';

/**
 * Diff viewer — Person C. THE screen that matters.
 *
 * STUB: renders the two panes and the reasoning, but the buttons do nothing yet.
 *
 * To finish it:
 *   1. Make Approve / Reject work. They need 'use client' and a server action or
 *      route handler that appends to the audit log, then redirects to /inbox.
 *   2. Keep both buttons visually equal — see the note at the bottom of
 *      globals.css for why that is deliberate.
 *   3. Handle the case where a verdict is already decided.
 */

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="diff" data-testid="proposed-diff">
      {diff.split('\n').map((line, index) => {
        const cls = line.startsWith('+')
          ? 'diff-line diff-add'
          : line.startsWith('-')
            ? 'diff-line diff-del'
            : line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')
              ? 'diff-line diff-meta'
              : 'diff-line';
        return (
          <span key={index} className={cls}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

export default async function DiffViewerPage({
  params,
}: {
  params: Promise<{ verdictId: string }>;
}) {
  const { verdictId } = await params;
  const verdict = findVerdict(verdictId);
  if (!verdict) notFound();

  const criterion = findCriterion(verdict.acId);

  return (
    <div className="stack">
      <div>
        <Link href="/inbox" className="small">
          ← Back to inbox
        </Link>
        <h1 style={{ margin: '8px 0 4px' }}>{verdict.failure.testName}</h1>
        <p className="small muted mono" style={{ margin: 0 }}>
          {verdict.failure.testFile}
        </p>
      </div>

      <div className="grid-2">
        <div className="panel">
          <p className="panel-title">Authorising criterion</p>
          {criterion ? (
            <div data-testid="criterion-text">
              <p style={{ margin: '0 0 8px', fontWeight: 500 }}>
                <span className="mono">{criterion.id}</span> — {criterion.title}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {criterion.text}
              </p>
              <p className="small muted mono" style={{ margin: '12px 0 0' }}>
                {criterion.sourceFile}:{criterion.line}
              </p>
            </div>
          ) : (
            <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>
              No criterion cited. Nothing authorises a change here.
            </p>
          )}
        </div>

        <div className="panel">
          <p className="panel-title">Proposed test change</p>
          {verdict.proposedDiff ? (
            <DiffBlock diff={verdict.proposedDiff} />
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              No diff proposed — this is a regression.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">Classifier reasoning</p>
        <p style={{ margin: 0 }}>{verdict.reasoning}</p>
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          {verdict.model} · confidence {Math.round(verdict.confidence * 100)}%
        </p>
      </div>

      {verdict.proposedDiff && (
        <div className="actions">
          {/* STUB: wire these up. See the notes at the top of this file. */}
          <button className="btn" data-testid="approve-button" type="button">
            Approve
          </button>
          <button className="btn" data-testid="reject-button" type="button">
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
