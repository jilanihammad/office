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
import { verifyWebhook, handleEmailWebhook, handleCalendarWebhook, handleBulkImport } from './lib/webhook.js';
import { startWatcher } from './lib/filewatcher.js';
import { queueForSend, outboxStatus } from './lib/outbox.js';
import { extractCommitments, extractAllPending, getOverdue, markDone, updateDueDate } from './lib/commitments.js';
import { initSearch, rebuildIndex, search } from './lib/search.js';
import { generateMeetingPrep, prepUpcoming } from './lib/meetingprep.js';
import { processSentMail, getStyleContext, updateRelationships } from './lib/stylelearner.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' })); // Limit body size to prevent OOM

const PORT = parseInt(process.env.PORT || '3456');

// --- Async route wrapper — catches both sync and async errors ---
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// --- Expand tilde in paths ---
function expandTilde(p) {
  if (!p) return p;
  if (p.startsWith('~')) return p.replace('~', process.env.HOME || process.env.USERPROFILE || '');
  return p;
}

// --- Safe parseInt ---
function safeInt(val, defaultVal = 0) {
  const n = parseInt(val);
  return Number.isNaN(n) ? defaultVal : n;
}

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
  params.push(safeInt(limit, 50), safeInt(offset, 0));
  
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
app.post('/api/sync', wrap(async (req, res) => {
  try {
    const results = await fullSync();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

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

// --- Draft Generation ---
app.post('/api/draft/:conversationId', wrap(async (req, res) => {
  const db = getDb();
  const { conversationId } = req.params;
  const { variant = 'concise', instructions } = req.body;
  
  // Get thread messages
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  if (messages.length === 0) {
    return res.status(404).json({ error: 'No messages found for this thread' });
  }
  
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?').get(conversationId);
  const classification = db.prepare('SELECT * FROM classifications WHERE conversation_id = ?').get(conversationId);
  
  // Get style examples for tone matching
  const styleExamples = db.prepare('SELECT your_email FROM style_examples ORDER BY added_at DESC LIMIT 3').all();
  
  // Get relationship context
  const senderEmail = messages[messages.length - 1].sender_email;
  const relationship = db.prepare('SELECT * FROM relationship_memory WHERE email = ?').get(senderEmail);
  
  const threadText = messages.slice(-8).map(m =>
    `From: ${m.sender_name} <${m.sender_email}> (${m.received_at})\n${m.body_text || m.body_preview}`
  ).join('\n---\n');
  
  const variantGuide = variant === 'concise'
    ? 'Write a concise reply (2-4 sentences max). Direct, no filler. Get to the point.'
    : 'Write a complete reply. Professional but human. Cover all points raised.';
  
  const styleGuide = styleExamples.length > 0
    ? `\nMatch this writing style:\n${styleExamples.map(s => s.your_email).join('\n---\n')}`
    : '';
  
  const relationshipContext = relationship
    ? `\nRelationship context: ${relationship.name} (${relationship.role}). ${relationship.notes || ''}`
    : '';
  
  const customInstructions = instructions
    ? `\nAdditional instructions: ${instructions}`
    : '';
  
  const systemPrompt = `You are drafting an email reply on behalf of the user.
Rules:
- Never make up facts or commitments the user hasn't agreed to
- If the email asks for a decision, say "I'll get back to you on this" rather than deciding
- Match the formality level of the incoming email
- No "Hope this email finds you well" or similar filler
- Sign off naturally (just first name)${styleGuide}${relationshipContext}`;

  const userPrompt = `Thread (${thread?.subject || 'no subject'}):
${threadText}

Classification: ${classification?.priority || 'unknown'} — ${classification?.label || ''}
${classification?.needs_reply ? 'Flagged as needing reply.' : ''}

${variantGuide}${customInstructions}

Write only the reply body. No subject line.`;

  try {
    const { chat } = await import('./lib/llm.js');
    const draftText = await chat(systemPrompt, [{ role: 'user', content: userPrompt }], {
      maxTokens: 1024,
      temperature: 0.4,
    });
    
    // Save draft
    const result = db.prepare(`
      INSERT INTO drafts (conversation_id, variant, body_text, reply_type, status)
      VALUES (?, ?, ?, 'reply', 'draft')
    `).run(conversationId, variant, draftText.trim());
    
    res.json({
      ok: true,
      draft: {
        id: result.lastInsertRowid,
        variant,
        body_text: draftText.trim(),
        status: 'draft',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// --- Reclassify ---
app.post('/api/classify/:conversationId', wrap(async (req, res) => {
  const db = getDb();
  const { conversationId } = req.params;
  
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  if (messages.length === 0) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?').get(conversationId);
  
  try {
    const { classifyThread } = await import('./lib/classifier.js');
    const result = await classifyThread({
      conversation_id: conversationId,
      subject: thread?.subject || '',
      messages,
    });
    
    db.prepare(`
      INSERT OR REPLACE INTO classifications 
      (conversation_id, priority, label, rule_signals, llm_rationale, confidence, needs_reply, classified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      conversationId, result.priority, result.label,
      result.rule_signals, result.llm_rationale, result.confidence, result.needs_reply
    );
    
    res.json({ ok: true, classification: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// --- Sender Rules ---
app.get('/api/sender-rules', (req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM sender_rules ORDER BY priority_boost DESC').all();
  res.json({ rules });
});

app.post('/api/sender-rules', (req, res) => {
  const db = getDb();
  const { email_pattern, priority_boost, label } = req.body;
  
  if (!email_pattern) return res.status(400).json({ error: 'email_pattern required' });
  
  db.prepare(
    'INSERT OR REPLACE INTO sender_rules (email_pattern, priority_boost, label) VALUES (?, ?, ?)'
  ).run(email_pattern, priority_boost || 0, label || '');
  
  res.json({ ok: true });
});

// --- Send via Outbox ---
app.post('/api/send/:draftId', (req, res) => {
  try {
    const { draftId } = req.params;
    const { replyAll } = req.body;
    const result = queueForSend(safeInt(draftId, 0), { replyAll });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/outbox/status', (req, res) => {
  res.json(outboxStatus());
});

// --- Commitments ---
app.post('/api/commitments/extract/:conversationId', wrap(async (req, res) => {
  try {
    const extracted = await extractCommitments(req.params.conversationId);
    res.json({ ok: true, commitments: extracted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post('/api/commitments/extract-all', wrap(async (req, res) => {
  try {
    const results = await extractAllPending();
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.get('/api/commitments/overdue', (req, res) => {
  res.json({ commitments: getOverdue() });
});

app.post('/api/commitments/:id/done', (req, res) => {
  markDone(safeInt(req.params.id));
  res.json({ ok: true });
});

app.patch('/api/commitments/:id', (req, res) => {
  const { due_date } = req.body;
  if (due_date) updateDueDate(safeInt(req.params.id), due_date);
  res.json({ ok: true });
});

// --- Search ---
app.get('/api/search', (req, res) => {
  const { q, limit, type } = req.query;
  if (!q) return res.json({ emails: [], events: [], commitments: [] });
  const results = search(q, { limit: safeInt(limit, 20), type });
  res.json(results);
});

app.post('/api/search/rebuild', (req, res) => {
  const result = rebuildIndex();
  res.json({ ok: true, ...result });
});

// --- Meeting Prep ---
app.get('/api/prep/:eventId', wrap(async (req, res) => {
  try {
    const prep = await generateMeetingPrep(req.params.eventId);
    res.json(prep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

app.post('/api/prep/upcoming', wrap(async (req, res) => {
  try {
    const results = await prepUpcoming();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// --- Daily Brief (enhanced) ---
app.get('/api/brief/text', wrap(async (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  
  // Urgent threads
  const urgent = db.prepare(`
    SELECT t.subject, c.priority, c.needs_reply
    FROM threads t JOIN classifications c ON t.conversation_id = c.conversation_id
    WHERE c.priority = 'P0' ORDER BY t.latest_message_at DESC LIMIT 5
  `).all();
  
  // Today's meetings
  const meetings = db.prepare(`
    SELECT subject, start_time, end_time, location FROM events
    WHERE date(start_time) = ? ORDER BY start_time ASC
  `).all(today);
  
  // Overdue commitments
  const overdue = getOverdue();
  
  // Meeting hours
  const meetingMins = meetings.reduce((sum, e) => {
    return sum + (new Date(e.end_time) - new Date(e.start_time)) / 60000;
  }, 0);
  
  // Build text brief
  let text = `*Daily Brief — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}*\n\n`;
  
  if (urgent.length > 0) {
    text += `*Must Decide Now (${urgent.length})*\n`;
    urgent.forEach(t => { text += `- ${t.subject}${t.needs_reply ? ' [needs reply]' : ''}\n`; });
    text += '\n';
  }
  
  if (meetings.length > 0) {
    text += `*Meetings (${meetings.length} · ${(meetingMins / 60).toFixed(1)}h)*\n`;
    meetings.forEach(m => {
      const time = new Date(m.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      text += `- ${time} ${m.subject}${m.location ? ` (${m.location})` : ''}\n`;
    });
    text += '\n';
  }
  
  if (overdue.length > 0) {
    text += `*Overdue (${overdue.length})*\n`;
    overdue.forEach(c => { text += `- ${c.owner}: ${c.description} (was due ${c.due_date})\n`; });
    text += '\n';
  }
  
  if (urgent.length === 0 && meetings.length === 0 && overdue.length === 0) {
    text += 'Clear day. No urgent emails, no meetings, nothing overdue.';
  }
  
  res.json({ text, date: today });
}));

// --- Global error handler ---
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: err.message });
});

// --- Webhooks (Power Automate) ---
// Close wrapped routes above
app.post('/api/webhook/email', verifyWebhook, handleEmailWebhook);
app.post('/api/webhook/calendar', verifyWebhook, handleCalendarWebhook);
app.post('/api/webhook/bulk', verifyWebhook, handleBulkImport);

// --- Startup ---
async function start() {
  // Init DB + search
  getDb();
  console.log('[db] SQLite initialized');
  initSearch();
  
  // Determine sync mode
  const hasGraphConfig = process.env.AZURE_CLIENT_ID && process.env.AZURE_TENANT_ID;
  const hasWebhookSecret = !!process.env.WEBHOOK_SECRET;
  
  if (hasGraphConfig) {
    // Graph API mode — direct sync
    try {
      await authenticate();
      console.log('[graph] Authenticated with Microsoft Graph');
      
      console.log('[sync] Running initial sync...');
      const results = await fullSync();
      console.log('[sync] Initial sync complete:', results);
      
      const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15');
      cron.schedule(`*/${interval} * * * *`, async () => {
        console.log(`[cron] Running sync (every ${interval} min)...`);
        try { await fullSync(); }
        catch (err) { console.error('[cron] Sync failed:', err.message); }
      });
      console.log(`[cron] Sync scheduled every ${interval} minutes`);
    } catch (err) {
      console.warn('[graph] Authentication failed:', err.message);
      console.warn('[graph] Falling back to webhook-only mode');
    }
  } else {
    console.log('[mode] No Graph API credentials — using local sync modes');
  }
  
  // Start file watcher (OneDrive drop folder)
  const dropFolder = expandTilde(process.env.DROP_FOLDER);
  if (dropFolder) {
    startWatcher(dropFolder);
    
    // Periodic tasks: commitment extraction, style learning, meeting prep, relationship updates
    cron.schedule('*/5 * * * *', async () => {
      try {
        // Extract commitments from new P0/P1 threads
        const commitResults = await extractAllPending();
        if (commitResults.extracted > 0) {
          console.log(`[cron] Extracted ${commitResults.extracted} commitments from ${commitResults.scanned} threads`);
        }
        
        // Process sent emails for style learning
        processSentMail(dropFolder);
        
        // Update relationship memory
        updateRelationships(dropFolder);
      } catch (err) {
        console.error('[cron] Periodic task failed:', err.message);
      }
    });
    console.log('[cron] Commitment extraction + style learning every 5 minutes');
    
    // WAL checkpoint + meeting prep: hourly
    cron.schedule('0 * * * *', async () => {
      try {
        const db = getDb();
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (err) {
        console.error('[cron] WAL checkpoint failed:', err.message);
      }
      
      try {
        const results = await prepUpcoming();
        if (results.length > 0) {
          console.log(`[cron] Generated ${results.length} meeting prep brief(s)`);
        }
      } catch (err) {
        console.error('[cron] Meeting prep failed:', err.message);
      }
    });
    console.log('[cron] Meeting prep briefs generated hourly');
  } else {
    console.log('[watcher] No DROP_FOLDER configured — set it in .env to enable OneDrive sync');
    console.log('[watcher] Example: DROP_FOLDER=/mnt/c/Users/<you>/OneDrive - Company/Office-Drop');
  }
  
  // Start server
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n[server] Office running at http://localhost:${PORT}`);
    console.log(`[server] Endpoints:`);
    console.log(`  GET  /api/health            — Status + sync state`);
    console.log(`  GET  /api/brief             — Daily command brief`);
    console.log(`  GET  /api/threads           — Prioritized inbox`);
    console.log(`  GET  /api/thread/:id        — Thread detail`);
    console.log(`  GET  /api/events            — Calendar events`);
    console.log(`  GET  /api/commitments       — Commitment tracker`);
    console.log(`  GET  /api/stats             — Dashboard stats`);
    console.log(`  POST /api/sync              — Manual sync (Graph mode)`);
    console.log(`  POST /api/draft/:id         — Generate reply draft`);
    console.log(`  POST /api/override/:id      — Override priority`);
    console.log(`  POST /api/send/:draftId     — Send draft via outbox`);
    console.log(`  GET  /api/search?q=         — Full-text search`);
    console.log(`  POST /api/commitments/extract-all — Extract commitments`);
    console.log(`  GET  /api/prep/:eventId     — Meeting prep brief`);
    console.log(`  GET  /api/brief/text        — Text-formatted daily brief`);
    console.log(`  POST /api/webhook/email     — Power Automate email webhook`);
    console.log(`  POST /api/webhook/calendar  — Power Automate calendar webhook\n`);
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
