'use client';

import { useState } from 'react';

export default function DecisionButtons({
  verdictId,
}: {
  verdictId: string;
}) {
  const [loading, setLoading] = useState(false);

  async function decide(decision: 'approved' | 'rejected') {
    setLoading(true);

    try {
      const response = await fetch(`/api/verdicts/${verdictId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) {
        throw new Error('Failed to record decision');
      }

      window.location.href = '/inbox';
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  }

  return (
    <div className="actions">
      <button
        className="btn"
        data-testid="approve-button"
        type="button"
        disabled={loading}
        onClick={() => decide('approved')}
      >
        Approve
      </button>

      <button
        className="btn"
        data-testid="reject-button"
        type="button"
        disabled={loading}
        onClick={() => decide('rejected')}
      >
        Reject
      </button>
    </div>
  );
}
