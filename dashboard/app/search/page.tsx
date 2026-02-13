'use client';

import { useState } from 'react';
import { timeAgo, priorityBg } from '@/lib/utils';
import Link from 'next/link';

interface SearchResults {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emails: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitments: any[];
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [tab, setTab] = useState<'all' | 'email' | 'event' | 'commitment'>('all');

  const handleSearch = async (q?: string) => {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}${tab !== 'all' ? `&type=${tab}` : ''}`);
      const data = await res.json();
      setResults(data);
    } catch {
      setResults({ emails: [], events: [], commitments: [] });
    }
    setSearching(false);
  };

  const total = results
    ? results.emails.length + results.events.length + results.commitments.length
    : 0;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back</Link>
        <h1 className="text-2xl font-semibold mt-2">Search</h1>
      </div>

      {/* Search input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search emails, events, commitments..."
          className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text)] placeholder-[var(--text-muted)] text-sm focus:outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <button
          onClick={() => handleSearch()}
          disabled={searching}
          className="px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {(['all', 'email', 'event', 'commitment'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (query) handleSearch(); }}
            className={`px-3 py-1 text-xs rounded-full border transition-colors capitalize ${
              tab === t
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            {t === 'all' ? 'All' : `${t}s`}
          </button>
        ))}
        {results && (
          <span className="text-xs text-[var(--text-muted)] self-center ml-2">{total} results</span>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-6">
          {/* Emails */}
          {results.emails.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">Emails ({results.emails.length})</h2>
              <div className="space-y-1">
                {results.emails.map(e => (
                  <Link
                    key={e.id}
                    href={`/thread/${encodeURIComponent(e.conversation_id)}`}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    {e.priority && (
                      <span className={`mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${priorityBg(e.priority)}`}>
                        {e.priority}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{e.subject || '(no subject)'}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {e.sender_name || e.sender_email} · {timeAgo(e.received_at)}
                      </div>
                      <div
                        className="text-xs text-[var(--text-muted)] mt-0.5 [&_mark]:bg-amber-500/30 [&_mark]:text-[var(--text)]"
                        dangerouslySetInnerHTML={{ __html: e.snippet }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Events */}
          {results.events.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">Events ({results.events.length})</h2>
              <div className="space-y-1">
                {results.events.map(e => (
                  <div key={e.id} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                    <div className="font-medium text-sm">{e.subject}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {e.start_time && new Date(e.start_time).toLocaleString()} · {e.location}
                    </div>
                    {e.snippet && (
                      <div
                        className="text-xs text-[var(--text-muted)] mt-1 [&_mark]:bg-amber-500/30 [&_mark]:text-[var(--text)]"
                        dangerouslySetInnerHTML={{ __html: e.snippet }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commitments */}
          {results.commitments.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">Commitments ({results.commitments.length})</h2>
              <div className="space-y-1">
                {results.commitments.map(c => (
                  <div key={c.id} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                    <div className="text-sm">{c.description}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {c.owner}{c.due_date && ` · due ${c.due_date}`} · {c.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {total === 0 && (
            <div className="text-center py-16 text-[var(--text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
