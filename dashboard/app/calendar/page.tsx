'use client';

import { useEffect, useState } from 'react';
import { api, type CalendarEvent } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import Link from 'next/link';

function PrepButton({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);

  const handlePrep = async () => {
    setLoading(true);
    try {
      const data = await api.meetingPrep(eventId);
      setBrief(data.brief);
    } catch (e: unknown) {
      setBrief(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
    setLoading(false);
  };

  if (brief) {
    return (
      <div className="mt-2 p-3 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs whitespace-pre-wrap">
        {brief}
      </div>
    );
  }

  return (
    <button
      onClick={handlePrep}
      disabled={loading}
      className="mt-2 text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
    >
      {loading ? 'Generating prep...' : 'Generate prep brief'}
    </button>
  );
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.events()
      .then(d => setEvents(d.events))
      .catch(e => setError(e.message));
  }, []);

  // Group events by date
  const grouped = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    const date = new Date(e.start_time).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(e);
    return acc;
  }, {});

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back</Link>
          <h1 className="text-2xl font-semibold mt-2">Calendar</h1>
          <p className="text-sm text-[var(--text-muted)]">Next 7 days</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      <div className="space-y-8">
        {Object.entries(grouped).map(([date, dayEvents]) => (
          <div key={date}>
            <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3 uppercase tracking-wide">{date}</h2>
            <div className="space-y-2">
              {dayEvents.map(e => {
                const start = new Date(e.start_time);
                const end = new Date(e.end_time);
                const durationMin = (end.getTime() - start.getTime()) / 60000;
                const durationStr = durationMin >= 60
                  ? `${(durationMin / 60).toFixed(durationMin % 60 ? 1 : 0)}h`
                  : `${durationMin}m`;

                return (
                  <div key={e.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="flex gap-4 p-4">
                      <div className="shrink-0 w-20 text-right">
                        <div className="text-sm font-medium">{formatTime(e.start_time)}</div>
                        <div className="text-xs text-[var(--text-muted)]">{durationStr}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{e.subject}</div>
                        {e.location && (
                          <div className="text-sm text-[var(--text-muted)] mt-0.5">{e.location}</div>
                        )}
                        {e.attendees.length > 0 && (
                          <div className="text-xs text-[var(--text-muted)] mt-1">
                            {e.attendees.slice(0, 5).map(a => a.name || a.email).join(', ')}
                            {e.attendees.length > 5 && ` +${e.attendees.length - 5}`}
                          </div>
                        )}
                        <PrepButton eventId={e.id} />
                      </div>
                      {e.is_recurring === 1 && (
                        <span className="shrink-0 text-xs text-[var(--text-muted)]">recurring</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {events.length === 0 && !error && (
          <div className="text-center py-16 text-[var(--text-muted)]">
            No upcoming events. Sync from Outlook to populate.
          </div>
        )}
      </div>
    </div>
  );
}
