import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { NextResponse } from 'next/server';

import { findLatestEntry } from '@/lib/data';
import type { AuditEntry, HumanDecision } from '@/lib/types';

/**
 * Records a human ratification — approve or reject.
 *
 * Appends to the same `.sentinel/audit.jsonl` the CLI writes to (AC-4: one
 * append-only log, one vocabulary). Looks the verdict up by its *latest* row
 * so a verdict that was already decided, or was never actionable, cannot be
 * re-decided through a stale page or a replayed request.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ verdictId: string }> },
) {
  const { verdictId } = await params;

  const current = findLatestEntry(verdictId);

  if (!current) {
    return NextResponse.json({ error: 'Verdict not found' }, { status: 404 });
  }

  const body = await request.json();
  const decision = body.decision as HumanDecision;

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json(
      { error: 'Decision must be approved or rejected' },
      { status: 400 },
    );
  }

  if (current.humanDecision !== 'pending') {
    return NextResponse.json(
      { error: `This verdict was already ${current.humanDecision}` },
      { status: 409 },
    );
  }

  if (!current.proposedDiff) {
    return NextResponse.json(
      { error: 'This verdict is not actionable' },
      { status: 400 },
    );
  }

  const entry: AuditEntry = {
    verdictId: current.verdictId,
    acId: current.acId,
    kind: current.kind,
    confidence: current.confidence,
    reasoning: current.reasoning,
    failure: current.failure,
    model: current.model,
    proposedDiffHash: createHash('sha256').update(current.proposedDiff).digest('hex').slice(0, 12),
    proposedDiff: current.proposedDiff,
    humanDecision: decision,
    decidedBy: userInfo().username,
    timestamp: new Date().toISOString(),
  };

  const logPath = resolve(join(process.cwd(), '..', '.sentinel', 'audit.jsonl'));

  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');

  return NextResponse.json({ ok: true });
}
