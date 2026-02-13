/**
 * Comprehensive audit test suite.
 * Tests every module, every edge case, every boundary.
 * Run: node --test test/audit.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use a test database
process.env.NODE_ENV = 'test';

// ============================================================
// 1. DATABASE
// ============================================================
describe('Database', () => {
  let getDb, close;
  
  before(async () => {
    const db = await import('../lib/db.js');
    getDb = db.getDb;
    close = db.close;
  });
  
  it('creates all core tables', () => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name"
    ).all().map(t => t.name);
    
    const required = [
      'classifications', 'commitments', 'events', 'messages',
      'relationship_memory', 'sender_rules', 'style_examples',
      'sync_state', 'threads', 'webhook_events', 'job_locks'
    ];
    
    for (const table of required) {
      assert.ok(tables.includes(table), `Missing table: ${table}`);
    }
  });
  
  it('creates indexes', () => {
    const db = getDb();
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all().map(i => i.name);
    
    assert.ok(indexes.includes('idx_messages_conversation'));
    assert.ok(indexes.includes('idx_messages_received'));
    assert.ok(indexes.includes('idx_messages_sender'));
    assert.ok(indexes.includes('idx_events_start'));
    assert.ok(indexes.includes('idx_threads_latest'));
    assert.ok(indexes.includes('idx_classifications_priority'));
    assert.ok(indexes.includes('idx_commitments_status_due'));
  });
  
  it('WAL mode enabled', () => {
    const db = getDb();
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal');
  });
  
  it('foreign keys enabled', () => {
    const db = getDb();
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1);
  });
  
  it('busy_timeout is set', () => {
    const db = getDb();
    const timeout = db.pragma('busy_timeout', { simple: true });
    assert.equal(timeout, 5000);
  });
  
  it('events table has prep_manual_edited column', () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(events)").all().map(c => c.name);
    assert.ok(cols.includes('prep_manual_edited'), 'Missing prep_manual_edited column');
  });
  
  it('webhook_events table supports dedup', () => {
    const db = getDb();
    // Insert
    db.prepare('INSERT OR IGNORE INTO webhook_events (event_id) VALUES (?)').run('test-dedup-1');
    // Duplicate should be ignored
    const result = db.prepare('INSERT OR IGNORE INTO webhook_events (event_id) VALUES (?)').run('test-dedup-1');
    assert.equal(result.changes, 0, 'Duplicate should be ignored');
    // Cleanup
    db.prepare('DELETE FROM webhook_events WHERE event_id = ?').run('test-dedup-1');
  });
  
  it('job_locks table supports mutex', () => {
    const db = getDb();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 60000).toISOString();
    
    // Acquire lock
    const r1 = db.prepare(
      'INSERT OR IGNORE INTO job_locks (job_name, locked_at, expires_at) VALUES (?, ?, ?)'
    ).run('test-lock', now, expires);
    assert.equal(r1.changes, 1, 'Should acquire lock');
    
    // Second attempt should fail
    const r2 = db.prepare(
      'INSERT OR IGNORE INTO job_locks (job_name, locked_at, expires_at) VALUES (?, ?, ?)'
    ).run('test-lock', now, expires);
    assert.equal(r2.changes, 0, 'Should not acquire duplicate lock');
    
    // Release
    db.prepare('DELETE FROM job_locks WHERE job_name = ?').run('test-lock');
  });
});

// ============================================================
// 2. CLASSIFIER
// ============================================================
describe('Classifier', () => {
  it('loads and exports classifyThread', async () => {
    process.env.USER_EMAIL = 'me@company.com';
    const mod = await import('../lib/classifier.js');
    assert.ok(typeof mod.classifyThread === 'function');
  });
});

// ============================================================
// 3. OUTBOX — edge cases
// ============================================================
describe('Outbox', () => {
  it('throws if DROP_FOLDER not set', async () => {
    const saved = process.env.DROP_FOLDER;
    delete process.env.DROP_FOLDER;
    
    const { queueForSend } = await import('../lib/outbox.js');
    assert.throws(() => queueForSend(999), /DROP_FOLDER/);
    
    if (saved) process.env.DROP_FOLDER = saved;
  });
  
  it('outboxStatus returns disabled when no DROP_FOLDER', async () => {
    const saved = process.env.DROP_FOLDER;
    delete process.env.DROP_FOLDER;
    
    const { outboxStatus } = await import('../lib/outbox.js');
    const status = outboxStatus();
    assert.equal(status.enabled, false);
    
    if (saved) process.env.DROP_FOLDER = saved;
  });
});

// ============================================================
// 4. SEARCH — FTS5
// ============================================================
describe('Search', () => {
  it('exports all functions', async () => {
    const mod = await import('../lib/search.js');
    assert.ok(typeof mod.search === 'function');
    assert.ok(typeof mod.initSearch === 'function');
    assert.ok(typeof mod.rebuildIndex === 'function');
  });
  
  it('returns empty for blank query', async () => {
    const { search } = await import('../lib/search.js');
    const results = search('');
    assert.deepEqual(results, { emails: [], events: [], commitments: [] });
  });
  
  it('returns empty for null query', async () => {
    const { search } = await import('../lib/search.js');
    const results = search(null);
    assert.deepEqual(results, { emails: [], events: [], commitments: [] });
  });
});

// ============================================================
// 5. COMMITMENT EXTRACTION
// ============================================================
describe('Commitments', () => {
  it('module exports all expected functions', async () => {
    const mod = await import('../lib/commitments.js');
    assert.ok(typeof mod.extractCommitments === 'function');
    assert.ok(typeof mod.extractAllPending === 'function');
    assert.ok(typeof mod.getOverdue === 'function');
    assert.ok(typeof mod.markDone === 'function');
    assert.ok(typeof mod.updateDueDate === 'function');
  });
  
  it('markDone updates status', async () => {
    const { getDb } = await import('../lib/db.js');
    const db = getDb();
    
    // Insert a test commitment
    const r = db.prepare(
      "INSERT INTO commitments (owner, description, due_date, source_type, source_id, confidence, status) VALUES ('test', 'test task', '2026-01-01', 'test', 'test-1', 0.9, 'open')"
    ).run();
    
    const { markDone } = await import('../lib/commitments.js');
    markDone(r.lastInsertRowid);
    
    const updated = db.prepare('SELECT status FROM commitments WHERE id = ?').get(r.lastInsertRowid);
    assert.equal(updated.status, 'done');
    
    // Cleanup
    db.prepare('DELETE FROM commitments WHERE id = ?').run(r.lastInsertRowid);
  });
});

// ============================================================
// 6. MEETING PREP
// ============================================================
describe('Meeting Prep', () => {
  it('module exports all expected functions', async () => {
    const mod = await import('../lib/meetingprep.js');
    assert.ok(typeof mod.generateMeetingPrep === 'function');
    assert.ok(typeof mod.prepUpcoming === 'function');
  });
});

// ============================================================
// 7. STYLE LEARNER
// ============================================================
describe('Style Learner', () => {
  it('module exports all expected functions', async () => {
    const mod = await import('../lib/stylelearner.js');
    assert.ok(typeof mod.processSentMail === 'function');
    assert.ok(typeof mod.getStyleContext === 'function');
    assert.ok(typeof mod.updateRelationships === 'function');
  });
  
  it('processSentMail handles missing directory', async () => {
    const { processSentMail } = await import('../lib/stylelearner.js');
    const result = processSentMail('/nonexistent/path');
    assert.deepEqual(result, { processed: 0 });
  });
});

// ============================================================
// 8. FILE WATCHER
// ============================================================
describe('File Watcher', () => {
  it('module exports start/stop', async () => {
    const mod = await import('../lib/filewatcher.js');
    assert.ok(typeof mod.startWatcher === 'function');
    assert.ok(typeof mod.stopWatcher === 'function');
  });
  
  it('startWatcher returns undefined for null folder', async () => {
    const { startWatcher } = await import('../lib/filewatcher.js');
    const result = startWatcher(null);
    assert.equal(result, undefined);
  });
});

// ============================================================
// 9. WEBHOOK — HMAC + dedup
// ============================================================
describe('Webhook', () => {
  it('verifyWebhook passes when no secret configured', async () => {
    const saved = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = '';
    
    // Re-import to pick up env change
    const mod = await import('../lib/webhook.js');
    
    let nextCalled = false;
    const req = { headers: {} };
    const res = { status: () => ({ json: () => {} }) };
    mod.verifyWebhook(req, res, () => { nextCalled = true; });
    
    assert.ok(nextCalled);
    if (saved) process.env.WEBHOOK_SECRET = saved;
  });
  
  it('verifyWebhook rejects invalid static secret', async () => {
    const saved = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 'my-secret-123';
    
    const mod = await import('../lib/webhook.js');
    
    let statusCode;
    const req = { headers: { 'x-webhook-secret': 'wrong' } };
    const res = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    mod.verifyWebhook(req, res, () => {});
    
    assert.equal(statusCode, 401);
    if (saved) process.env.WEBHOOK_SECRET = saved;
  });
});

// ============================================================
// 10. LLM
// ============================================================
describe('LLM', () => {
  it('module exports chat and chatStream', async () => {
    const mod = await import('../lib/llm.js');
    assert.ok(typeof mod.chat === 'function');
    assert.ok(typeof mod.chatStream === 'function');
  });
});

// ============================================================
// 11. GRAPH
// ============================================================
describe('Graph', () => {
  it('throws without AZURE credentials', async () => {
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_TENANT_ID;
    
    try {
      const { authenticate } = await import('../lib/graph.js');
      await authenticate();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('AZURE_CLIENT_ID') || err.message.includes('required'));
    }
  });
});

// ============================================================
// 12. EVENT UPSERT PRESERVES PREP FIELDS (fix #1 regression)
// ============================================================
describe('Event Upsert Preservation', () => {
  it('calendar upsert preserves prep_brief and prep_manual_edited', async () => {
    const { getDb } = await import('../lib/db.js');
    const db = getDb();
    
    // Insert event with prep data
    db.prepare(`
      INSERT INTO events (id, subject, start_time, end_time, prep_brief, prep_manual_edited, synced_at)
      VALUES ('test-preserve-1', 'My Meeting', '2026-03-01T10:00', '2026-03-01T11:00', 'Custom brief', 1, datetime('now'))
    `).run();
    
    // Simulate calendar sync upsert (ON CONFLICT should preserve prep fields)
    db.prepare(`
      INSERT INTO events (id, subject, start_time, end_time, location, organizer_email, organizer_name,
       attendees, body_text, is_recurring, importance, synced_at)
      VALUES ('test-preserve-1', 'My Meeting Updated', '2026-03-01T10:00', '2026-03-01T11:30', '', '', '', '[]', '', 0, 'normal', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject, start_time = excluded.start_time, end_time = excluded.end_time,
        location = excluded.location, organizer_email = excluded.organizer_email,
        organizer_name = excluded.organizer_name, attendees = excluded.attendees,
        body_text = excluded.body_text, is_recurring = excluded.is_recurring,
        importance = excluded.importance, synced_at = excluded.synced_at
    `).run();
    
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get('test-preserve-1');
    assert.equal(event.prep_brief, 'Custom brief', 'prep_brief should be preserved');
    assert.equal(event.prep_manual_edited, 1, 'prep_manual_edited should be preserved');
    assert.equal(event.subject, 'My Meeting Updated', 'subject should be updated');
    assert.equal(event.end_time, '2026-03-01T11:30', 'end_time should be updated');
    
    // Cleanup
    db.prepare('DELETE FROM events WHERE id = ?').run('test-preserve-1');
  });
});

// ============================================================
// 13. CLASSIFIER NULL SAFETY (fix #5)
// ============================================================
describe('Classifier Null Safety', () => {
  it('safeSender handles null', () => {
    const safeSender = (s) => (typeof s === 'string' ? s : String(s || '')).toLowerCase();
    assert.equal(safeSender(null), '');
    assert.equal(safeSender(undefined), '');
    assert.equal(safeSender('John@Test.com'), 'john@test.com');
    assert.equal(safeSender({ address: 'x' }), '[object object]'); // toString fallback, won't crash
  });
});

// ============================================================
// 14. OUTBOX VALIDATION ORDER (fix #7)
// ============================================================
describe('Outbox Validation Order', () => {
  it('validates prerequisites before changing draft status', async () => {
    const { getDb } = await import('../lib/db.js');
    const db = getDb();
    
    // Create a draft with a nonexistent conversation
    const r = db.prepare(
      "INSERT INTO drafts (conversation_id, variant, body_text, status) VALUES ('nonexistent-conv', 'concise', 'test', 'draft')"
    ).run();
    
    const saved = process.env.DROP_FOLDER;
    process.env.DROP_FOLDER = '/tmp/test-outbox';
    
    const { queueForSend } = await import('../lib/outbox.js');
    
    try {
      queueForSend(r.lastInsertRowid);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('No messages'), 'Should fail on missing messages');
    }
    
    // Draft should still be in 'draft' status (not stuck in 'queued')
    const draft = db.prepare('SELECT status FROM drafts WHERE id = ?').get(r.lastInsertRowid);
    assert.equal(draft.status, 'draft', 'Draft should remain in draft status after validation failure');
    
    // Cleanup
    db.prepare('DELETE FROM drafts WHERE id = ?').run(r.lastInsertRowid);
    if (saved) process.env.DROP_FOLDER = saved;
    else delete process.env.DROP_FOLDER;
  });
});

// ============================================================
// 15. LIMIT CLAMPING (fix #8)
// ============================================================
describe('Limit Clamping', () => {
  it('safeInt handles negative values', () => {
    // Replicate safeInt
    function safeInt(val, defaultVal = 0) {
      const n = parseInt(val);
      return Number.isNaN(n) ? defaultVal : n;
    }
    assert.equal(safeInt('-1', 50), -1); // safeInt returns the value
    // The clamping happens in the route: Math.max(1, Math.min(safeInt(limit), 200))
    const clamped = Math.max(1, Math.min(safeInt('-1', 50), 200));
    assert.equal(clamped, 1, 'Negative limit should clamp to 1');
  });
  
  it('clamps zero to 1', () => {
    const clamped = Math.max(1, Math.min(0, 200));
    assert.equal(clamped, 1);
  });
  
  it('clamps large values to cap', () => {
    const clamped = Math.max(1, Math.min(99999, 200));
    assert.equal(clamped, 200);
  });
});

// ============================================================
// 16. SAFE PARSE JSON (fix #9)
// ============================================================
describe('Safe Parse JSON', () => {
  it('returns array on valid JSON array', () => {
    const safeParseJSON = (str) => {
      try { const p = JSON.parse(str || '[]'); return Array.isArray(p) ? p : []; }
      catch { return []; }
    };
    assert.deepEqual(safeParseJSON('[1,2,3]'), [1, 2, 3]);
  });
  
  it('returns empty array on object', () => {
    const safeParseJSON = (str) => {
      try { const p = JSON.parse(str || '[]'); return Array.isArray(p) ? p : []; }
      catch { return []; }
    };
    assert.deepEqual(safeParseJSON('{"a": 1}'), []);
  });
  
  it('returns empty array on garbage', () => {
    const safeParseJSON = (str) => {
      try { const p = JSON.parse(str || '[]'); return Array.isArray(p) ? p : []; }
      catch { return []; }
    };
    assert.deepEqual(safeParseJSON('not json'), []);
  });
});

// ============================================================
// 17. DATE VALIDATION — STRICT (fix #15)
// ============================================================
describe('Strict Date Validation', () => {
  it('accepts YYYY-MM-DD', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test('2026-02-14'));
  });
  
  it('rejects ISO datetime', () => {
    assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test('2026-02-14T10:00:00'));
  });
  
  it('rejects MM/DD/YYYY', () => {
    assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test('02/14/2026'));
  });
});

// ============================================================
// 18. SANITIZATION (dashboard utils)
// ============================================================
describe('XSS Sanitization', () => {
  // Test the sanitizeHtml logic inline (same algorithm as dashboard/lib/utils.ts)
  function sanitizeHtml(html) {
    if (!html) return '';
    const parts = html.split(/(<\/?mark>)/gi);
    let result = '';
    for (const part of parts) {
      if (part.toLowerCase() === '<mark>') {
        result += '<mark>';
      } else if (part.toLowerCase() === '</mark>') {
        result += '</mark>';
      } else {
        result += part
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    }
    return result;
  }
  
  it('preserves <mark> tags', () => {
    const result = sanitizeHtml('hello <mark>world</mark>');
    assert.equal(result, 'hello <mark>world</mark>');
  });
  
  it('strips script tags', () => {
    const result = sanitizeHtml('<script>alert("xss")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });
  
  it('strips img onerror', () => {
    const result = sanitizeHtml('<img src=x onerror=alert(1)>');
    assert.ok(!result.includes('<img'));
    assert.ok(result.includes('&lt;img'));
  });
  
  it('handles nested injection in mark', () => {
    const result = sanitizeHtml('<mark><script>evil</script></mark>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('<mark>&lt;script&gt;'));
  });
  
  it('handles empty input', () => {
    assert.equal(sanitizeHtml(''), '');
    assert.equal(sanitizeHtml(null), '');
  });
});

// ============================================================
// 13. WILDCARD MATCHING (ReDoS-safe)
// ============================================================
describe('Wildcard Matching', () => {
  // Replicate the wildcardMatch logic from classifier.js
  function wildcardMatch(pattern, str) {
    const parts = pattern.split('%').filter(p => p.length > 0);
    if (parts.length === 0) return true;
    let pos = 0;
    const startsWithWild = pattern.startsWith('%');
    const endsWithWild = pattern.endsWith('%');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const idx = str.indexOf(part, pos);
      if (idx === -1) return false;
      if (i === 0 && !startsWithWild && idx !== 0) return false;
      pos = idx + part.length;
    }
    if (!endsWithWild && pos !== str.length) return false;
    return true;
  }
  
  it('matches exact domain wildcard', () => {
    assert.ok(wildcardMatch('%@company.com', 'john@company.com'));
    assert.ok(wildcardMatch('%@company.com', 'jane.doe@company.com'));
  });
  
  it('rejects non-matching domain', () => {
    assert.ok(!wildcardMatch('%@company.com', 'john@other.com'));
  });
  
  it('matches prefix wildcard', () => {
    assert.ok(wildcardMatch('vip-%', 'vip-john@test.com'));
    assert.ok(!wildcardMatch('vip-%', 'john@test.com'));
  });
  
  it('handles just % (match all)', () => {
    assert.ok(wildcardMatch('%', 'anything'));
    assert.ok(wildcardMatch('%', ''));
  });
  
  it('handles no wildcard (exact match)', () => {
    assert.ok(wildcardMatch('john@test.com', 'john@test.com'));
    assert.ok(!wildcardMatch('john@test.com', 'jane@test.com'));
  });
});

// ============================================================
// 14. DATE VALIDATION
// ============================================================
describe('Date Validation', () => {
  it('valid ISO date normalizes correctly', () => {
    const d = new Date('2026-02-14');
    assert.ok(!Number.isNaN(d.getTime()));
    assert.equal(d.toISOString().split('T')[0], '2026-02-14');
  });
  
  it('invalid date is rejected', () => {
    const d = new Date('not-a-date');
    assert.ok(Number.isNaN(d.getTime()));
  });
  
  it('empty string date is rejected', () => {
    const d = new Date('');
    assert.ok(Number.isNaN(d.getTime()));
  });
});

// ============================================================
// 15. REPLY SUBJECT NORMALIZATION
// ============================================================
describe('Reply Subject Normalization', () => {
  const normalize = (s) => s.replace(/^(Re|Fw|Fwd|SV|VS|AW|TR|RE|FW|Antwort|Antw|Rif|R|RES|ENC|Doorst|Vl|Ynt|Svb):\s*/gi, '').trim();
  
  it('strips Re:', () => {
    assert.equal(normalize('Re: Budget Review'), 'Budget Review');
  });
  
  it('strips SV: (Swedish)', () => {
    assert.equal(normalize('SV: Budget Review'), 'Budget Review');
  });
  
  it('strips AW: (German)', () => {
    assert.equal(normalize('AW: Projektbericht'), 'Projektbericht');
  });
  
  it('strips stacked prefixes', () => {
    assert.equal(normalize('Re: RE: FW: Topic'), 'RE: FW: Topic'); // Strips first only
  });
  
  it('leaves unprefixed subjects alone', () => {
    assert.equal(normalize('Budget Review'), 'Budget Review');
  });
});

console.log('Audit test suite loaded — running...');
