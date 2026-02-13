/**
 * OneDrive drop folder watcher.
 * 
 * Watches a local folder (synced via OneDrive) for JSON files
 * pushed by Power Automate. Processes and moves them to an archive.
 * 
 * Folder structure:
 *   <DROP_FOLDER>/
 *     inbox/          ← Power Automate drops email JSON here
 *     calendar/       ← Power Automate drops calendar JSON here
 *     processed/      ← Watcher moves files here after ingestion
 * 
 * Each JSON file = one email or calendar event.
 * Power Automate "Create file" action writes to OneDrive → syncs locally.
 */
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';
import { classifyThread } from './classifier.js';

const POLL_INTERVAL = parseInt(process.env.DROP_POLL_SECONDS || '10') * 1000;

let watcher = null;
let isProcessing = false;
// Track file sizes across polls to detect still-syncing files (issue #10)
const fileSizeCache = new Map();

/**
 * Start watching the drop folder.
 */
export function startWatcher(dropFolder) {
  if (!dropFolder) {
    console.log('[watcher] No DROP_FOLDER configured — file watcher disabled');
    return;
  }
  
  // Ensure folder structure exists
  const inboxDir = path.join(dropFolder, 'inbox');
  const calendarDir = path.join(dropFolder, 'calendar');
  const processedDir = path.join(dropFolder, 'processed');
  
  for (const dir of [inboxDir, calendarDir, processedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[watcher] Created ${dir}`);
    }
  }
  
  console.log(`[watcher] Watching ${dropFolder}`);
  console.log(`[watcher] Poll interval: ${POLL_INTERVAL / 1000}s`);
  
  // Initial scan
  processFolder(inboxDir, processedDir, 'email');
  processFolder(calendarDir, processedDir, 'calendar');
  
  // Poll on interval (more reliable than fs.watch across OneDrive sync)
  // Re-entrancy guard: skip poll if previous one still running (LLM classification can be slow)
  watcher = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processFolder(inboxDir, processedDir, 'email');
      await processFolder(calendarDir, processedDir, 'calendar');
    } finally {
      isProcessing = false;
    }
  }, POLL_INTERVAL);
  
  return watcher;
}

export function stopWatcher() {
  if (watcher) {
    clearInterval(watcher);
    watcher = null;
  }
}

/**
 * Process all JSON files in a directory.
 */
async function processFolder(srcDir, archiveDir, type) {
  let files;
  try {
    files = fs.readdirSync(srcDir).filter(f => f.endsWith('.json'));
  } catch {
    return; // Folder might not exist yet during sync
  }
  
  if (files.length === 0) return;
  
  console.log(`[watcher] Found ${files.length} ${type} file(s)`);
  
  for (const file of files) {
    const filePath = path.join(srcDir, file);
    try {
      // Skip files still being written (issue #10: stable size across 2 polls)
      const stat = fs.statSync(filePath);
      const cacheKey = filePath;
      const prevSize = fileSizeCache.get(cacheKey);
      fileSizeCache.set(cacheKey, stat.size);
      
      // Require: file older than 2s AND size stable across 2 polls
      if (Date.now() - stat.mtimeMs < 2000) {
        continue; // File modified <2s ago — likely still syncing
      }
      if (prevSize === undefined || prevSize !== stat.size) {
        continue; // Size changed or first seen — wait for next poll
      }
      
      // File is stable — clean from cache
      fileSizeCache.delete(cacheKey);
      
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (!raw || raw.trim().length === 0) {
        continue; // Empty file — OneDrive placeholder
      }
      
      // Robust JSON parse with error handling
      let data;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        console.error(`[watcher] Corrupt JSON in ${file}: ${parseErr.message}`);
        const errPath = path.join(archiveDir, `BADJSON_${type}_${file}`);
        fs.renameSync(filePath, errPath);
        continue;
      }
      
      if (type === 'email') {
        await processEmail(data);
      } else {
        processCalendarEvent(data);
      }
      
      // Move to processed
      const archivePath = path.join(archiveDir, `${type}_${file}`);
      fs.renameSync(filePath, archivePath);
      
    } catch (err) {
      console.error(`[watcher] Failed to process ${file}:`, err.message);
      // Move to processed with error prefix so it doesn't retry forever
      try {
        const errPath = path.join(archiveDir, `ERROR_${type}_${file}`);
        fs.renameSync(filePath, errPath);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Process a single email JSON.
 */
async function processEmail(email) {
  const db = getDb();
  
  // Handle both single email and array
  const emails = Array.isArray(email) ? email : [email];
  const conversationIds = new Set();
  
  for (const e of emails) {
    if (!e.id && !e.internetMessageId) continue;
    
    const id = e.id || e.internetMessageId || `gen_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const convId = e.conversationId || e.conversation_id || id;
    
    const toList = parseRecipients(e.to || e.toRecipients);
    const ccList = parseRecipients(e.cc || e.ccRecipients);
    
    db.prepare(`
      INSERT OR REPLACE INTO messages 
      (id, conversation_id, subject, sender_email, sender_name, to_recipients, cc_recipients,
       body_preview, body_text, received_at, is_read, has_attachments, importance, internet_message_id, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id, convId, e.subject || '',
      (e.from || e.senderEmail || '').toLowerCase(),
      e.fromName || e.senderName || '',
      JSON.stringify(toList), JSON.stringify(ccList),
      e.bodyPreview || (e.body || '').slice(0, 255),
      stripHtml(e.body || e.bodyText || e.bodyPreview || ''),
      e.receivedDateTime || e.received_at || new Date().toISOString(),
      e.isRead ? 1 : 0,
      e.hasAttachments ? 1 : 0,
      e.importance || 'normal',
      e.internetMessageId || ''
    );
    
    conversationIds.add(convId);
  }
  
  // Update threads and classify
  for (const convId of conversationIds) {
    updateThread(db, convId);
    await classifyIfNeeded(db, convId);
  }
  
  // Update sync timestamp
  db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('last_mail_sync', ?, datetime('now'))"
  ).run(new Date().toISOString());
  
  console.log(`[watcher] Processed ${emails.length} email(s), ${conversationIds.size} conversation(s)`);
}

/**
 * Process a single calendar event JSON.
 */
function processCalendarEvent(event) {
  const db = getDb();
  
  const events = Array.isArray(event) ? event : [event];
  
  for (const e of events) {
    if (!e.id && !e.subject) continue;
    
    const id = e.id || `cal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let attendees = [];
    
    if (typeof e.attendees === 'string') {
      try { attendees = JSON.parse(e.attendees); }
      catch { attendees = e.attendees.split(';').map(a => ({ email: a.trim(), name: '', response: 'none' })).filter(a => a.email); }
    } else if (Array.isArray(e.attendees)) {
      attendees = e.attendees;
    }
    
    db.prepare(`
      INSERT OR REPLACE INTO events 
      (id, subject, start_time, end_time, location, organizer_email, organizer_name,
       attendees, body_text, is_recurring, importance, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id, e.subject || '', e.start || e.start_time || '',
      e.end || e.end_time || '', e.location || '',
      (e.organizer || e.organizer_email || '').toLowerCase(),
      e.organizerName || e.organizer_name || '',
      JSON.stringify(attendees),
      stripHtml(e.body || e.body_text || ''),
      e.isRecurring || e.is_recurring ? 1 : 0,
      e.importance || 'normal'
    );
  }
  
  db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('last_calendar_sync', ?, datetime('now'))"
  ).run(new Date().toISOString());
  
  console.log(`[watcher] Processed ${events.length} calendar event(s)`);
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
  `).run(conversationId, latest.subject, msgs.length, JSON.stringify(participants), latest.received_at);
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
    `).run(conversationId, result.priority, result.label, result.rule_signals, result.llm_rationale, result.confidence, result.needs_reply);
  } catch (err) {
    console.error(`[classify] Failed for ${conversationId}:`, err.message);
  }
}

function parseRecipients(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(r => typeof r === 'string' ? r : r.email || r.address || '').filter(Boolean);
  if (typeof raw === 'string') {
    // Could be semicolon-separated, comma-separated, or JSON
    try { return JSON.parse(raw); }
    catch { return raw.split(/[;,]/).map(e => e.trim()).filter(Boolean); }
  }
  return [];
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
