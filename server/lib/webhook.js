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
import crypto from 'crypto';
import { getDb } from './db.js';
import { classifyThread } from './classifier.js';

const getWebhookSecret = () => process.env.WEBHOOK_SECRET || '';
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify webhook — supports HMAC signature (preferred) or static secret (legacy).
 * 
 * HMAC mode: Headers X-Webhook-Timestamp + X-Webhook-Signature
 *   signature = HMAC-SHA256(secret, timestamp + '.' + rawBody)
 * Legacy mode: Header X-Webhook-Secret (static comparison)
 * 
 * (Issue #2: replay protection via HMAC + timestamp + idempotency)
 */
export function verifyWebhook(req, res, next) {
  const secret = getWebhookSecret();
  if (!secret) {
    // No secret configured — allow all (dev mode)
    return next();
  }
  
  const timestamp = req.headers['x-webhook-timestamp'];
  const signature = req.headers['x-webhook-signature'];
  
  if (timestamp && signature) {
    // HMAC mode
    const ts = parseInt(timestamp);
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS) {
      return res.status(401).json({ error: 'Webhook timestamp expired or invalid' });
    }
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    // Fix #3: timingSafeEqual throws on length mismatch — guard it
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } else {
    // Legacy static secret mode (backward compatible)
    const provided = req.headers['x-webhook-secret'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }
  
  next();
}

/**
 * Check idempotency — returns true if this event was already processed (issue #12).
 */
function isDuplicate(eventId) {
  if (!eventId) return false;
  const db = getDb();
  const result = db.prepare(
    'INSERT OR IGNORE INTO webhook_events (event_id) VALUES (?)'
  ).run(eventId);
  return result.changes === 0; // 0 changes = already existed
}

/**
 * Clean up old dedup records (keep 7 days).
 */
function pruneWebhookEvents() {
  const db = getDb();
  db.prepare("DELETE FROM webhook_events WHERE received_at < datetime('now', '-7 days')").run();
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
  let skippedDupes = 0;
  const conversationIds = new Set();
  
  // Wrap all DB writes in a transaction for atomicity (issue #5)
  const insertEmails = db.transaction((emailBatch) => {
    for (const email of emailBatch) {
      if (!email.id || !email.conversationId) continue;
      
      // Idempotency check (issue #12)
      if (isDuplicate(`email:${email.id}`)) {
        skippedDupes++;
        continue;
      }
      
      const toList = parseEmailList(email.to || email.toRecipients);
      const ccList = parseEmailList(email.cc || email.ccRecipients);
      
      db.prepare(`
        INSERT OR REPLACE INTO messages 
        (id, conversation_id, subject, sender_email, sender_name, to_recipients, cc_recipients,
         body_preview, body_text, received_at, is_read, has_attachments, importance, internet_message_id, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        email.id,
        email.conversationId,
        email.subject || '',
        parseFromField(email.from || email.fromEmail).email,
        email.fromName || parseFromField(email.from).name,
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
    
    // Update sync state inside same transaction
    db.prepare(
      "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('last_mail_sync', ?, datetime('now'))"
    ).run(new Date().toISOString());
  });
  
  insertEmails(emails);
  
  // Update thread aggregates
  for (const convId of conversationIds) {
    updateThread(db, convId);
  }
  
  // Classify new/updated threads (outside transaction — LLM calls are slow)
  for (const convId of conversationIds) {
    await classifyIfNeeded(db, convId);
  }
  
  // Periodic dedup table cleanup
  if (Math.random() < 0.01) pruneWebhookEvents();
  
  res.json({ ok: true, processed, skippedDupes, conversations: conversationIds.size });
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
  let skippedDupes = 0;
  
  // Wrap in transaction for atomicity (issue #5)
  const insertEvents = db.transaction((eventBatch) => {
    for (const event of eventBatch) {
      if (!event.id || !event.subject) continue;
      
      // Idempotency: use event id + last-modified or subject hash to allow updates (fix #2)
      const calKey = `cal:${event.id}:${event.lastModifiedDateTime || event.subject || ''}`;
      if (isDuplicate(calKey)) {
        skippedDupes++;
        continue;
      }
      
      let attendees;
      if (typeof event.attendees === 'string') {
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
      
      // ON CONFLICT preserves prep_brief, prep_manual_edited (fix #1)
      db.prepare(`
        INSERT INTO events 
        (id, subject, start_time, end_time, location, organizer_email, organizer_name,
         attendees, body_text, is_recurring, importance, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          subject = excluded.subject, start_time = excluded.start_time, end_time = excluded.end_time,
          location = excluded.location, organizer_email = excluded.organizer_email,
          organizer_name = excluded.organizer_name, attendees = excluded.attendees,
          body_text = excluded.body_text, is_recurring = excluded.is_recurring,
          importance = excluded.importance, synced_at = excluded.synced_at
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
  });
  
  insertEvents(events);
  
  res.json({ ok: true, processed, skippedDupes });
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
  
  // Don't overwrite user-overridden classifications
  const existing = db.prepare('SELECT overridden FROM classifications WHERE conversation_id = ?').get(conversationId);
  if (existing?.overridden) return;
  
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
      INSERT INTO classifications 
      (conversation_id, priority, label, rule_signals, llm_rationale, confidence, needs_reply, classified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(conversation_id) DO UPDATE SET
        priority = excluded.priority, label = excluded.label,
        rule_signals = excluded.rule_signals, llm_rationale = excluded.llm_rationale,
        confidence = excluded.confidence, needs_reply = excluded.needs_reply,
        classified_at = excluded.classified_at
      WHERE classifications.overridden = 0
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

/**
 * Parse email recipient field — handles:
 * - Plain string: "a@b.com;c@d.com"
 * - JSON string of array: '["a@b.com","c@d.com"]'
 * - PA dynamic content object: {"address":"a@b.com","name":"John"}
 * - Array of objects: [{"address":"a@b.com"},...]
 */
function parseEmailList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(r => typeof r === 'string' ? r : r.address || r.email || r.emailAddress?.address || '').filter(Boolean);
  }
  if (typeof raw === 'object') {
    return [raw.address || raw.email || raw.emailAddress?.address || ''].filter(Boolean);
  }
  if (typeof raw === 'string') {
    // Try JSON parse first
    try {
      const parsed = JSON.parse(raw);
      return parseEmailList(parsed);
    } catch {
      // Semicolon or comma separated string
      return raw.split(/[;,]/).map(e => e.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Extract email address from PA "from" field — could be:
 * - Plain string: "john@company.com"
 * - JSON string: '{"address":"john@company.com","name":"John"}'
 * - Object: {address: "john@company.com"}
 */
function parseFromField(raw) {
  if (!raw) return { email: '', name: '' };
  if (typeof raw === 'object') {
    return {
      email: (raw.address || raw.email || raw.emailAddress?.address || '').toLowerCase(),
      name: raw.name || raw.emailAddress?.name || '',
    };
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseFromField(parsed);
    } catch {
      return { email: raw.toLowerCase(), name: '' };
    }
  }
  return { email: '', name: '' };
}

function safeParseArray(json) {
  try { return JSON.parse(json || '[]'); }
  catch { return []; }
}
