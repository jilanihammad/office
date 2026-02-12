/**
 * Sync engine — polls Graph API for new emails and calendar events,
 * stores in SQLite, triggers classification.
 */
import { getDb } from './db.js';
import * as graph from './graph.js';
import { classifyThread } from './classifier.js';

/**
 * Sync inbox messages (delta query for incremental updates).
 */
export async function syncMessages() {
  const db = getDb();
  
  // Get stored delta link for incremental sync
  const deltaRow = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('mail_delta_link');
  const deltaLink = deltaRow?.value || null;
  
  console.log(`[sync] Fetching messages${deltaLink ? ' (delta)' : ' (full)'}...`);
  
  const { messages, deltaLink: newDeltaLink } = await graph.fetchNewMessages(deltaLink);
  
  console.log(`[sync] Received ${messages.length} messages`);
  
  // Upsert messages
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO messages 
    (id, conversation_id, subject, sender_email, sender_name, to_recipients, cc_recipients, 
     body_preview, body_text, received_at, is_read, has_attachments, importance, internet_message_id, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  
  const insertMany = db.transaction((msgs) => {
    for (const m of msgs) {
      upsert.run(
        m.id, m.conversation_id, m.subject, m.sender_email, m.sender_name,
        m.to_recipients, m.cc_recipients, m.body_preview, m.body_text,
        m.received_at, m.is_read, m.has_attachments, m.importance, m.internet_message_id
      );
    }
  });
  
  insertMany(messages);
  
  // Save new delta link
  if (newDeltaLink) {
    db.prepare(
      'INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
    ).run('mail_delta_link', newDeltaLink);
  }
  
  // Update thread aggregates for affected conversations
  const conversationIds = [...new Set(messages.map(m => m.conversation_id))];
  await updateThreads(db, conversationIds);
  
  // Save last sync time
  db.prepare(
    'INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run('last_mail_sync', new Date().toISOString());
  
  return { synced: messages.length, conversations: conversationIds.length };
}

/**
 * Update thread records for given conversation IDs.
 */
async function updateThreads(db, conversationIds) {
  const updateThread = db.prepare(`
    INSERT OR REPLACE INTO threads (conversation_id, subject, message_count, participants, latest_message_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  
  for (const convId of conversationIds) {
    const msgs = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
    ).all(convId);
    
    if (msgs.length === 0) continue;
    
    const participants = [...new Set(msgs.flatMap(m => {
      const to = safeParseArray(m.to_recipients);
      const cc = safeParseArray(m.cc_recipients);
      return [m.sender_email, ...to, ...cc].filter(Boolean);
    }))];
    
    const latest = msgs[msgs.length - 1];
    
    updateThread.run(
      convId,
      latest.subject,
      msgs.length,
      JSON.stringify(participants),
      latest.received_at
    );
  }
}

/**
 * Classify unclassified threads.
 */
export async function classifyNewThreads() {
  const db = getDb();
  
  // Find threads without classifications
  const unclassified = db.prepare(`
    SELECT t.* FROM threads t
    LEFT JOIN classifications c ON t.conversation_id = c.conversation_id
    WHERE c.conversation_id IS NULL
    ORDER BY t.latest_message_at DESC
    LIMIT 20
  `).all();
  
  console.log(`[classify] ${unclassified.length} threads to classify`);
  
  const upsertClassification = db.prepare(`
    INSERT OR REPLACE INTO classifications 
    (conversation_id, priority, label, rule_signals, llm_rationale, confidence, needs_reply, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  
  for (const thread of unclassified) {
    const messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
    ).all(thread.conversation_id);
    
    const result = await classifyThread({
      conversation_id: thread.conversation_id,
      subject: thread.subject,
      messages,
    });
    
    upsertClassification.run(
      thread.conversation_id,
      result.priority,
      result.label,
      result.rule_signals,
      result.llm_rationale,
      result.confidence,
      result.needs_reply
    );
  }
  
  return { classified: unclassified.length };
}

/**
 * Sync calendar events for today + next 7 days.
 */
export async function syncCalendar() {
  const db = getDb();
  
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);
  
  console.log(`[sync] Fetching calendar events ${startDate.toISOString()} to ${endDate.toISOString()}...`);
  
  const events = await graph.fetchCalendarEvents(startDate, endDate);
  
  console.log(`[sync] Received ${events.length} events`);
  
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO events 
    (id, subject, start_time, end_time, location, organizer_email, organizer_name,
     attendees, body_text, is_recurring, importance, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  
  const insertMany = db.transaction((evts) => {
    for (const e of evts) {
      upsert.run(
        e.id, e.subject, e.start_time, e.end_time, e.location,
        e.organizer_email, e.organizer_name, e.attendees, e.body_text,
        e.is_recurring, e.importance
      );
    }
  });
  
  insertMany(events);
  
  db.prepare(
    'INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run('last_calendar_sync', new Date().toISOString());
  
  return { synced: events.length };
}

/**
 * Full sync cycle: messages + calendar + classify.
 */
export async function fullSync() {
  const results = {};
  
  try {
    results.messages = await syncMessages();
  } catch (err) {
    console.error('[sync] Message sync failed:', err.message);
    results.messages = { error: err.message };
  }
  
  try {
    results.calendar = await syncCalendar();
  } catch (err) {
    console.error('[sync] Calendar sync failed:', err.message);
    results.calendar = { error: err.message };
  }
  
  try {
    results.classification = await classifyNewThreads();
  } catch (err) {
    console.error('[sync] Classification failed:', err.message);
    results.classification = { error: err.message };
  }
  
  return results;
}

function safeParseArray(json) {
  try { return JSON.parse(json || '[]'); }
  catch { return []; }
}
