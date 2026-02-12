'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface SenderRule {
  email_pattern: string;
  priority_boost: number;
  label: string;
}

const PRESETS = [
  { label: 'Critical (always P0)', boost: 5, color: 'var(--p0)' },
  { label: 'Important (boost to P1)', boost: 3, color: 'var(--p1)' },
  { label: 'Watch (slight boost)', boost: 1, color: 'var(--p2)' },
  { label: 'Deprioritize', boost: -3, color: 'var(--p3)' },
];

export default function SettingsPage() {
  const [rules, setRules] = useState<SenderRule[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newBoost, setNewBoost] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.senderRules();
      setRules(data.rules);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addRule = async () => {
    if (!newEmail.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.addSenderRule({
        email_pattern: newEmail.trim().toLowerCase(),
        priority_boost: newBoost,
        label: newLabel.trim() || tierLabel(newBoost),
      });
      setNewEmail('');
      setNewLabel('');
      setNewBoost(3);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
    setSaving(false);
  };

  const tierLabel = (boost: number) => {
    if (boost >= 5) return 'Critical';
    if (boost >= 3) return 'Important';
    if (boost >= 1) return 'Watch';
    return 'Deprioritized';
  };

  const tierColor = (boost: number) => {
    if (boost >= 5) return 'var(--p0)';
    if (boost >= 3) return 'var(--p1)';
    if (boost >= 1) return 'var(--p2)';
    return 'var(--p3)';
  };

  // Group rules by tier
  const critical = rules.filter(r => r.priority_boost >= 5);
  const important = rules.filter(r => r.priority_boost >= 3 && r.priority_boost < 5);
  const watch = rules.filter(r => r.priority_boost >= 1 && r.priority_boost < 3);
  const deprioritized = rules.filter(r => r.priority_boost < 1);

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <Link href="/" className="text-sm text-[var(--accent)] hover:underline">Back</Link>
        <h1 className="text-2xl font-semibold mt-2">Settings</h1>
        <p className="text-sm text-[var(--text-muted)]">VIP senders, priority rules, and preferences</p>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Add new rule */}
      <div className="mb-8 p-5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <h2 className="text-sm font-medium mb-4">Add VIP Sender</h2>
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="email@company.com or %@domain.com for whole domain"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder-[var(--text-muted)]"
              onKeyDown={e => e.key === 'Enter' && addRule()}
            />
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-48 px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder-[var(--text-muted)]"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)] w-12">Priority:</span>
            <div className="flex gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.boost}
                  onClick={() => setNewBoost(p.boost)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    newBoost === p.boost
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={addRule}
              disabled={saving || !newEmail.trim()}
              className="ml-auto px-4 py-1.5 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          Use <code className="text-[var(--text)] opacity-60">%@domain.com</code> to match an entire domain.
          Exact emails like <code className="text-[var(--text)] opacity-60">boss@company.com</code> match that sender only.
        </p>
      </div>

      {/* Rules by tier */}
      {[
        { title: 'Critical — Always P0', rules: critical, color: 'var(--p0)', desc: 'These emails jump to the top. Security alerts, your boss, escalations.' },
        { title: 'Important — Boosted to P1', rules: important, color: 'var(--p1)', desc: 'Your team, key stakeholders, direct reports.' },
        { title: 'Watch', rules: watch, color: 'var(--p2)', desc: 'Worth paying attention to, slight priority bump.' },
        { title: 'Deprioritized', rules: deprioritized, color: 'var(--p3)', desc: 'Newsletters, automated reports, noise.' },
      ].map(tier => (
        <div key={tier.title} className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: tier.color }} />
            <h3 className="text-sm font-medium">{tier.title}</h3>
            <span className="text-xs text-[var(--text-muted)]">({tier.rules.length})</span>
          </div>
          {tier.rules.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] ml-5">{tier.desc}</p>
          ) : (
            <div className="ml-5 space-y-1">
              {tier.rules.map(r => (
                <div key={r.email_pattern} className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[var(--bg-hover)] transition-colors group">
                  <span className="text-sm font-mono">{r.email_pattern}</span>
                  {r.label && (
                    <span className="text-xs text-[var(--text-muted)]">{r.label}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Tips */}
      <div className="mt-12 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <h3 className="text-sm font-medium mb-2">How priority works</h3>
        <ul className="text-xs text-[var(--text-muted)] space-y-1">
          <li>Every incoming email gets a score from rule signals (direct To:, keywords like "urgent", thread state, age, distribution size)</li>
          <li>VIP sender rules add a boost to that score — Critical adds +50, Important +30, Watch +10</li>
          <li>Borderline scores (not clearly P0 or P3) get a second pass from the LLM for nuance</li>
          <li>You can always override any classification manually on the thread page</li>
          <li>Unknown senders default to rule-based scoring — important-sounding emails from new people still surface</li>
        </ul>
      </div>
    </div>
  );
}
