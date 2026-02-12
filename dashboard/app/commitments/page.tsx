'use client';

import { useEffect, useState } from 'react';
import { api, type Commitment } from '@/lib/api';
import Link from 'next/link';

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.commitments(filter || undefined)
      .then(d => setCommitments(d.commitments))
      .catch(e => setError(e.message));
  }, [filter]);

  const statusColor = (s: string) => {
    switch (s) {
      case 'overdue': return 'text-red-400';
      case 'open': return 'text-amber-400';
      case 'done': return 'text-green-400';
      default: return 'text-[var(--text-muted)]';
    }
  };

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back</Link>
        <h1 className="text-2xl font-semibold mt-2">Commitments</h1>
        <p className="text-sm text-[var(--text-muted)]">Tracked follow-ups and promises</p>
      </div>

      <div className="flex gap-1 mb-6">
        {['', 'open', 'overdue', 'done'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filter === s
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      <div className="space-y-2">
        {commitments.map(c => (
          <div key={c.id} className="flex items-start gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{c.description}</div>
              <div className="text-sm text-[var(--text-muted)] mt-1">
                {c.owner}
                {c.due_date && <span> · due {c.due_date}</span>}
                {c.nudge_count > 0 && <span> · nudged {c.nudge_count}x</span>}
              </div>
            </div>
            <span className={`text-xs font-medium uppercase ${statusColor(c.status)}`}>
              {c.status}
            </span>
          </div>
        ))}

        {commitments.length === 0 && !error && (
          <div className="text-center py-16 text-[var(--text-muted)]">
            No commitments tracked yet.
          </div>
        )}
      </div>
    </div>
  );
}
