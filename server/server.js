/**
 * Email Wiz — Express API server
 * 
 * Endpoints:
 *   GET  /api/health          — server status + sync state
 *   GET  /api/threads         — prioritized thread list
 *   GET  /api/thread/:id      — single thread with messages
 *   GET  /api/events          — calendar events
 *   GET  /api/brief           — daily command brief
 *   POST /api/sync            — trigger manual sync
 *   POST /api/classify/:id    — reclassify a thread
 *   POST /api/override/:id    — override classification
 *   GET  /api/commitments     — commitment tracker
 *   GET  /api/stats           — dashboard stats
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { getDb } from './lib/db.js';
import { fullSync } from './lib/sync.js';
import { authenticate } from './lib/graph.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3456');

// --- Health ---
app.get('/api/health', (req, res) => {
  const db = getDb();
  const lastMailSync = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('last_mail_sync');
  const lastCalSync = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('last_calendar_sync');
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const threadCount = db.prepare('SELECT COUNT(*) as count FROM threads').get();
  const eventCount = db.prepare('SELECT COUNT(*) as count FROM events').get();
  
  res.json({
    status: 'ok',
    lastMailSync: lastMailSync?.value,
    lastCalendarSync: lastCalSync?.value,
    messages: messageCount.count,
    threads: threadCount.count,
    events: eventCount.count,
  });
});

// --- Threads (prioritized) ---
app.get('/api/threads', (req, res) => {
  const db = getDb();
  const { priority, limit = 50, offset = 0 } = req.query;
  
  let query = `
    SELECT t.*, c.priority, c.label, c.confidence, c.needs_reply, c.llm_rationale, c.rule_signals
    FROM threads t
    LEFT JOIN classifications c ON t.conversation_id = c.conversation_id
  `;
  const params = [];
  
  if (priority) {
    query += ' WHERE c.priority = ?';
    params.push(priority);
  }
  
  query += ' ORDER BY CASE c.priority WHEN \'P0\' THEN 0 WHEN \'P1\' THEN 1 WHEN \'P2\' THEN 2 WHEN \'P3\' THEN 3 ELSE 4 END, t.latest_message_at DESC';
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  
  const threads = db.prepare(query).all(...params);
  
  // Get latest message preview for each thread
  const getLatest = db.prepare(
    'SELECT sender_name, sender_email, body_preview, received_at FROM messages WHERE conversation_id = ? ORDER BY received_at DESC LIMIT 1'
  );
  
  const result = threads.map(t => ({
    ...t,
    participants: safeParseJSON(t.participants),
    rule_signals: safeParseJSON(t.rule_signals),
    latest_message: getLatest.get(t.conversation_id),
  }));
  
  res.json({ threads: result });
});

// --- Single Thread ---
app.get('/api/thread/:conversationId', (req, res) => {
  const db = getDb();
  const { conversationId } = req.params;
  
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?').get(conversationId);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  const classification = db.prepare(
    'SELECT * FROM classifications WHERE conversation_id = ?'
  ).get(conversationId);
  
  const drafts = db.prepare(
    'SELECT * FROM drafts WHERE conversation_id = ? ORDER BY created_at DESC'
  ).all(conversationId);
  
  res.json({
    thread: { ...thread, participants: safeParseJSON(thread.participants) },
    messages,
    classification,
    drafts,
  });
});

// --- Calendar Events ---
app.get('/api/events', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  
  let query, params;
  if (date) {
    // Events for a specific date
    query = 'SELECT * FROM events WHERE date(start_time) = ? ORDER BY start_time ASC';
    params = [date];
  } else {
    // Today + next 7 days
    query = 'SELECT * FROM events WHERE start_time >= datetime(\'now\', \'-1 hour\') ORDER BY start_time ASC LIMIT 100';
    params = [];
  }
  
  const events = db.prepare(query).all(...params);
  res.json({ events: events.map(e => ({ ...e, attendees: safeParseJSON(e.attendees) })) });
});

// --- Daily Command Brief ---
app.get('/api/brief', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  
  // Urgent emails (P0)
  const urgent = db.prepare(`
    SELECT t.*, c.priority, c.label, c.needs_reply, c.llm_rationale
    FROM threads t
    JOIN classifications c ON t.conversation_id = c.conversation_id
    WHERE c.priority = 'P0'
    ORDER BY t.latest_message_at DESC
    LIMIT 10
  `).all();
  
  // Important emails (P1)
  const important = db.prepare(`
    SELECT t.*, c.priority, c.label, c.needs_reply
    FROM threads t
    JOIN classifications c ON t.conversation_id = c.conversation_id
    WHERE c.priority = 'P1'
    ORDER BY t.latest_message_at DESC
    LIMIT 10
  `).all();
  
  // Today's meetings
  const meetings = db.prepare(`
    SELECT * FROM events 
    WHERE date(start_time) = ?
    ORDER BY start_time ASC
  `).all(today);
  
  // Tomorrow's meetings (for prep)
  const tomorrowMeetings = db.prepare(`
    SELECT * FROM events 
    WHERE date(start_time) = ?
    ORDER BY start_time ASC
  `).all(tomorrow);
  
  // Overdue commitments
  const overdue = db.prepare(`
    SELECT * FROM commitments 
    WHERE status IN ('open', 'overdue') AND due_date < ?
    ORDER BY due_date ASC
  `).all(today);
  
  // Due soon
  const dueSoon = db.prepare(`
    SELECT * FROM commitments 
    WHERE status = 'open' AND due_date >= ? AND due_date <= ?
    ORDER BY due_date ASC
  `).all(today, tomorrow);
  
  // Meeting hours today
  const meetingMinutes = meetings.reduce((sum, e) => {
    const start = new Date(e.start_time);
    const end = new Date(e.end_time);
    return sum + (end - start) / 60000;
  }, 0);
  
  // Stats
  const totalThreads = db.prepare('SELECT COUNT(*) as count FROM threads').get();
  const classifiedCount = db.prepare('SELECT COUNT(*) as count FROM classifications').get();
  const draftCount = db.prepare("SELECT COUNT(*) as count FROM drafts WHERE status = 'draft'").get();
  
  res.json({
    date: today,
    mustDecideNow: urgent,
    mustPrepToday: important,
    overdueFollowUps: overdue,
    dueSoon,
    todayMeetings: meetings.map(e => ({ ...e, attendees: safeParseJSON(e.attendees) })),
    tomorrowMeetings: tomorrowMeetings.map(e => ({ ...e, attendees: safeParseJSON(e.attendees) })),
    stats: {
      meetingHoursToday: (meetingMinutes / 60).toFixed(1),
      meetingCount: meetings.length,
      totalThreads: totalThreads.count,
      classified: classifiedCount.count,
      draftsReady: draftCount.count,
    },
  });
});

// --- Manual Sync ---
app.post('/api/sync', async (req, res) => {
  try {
    const results = await fullSync();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Override Classification ---
app.post('/api/override/:conversationId', (req, res) => {
  const db = getDb();
  const { conversationId } = req.params;
  const { priority } = req.body;
  
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority' });
  }
  
  db.prepare(`
    UPDATE classifications 
    SET user_priority = ?, overridden = 1, priority = ?
    WHERE conversation_id = ?
  `).run(priority, priority, conversationId);
  
  res.json({ ok: true, conversationId, priority });
});

// --- Commitments ---
app.get('/api/commitments', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  
  let query = 'SELECT * FROM commitments';
  const params = [];
  
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY due_date ASC';
  
  res.json({ commitments: db.prepare(query).all(...params) });
});

// --- Stats ---
app.get('/api/stats', (req, res) => {
  const db = getDb();
  
  const priorities = db.prepare(`
    SELECT priority, COUNT(*) as count FROM classifications GROUP BY priority
  `).all();
  
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const totalThreads = db.prepare('SELECT COUNT(*) as count FROM threads').get();
  const totalEvents = db.prepare('SELECT COUNT(*) as count FROM events').get();
  const draftsReady = db.prepare("SELECT COUNT(*) as count FROM drafts WHERE status = 'draft'").get();
  const draftsSent = db.prepare("SELECT COUNT(*) as count FROM drafts WHERE status = 'sent'").get();
  
  res.json({
    messages: totalMessages.count,
    threads: totalThreads.count,
    events: totalEvents.count,
    draftsReady: draftsReady.count,
    draftsSent: draftsSent.count,
    byPriority: Object.fromEntries(priorities.map(p => [p.priority, p.count])),
  });
});

// --- Startup ---
async function start() {
  // Init DB
  getDb();
  console.log('[db] SQLite initialized');
  
  // Try Graph authentication
  try {
    await authenticate();
    console.log('[graph] Authenticated with Microsoft Graph');
    
    // Initial sync
    console.log('[sync] Running initial sync...');
    const results = await fullSync();
    console.log('[sync] Initial sync complete:', results);
  } catch (err) {
    console.warn('[graph] Authentication skipped:', err.message);
    console.warn('[graph] Set AZURE_CLIENT_ID and AZURE_TENANT_ID in .env to enable Graph sync');
  }
  
  // Schedule sync
  const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15');
  cron.schedule(`*/${interval} * * * *`, async () => {
    console.log(`[cron] Running sync (every ${interval} min)...`);
    try {
      await fullSync();
    } catch (err) {
      console.error('[cron] Sync failed:', err.message);
    }
  });
  console.log(`[cron] Sync scheduled every ${interval} minutes`);
  
  // Start server
  app.listen(PORT, () => {
    console.log(`\n[server] Email Wiz running at http://localhost:${PORT}`);
    console.log(`[server] Endpoints:`);
    console.log(`  GET  /api/health       — Status + sync state`);
    console.log(`  GET  /api/brief        — Daily command brief`);
    console.log(`  GET  /api/threads      — Prioritized inbox`);
    console.log(`  GET  /api/thread/:id   — Thread detail`);
    console.log(`  GET  /api/events       — Calendar events`);
    console.log(`  GET  /api/commitments  — Commitment tracker`);
    console.log(`  GET  /api/stats        — Dashboard stats`);
    console.log(`  POST /api/sync         — Manual sync trigger`);
    console.log(`  POST /api/override/:id — Override priority\n`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

function safeParseJSON(str) {
  try { return JSON.parse(str || '[]'); }
  catch { return str; }
}
