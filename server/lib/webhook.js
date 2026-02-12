/**
 * Power Automate webhook receiver.
 * 
 * Accepts email/calendar data pushed by Power Automate cloud flows.
 * No Graph API needed — Power Automate handles the M365 connection.
 * 
 * Flow setup:
 *   1. Trigger: "When a new email arrives (V3)" or "When an event is added/modified"
 *   2. Action: HTTP POST to https://<tunnel>/api/webhook/email (or /calendar)
 *   3. Body: JSON with the fields below
 *   4. Header: X-Webhook-Secret: <your secret>
 */
import { getDb } from './db.js';
import { classifyThread } from './classifier.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

/**
 * Verify webhook secret header.
 */
export function verifyWebhook(req, res, next) {
  if (!WEBHOOK_SECRET) {
    // No secret configured — allow all (dev mode)
    return next();
  }
  
  const provided = req.headers['x-webhook-secret'];
  if (provided !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }
  next();
}

/**
 * Process an inbound email from Power Automate.
 * 
 * Expected body (matches Power Automate "When a new email arrives V3" dynamic content):
 * {
 *   id: string,
 *   conversationId: string,
 *   subject: string,
 *   from: string,              // sender email
 *   fromName: string,          // sender display name
 *   to: string,                // semicolon-separated
 *   cc: string,                // semicolon-separated
 *   bodyPreview: string,
 *   body: string,              // full text or HTML
 *   receivedDateTime: string,  // ISO 8601
 *   isRead: boolean,
 *   hasAttachments: boolean,
 *   importance: string         // "normal" | "high" | "low"
 * }
 */
export async function handleEmailWebhook(req, res) {
  const db = getDb();
  const emails = Array.isArray(req.body) ? req.body : [req.body];
  
  let processed = 0;
  const conversationIds = new Set();
  
  for (const email of emails) {
    if (!email.id || !email.conversationId) {
      continue;
    }
    
    const toList = (email.to || '').split(';').map(e => e.trim()).filter(Boolean);
    const ccList = (email.cc || '').split(';').map(e => e.trim()).filter(Boolean);
    
    // Upsert message
    db.prepare(`
      INSERT OR REPLACE INTO messages 
      (id, conversation_id, subject, sender_email, sender_name, to_recipients, cc_recipients,
       body_preview, body_text, received_at, is_read, has_attachments, importance, internet_message_id, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      email.id,
      email.conversationId,
      email.subject || '',
      (email.from || '').toLowerCase(),
      email.fromName || '',
      JSON.stringify(toList),
      JSON.stringify(ccList),
      email.bodyPreview || '',
      stripHtml(email.body || email.bodyPreview || ''),
      email.receivedDateTime || new Date().toISOString(),
      email.isRead ? 1 : 0,
      email.hasAttachments ? 1 : 0,
      email.importance || 'normal',
      email.internetMessageId || ''
    );
    
    conversationIds.add(email.conversationId);
    processed++;
  }
  
  // Update thread aggregates
  for (const convId of conversationIds) {
    updateThread(db, convId);
  }
  
  // Classify new/updated threads
  for (const convId of conversationIds) {
    await classifyIfNeeded(db, convId);
  }
  
  // Update sync state
  db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('last_mail_sync', ?, datetime('now'))"
  ).run(new Date().toISOString());
  
  res.json({ ok: true, processed, conversations: conversationIds.size });
}

/**
 * Process a calendar event from Power Automate.
 * 
 * Expected body (matches "When an event is created/modified" dynamic content):
 * {
 *   id: string,
 *   subject: string,
 *   start: string,            // ISO 8601
 *   end: string,              // ISO 8601
 *   location: string,
 *   organizer: string,        // email
 *   organizerName: string,
 *   attendees: string,        // semicolon-separated emails or JSON array
 *   body: string,
 *   isRecurring: boolean,
 *   importance: string
 * }
 */
export function handleCalendarWebhook(req, res) {
  const db = getDb();
  const events = Array.isArray(req.body) ? req.body : [req.body];
  
  let processed = 0;
  
  for (const event of events) {
    if (!event.id || !event.subject) continue;
    
    let attendees;
    if (typeof event.attendees === 'string') {
      // Could be semicolon-separated emails or JSON
      try {
        attendees = JSON.parse(event.attendees);
      } catch {
        attendees = event.attendees.split(';').map(e => ({
          email: e.trim(),
          name: '',
          response: 'none',
        })).filter(a => a.email);
      }
    } else {
      attendees = event.attendees || [];
    }
    
    db.prepare(`
      INSERT OR REPLACE INTO events 
      (id, subject, start_time, end_time, location, organizer_email, organizer_name,
       attendees, body_text, is_recurring, importance, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      event.id,
      event.subject,
      event.start || '',
      event.end || '',
      event.location || '',
      (event.organizer || '').toLowerCase(),
      event.organizerName || '',
      JSON.stringify(attendees),
      stripHtml(event.body || ''),
      event.isRecurring ? 1 : 0,
      event.importance || 'normal'
    );
    
    processed++;
  }
  
  db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('last_calendar_sync', ?, datetime('now'))"
  ).run(new Date().toISOString());
  
  res.json({ ok: true, processed });
}

