'use client';

import { useEffect, useState, use } from 'react';
import { api, type ThreadDetail } from '@/lib/api';
import { timeAgo, formatDate, priorityBg } from '@/lib/utils';
import Link from 'next/link';

function DraftActions({ conversationId, onDraft }: { conversationId: string; onDraft: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);

  const generate = async (variant: 'concise' | 'full') => {
    setGenerating(true);
    try {
      await api.draft(conversationId, variant, instructions || undefined);
      onDraft();
      setInstructions('');
      setShowInstructions(false);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Draft failed');
    }
    setGenerating(false);
  };

  return (
    <div className="flex items-center gap-2">
      {showInstructions && (
        <input
          type="text"
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          placeholder="e.g. decline politely, ask for more time..."
          className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] w-64"
        />
      )}
      <button
        onClick={() => setShowInstructions(!showInstructions)}
        className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
      >
        {showInstructions ? 'Hide' : 'Instructions'}
      </button>
      <button
        onClick={() => generate('concise')}
        disabled={generating}
        className="px-2.5 py-1 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
      >
        {generating ? 'Drafting...' : 'Quick Reply'}
      </button>
      <button
        onClick={() => generate('full')}
        disabled={generating}
        className="px-2.5 py-1 text-xs rounded border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
      >
        Full Reply
      </button>
    </div>
  );
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overriding, setOverriding] = useState(false);

  useEffect(() => {
    api.thread(decodeURIComponent(id))
      .then(setData)
      .catch(e => setError(e.message));
  }, [id]);

  const handleOverride = async (priority: string) => {
    setOverriding(true);
    try {
      await api.override(decodeURIComponent(id), priority);
      const updated = await api.thread(decodeURIComponent(id));
      setData(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Override failed');
    }
    setOverriding(false);
  };

  if (error) return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back</Link>
      <div className="mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="text-[var(--text-muted)]">Loading...</div>
    </div>
  );

  const { thread, messages, classification, drafts } = data;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Nav */}
      <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back to inbox</Link>

      {/* Header */}
      <div className="mt-4 mb-6">
        <div className="flex items-start gap-3">
          {classification && (
            <span className={`mt-1 shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-bold rounded border ${priorityBg(classification.priority)}`}>
              {classification.priority} — {classification.label}
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold mt-2">{thread.subject || '(no subject)'}</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {thread.message_count} messages · {thread.participants?.length || 0} participants
        </p>
      </div>

      {/* Classification details */}
      {classification && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Triage</h3>
            <div className="flex gap-1">
              {['P0', 'P1', 'P2', 'P3'].map(p => (
                <button
                  key={p}
                  onClick={() => handleOverride(p)}
                  disabled={overriding}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    classification.priority === p
                      ? priorityBg(p)
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {classification.llm_rationale && (
            <p className="text-sm text-[var(--text-muted)]">{classification.llm_rationale}</p>
          )}
          {classification.rule_signals && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(typeof classification.rule_signals === 'string'
                ? JSON.parse(classification.rule_signals)
                : classification.rule_signals
              ).map((s: string) => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-muted)]">
                  {s}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Confidence: {(classification.confidence * 100).toFixed(0)}%
            {classification.needs_reply === 1 && ' · Needs reply'}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="space-y-4">
        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={`p-4 rounded-lg border ${
              i === messages.length - 1
                ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                : 'border-[var(--border)] bg-[var(--bg-card)]'
            }`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <span className="font-medium text-sm">{msg.sender_name || msg.sender_email}</span>
                {msg.sender_name && (
                  <span className="text-xs text-[var(--text-muted)] ml-2">{msg.sender_email}</span>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {formatDate(msg.received_at)} · {timeAgo(msg.received_at)}
              </span>
            </div>
            <div className="text-sm whitespace-pre-wrap leading-relaxed opacity-90">
              {msg.body_text || msg.body_preview}
            </div>
            {msg.has_attachments === 1 && (
              <div className="mt-2 text-xs text-[var(--text-muted)]">📎 Has attachments</div>
            )}
          </div>
        ))}
      </div>

      {/* Draft Generation */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Reply Drafts</h3>
          <DraftActions conversationId={decodeURIComponent(id)} onDraft={async () => {
            const updated = await api.thread(decodeURIComponent(id));
            setData(updated);
          }} />
        </div>
        <div className="space-y-3">
          {drafts.map(d => (
            <div key={d.id} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-medium uppercase text-[var(--text-muted)]">
                  {d.variant} · {d.status}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{timeAgo(d.created_at)}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{d.body_text}</div>
              <button
                onClick={() => navigator.clipboard.writeText(d.body_text)}
                className="mt-2 text-xs text-[var(--accent)] hover:underline"
              >
                Copy to clipboard
              </button>
            </div>
          ))}
          {drafts.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">No drafts yet. Generate one above.</p>
          )}
        </div>
      </div>
    </div>
  );
}
