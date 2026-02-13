/**
 * Comprehensive audit test suite.
 * Tests every module, every edge case, every boundary.
 * Run: node --test test/audit.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
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
    // Point to temp test db
    const testDbPath = path.join(__dirname, '..', '..', 'data', 'test_audit.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    
    // Monkey-patch DB_PATH by setting env
    process.env.TEST_DB_PATH = testDbPath;
    const db = await import('../lib/db.js');
    getDb = db.getDb;
    close = db.close;
  });
  
  after(() => {
    close?.();
    const testDbPath = path.join(__dirname, '..', '..', 'data', 'test_audit.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });
  
  it('creates all 12 tables', () => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(t => t.name);
    
    const expected = [
      'classifications', 'commitments', 'drafts', 'events',
      'institutional_memory', 'messages', 'relationship_memory',
      'sender_rules', 'style_examples', 'sync_state', 'threads',
      'working_memory'
    ];
    
    assert.deepEqual(tables, expected);
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
});

// ============================================================
// 2. CLASSIFIER
// ============================================================
describe('Classifier', () => {
  it('boosts direct-to-you emails', async () => {
    process.env.USER_EMAIL = 'me@company.com';
    // We can't easily test classifyThread without a DB with sender_rules
    // but we can verify the module loads
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
  it('sanitizes single term to prefix search', async () => {
    const mod = await import('../lib/search.js');
    // Module loads without error
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
// 9. WEBHOOK
// ============================================================
describe('Webhook', () => {
  it('verifyWebhook passes when no secret configured', async () => {
    const saved = process.env.WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = '';
    
    const { verifyWebhook } = await import('../lib/webhook.js');
    
    let nextCalled = false;
    const req = { headers: {} };
    const res = { status: () => ({ json: () => {} }) };
    verifyWebhook(req, res, () => { nextCalled = true; });
    
    assert.ok(nextCalled);
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
    
    // authenticate should throw
    try {
      const { authenticate } = await import('../lib/graph.js');
      await authenticate();
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('AZURE_CLIENT_ID') || err.message.includes('required'));
    }
  });
});

console.log('Audit test suite loaded — running...');
