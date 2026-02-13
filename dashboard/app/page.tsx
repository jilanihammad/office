'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, type Brief, type Health, type Thread } from '@/lib/api';
import { timeAgo, formatTime, priorityBg } from '@/lib/utils';
import Link from 'next/link';

export default function Dashboard() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, h, t] = await Promise.all([
        api.brief(),
        api.health(),
        api.threads(filter || undefined),
      ]);
      setBrief(b);
      setHealth(h);
      setThreads(t.threads);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.sync();
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    }
    setSyncing(false);
  };

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Office</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {health ? `${health.threads} threads · ${health.events} events` : 'Loading...'}
            {health?.lastMailSync && ` · Synced ${timeAgo(health.lastMailSync)}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/search" className="px-3 py-1.5 text-sm rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            Search
          </Link>
          <Link href="/calendar" className="px-3 py-1.5 text-sm rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            Calendar
          </Link>
          <Link href="/commitments" className="px-3 py-1.5 text-sm rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            Commitments
          </Link>
          <Link href="/settings" className="px-3 py-1.5 text-sm rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-hover)] transition-colors">
            Settings
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Command Brief */}
      {brief && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Urgent */}
          <BriefCard
            title="Must Decide Now"
            count={brief.mustDecideNow.length}
            color="var(--p0)"
            items={brief.mustDecideNow.map(t => ({
              id: t.conversation_id,
              text: t.subject,
              sub: t.latest_message?.sender_name || '',
              time: t.latest_message_at,
            }))}
          />

          {/* Today's Meetings */}
          <BriefCard
            title="Today's Meetings"
            count={brief.todayMeetings.length}
            color="var(--accent)"
            stat={`${brief.stats.meetingHoursToday}h in meetings`}
            items={brief.todayMeetings.map(e => ({
              id: e.id,
              text: e.subject,
              sub: e.location || e.organizer_name,
              time: e.start_time,
              isTime: true,
            }))}
          />

          {/* Follow-ups */}
          <BriefCard
            title="Follow-ups Due"
            count={brief.overdueFollowUps.length + brief.dueSoon.length}
            color="var(--p1)"
            items={[
              ...brief.overdueFollowUps.map(c => ({
                id: String(c.id),
                text: c.description,
                sub: `overdue · ${c.owner}`,
                time: c.due_date,
              })),
              ...brief.dueSoon.map(c => ({
                id: String(c.id),
                text: c.description,
                sub: c.owner,
                time: c.due_date,
              })),
            ]}
          />
        </div>
      )}

      {/* Inbox */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-medium">Inbox</h2>
          <div className="flex gap-1">
            {['', 'P0', 'P1', 'P2', 'P3'].map(p => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  filter === p
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {p || 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {threads.map(t => (
            <Link
              key={t.conversation_id}
              href={`/thread/${encodeURIComponent(t.conversation_id)}`}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-hover)] transition-colors group"
            >
              <span
                className={`mt-1 shrink-0 inline-flex items-center justify-center w-7 h-5 text-[10px] font-bold rounded border ${priorityBg(t.priority)}`}
              >
                {t.priority}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium truncate">
                    {t.subject || '(no subject)'}
                  </span>
                  {t.needs_reply === 1 && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      needs reply
                    </span>
                  )}
                </div>
                <div className="text-sm text-[var(--text-muted)] truncate">
                  {t.latest_message?.sender_name && (
                    <span className="text-[var(--text)] opacity-70">{t.latest_message.sender_name}: </span>
                  )}
                  {t.latest_message?.body_preview || t.label}
                </div>
              </div>
              <div className="shrink-0 text-xs text-[var(--text-muted)]">
                {t.latest_message_at ? timeAgo(t.latest_message_at) : ''}
                {t.message_count > 1 && (
                  <span className="ml-1 opacity-50">({t.message_count})</span>
                )}
              </div>
            </Link>
          ))}

          {threads.length === 0 && !error && (
            <div className="text-center py-16 text-[var(--text-muted)]">
              {health?.threads === 0
                ? 'No emails synced yet. Click "Sync Now" to pull from Outlook.'
                : 'No threads match this filter.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefCard({ title, count, color, stat, items }: {
  title: string;
  count: number;
  color: string;
  stat?: string;
  items: { id: string; text: string; sub: string; time: string; isTime?: boolean }[];
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color }}>{title}</h3>
        <span className="text-2xl font-semibold" style={{ color }}>{count}</span>
      </div>
      {stat && <p className="text-xs text-[var(--text-muted)] mb-2">{stat}</p>}
      <div className="space-y-2">
        {items.slice(0, 5).map(item => (
          <div key={item.id} className="text-sm">
            <div className="truncate">{item.text}</div>
            <div className="text-xs text-[var(--text-muted)]">
              {item.sub}
              {item.time && (
                <span className="ml-1">
                  · {item.isTime ? formatTime(item.time) : timeAgo(item.time)}
                </span>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">Nothing here</p>
        )}
        {items.length > 5 && (
          <p className="text-xs text-[var(--text-muted)]">+{items.length - 5} more</p>
        )}
      </div>
    </div>
  );
}