/**
 * Bulk import endpoint — for initial backfill.
 * Accepts an array of emails and processes them all.
 */
export async function handleBulkImport(req, res) {
  const db = getDb();
  const { emails = [], events = [] } = req.body;
  
  const results = { emails: 0, events: 0, classified: 0 };
  const conversationIds = new Set();
  
  // Import emails in a transaction
  const insertEmail = db.prepare(`
    INSERT OR REPLACE INTO messages 
    (id, conversation_id, subject, sender_email, sender_name, to_recipients, cc_recipients,
     body_preview, body_text, received_at, is_read, has_attachments, importance, internet_message_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  
  const bulkInsert = db.transaction((msgs) => {
    for (const email of msgs) {
      const toList = (email.to || '').split(';').map(e => e.trim()).filter(Boolean);
      const ccList = (email.cc || '').split(';').map(e => e.trim()).filter(Boolean);
      
      insertEmail.run(
        email.id, email.conversationId, email.subject || '',
        (email.from || '').toLowerCase(), email.fromName || '',
        JSON.stringify(toList), JSON.stringify(ccList),
        email.bodyPreview || '', stripHtml(email.body || email.bodyPreview || ''),
        email.receivedDateTime || '', email.isRead ? 1 : 0,
        email.hasAttachments ? 1 : 0, email.importance || 'normal',
        email.internetMessageId || ''
      );
      
      conversationIds.add(email.conversationId);
      results.emails++;
    }
  });
  
  bulkInsert(emails);
  
  // Update threads
  for (const convId of conversationIds) {
    updateThread(db, convId);
  }
  
  // Import calendar events
  for (const event of events) {
    if (!event.id) continue;
    db.prepare(`
      INSERT OR REPLACE INTO events 
      (id, subject, start_time, end_time, location, organizer_email, organizer_name,
       attendees, body_text, is_recurring, importance, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      event.id, event.subject || '', event.start || '', event.end || '',
      event.location || '', event.organizer || '', event.organizerName || '',
      JSON.stringify(event.attendees || []), stripHtml(event.body || ''),
      event.isRecurring ? 1 : 0, event.importance || 'normal'
    );
    results.events++;
  }
  
  // Classify all threads
  for (const convId of conversationIds) {
    await classifyIfNeeded(db, convId);
    results.classified++;
  }
  
  res.json({ ok: true, results });
}

// --- Helpers ---

function updateThread(db, conversationId) {
  const msgs = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  if (msgs.length === 0) return;
  
  const participants = [...new Set(msgs.flatMap(m => {
    const to = safeParseArray(m.to_recipients);
    const cc = safeParseArray(m.cc_recipients);
    return [m.sender_email, ...to, ...cc].filter(Boolean);
  }))];
  
  const latest = msgs[msgs.length - 1];
  
  db.prepare(`
    INSERT OR REPLACE INTO threads (conversation_id, subject, message_count, participants, latest_message_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(
    conversationId, latest.subject, msgs.length,
    JSON.stringify(participants), latest.received_at
  );
}

async function classifyIfNeeded(db, conversationId) {
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?').get(conversationId);
  if (!thread) return;
  
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  try {
    const result = await classifyThread({
      conversation_id: conversationId,
      subject: thread.subject,
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
  } catch (err) {
    console.error(`[classify] Failed for ${conversationId}:`, err.message);
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeParseArray(json) {
  try { return JSON.parse(json || '[]'); }
  catch { return []; }
}
