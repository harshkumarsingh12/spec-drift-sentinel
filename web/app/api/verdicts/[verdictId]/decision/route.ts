import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

import { findVerdict } from '@/lib/mock-data';
import type { HumanDecision } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ verdictId: string }> },
) {
  const { verdictId } = await params;

  const verdict = findVerdict(verdictId);

  if (!verdict) {
    return NextResponse.json(
      { error: 'Verdict not found' },
      { status: 404 },
    );
  }

  const body = await request.json();
  const decision = body.decision as HumanDecision;

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json(
      { error: 'Decision must be approved or rejected' },
      { status: 400 },
    );
  }

  if (!verdict.proposedDiff) {
    return NextResponse.json(
      { error: 'This verdict is not actionable' },
      { status: 400 },
    );
  }

  const proposedDiffHash = createHash('sha256')
    .update(verdict.proposedDiff)
    .digest('hex')
    .slice(0, 12);

  const entry = {
    verdictId: verdict.id,
    acId: verdict.acId,
    kind: verdict.kind,
    reasoning: verdict.reasoning,
    model: verdict.model,
    proposedDiffHash,
    humanDecision: decision,
    decidedBy: 'local-user',
    timestamp: new Date().toISOString(),
  };

  const logPath = join(process.cwd(), '..', '.sentinel', 'audit.jsonl');

  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');

  return NextResponse.json({ ok: true });
}
