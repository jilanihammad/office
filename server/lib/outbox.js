/**
 * Outbox — send emails via Power Automate.
 * 
 * Writes a JSON file to DROP_FOLDER/outbox/.
 * A Power Automate flow watches this OneDrive folder,
 * reads the JSON, and sends the email via Outlook.
 * 
 * Flow template:
 *   Trigger: "When a file is created" in OneDrive /Office-Drop/outbox/
 *   Action: "Get file content" → parse JSON
 *   Action: "Send an email (V2)" using parsed fields
 *   Action: "Delete file" after sending
 */
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';

/**
 * Queue a draft for sending via Power Automate outbox.
 * @param {number} draftId - Draft ID from the drafts table
 * @param {object} options - { replyAll, conversationId }
 * @returns {{ ok: boolean, outboxFile: string }}
 */
export function queueForSend(draftId, options = {}) {
  const db = getDb();
  const dropFolder = process.env.DROP_FOLDER;
  
  if (!dropFolder) {
    throw new Error('DROP_FOLDER not configured — cannot send via outbox');
  }
  
  const outboxDir = path.join(dropFolder, 'outbox');
  if (!fs.existsSync(outboxDir)) {
    fs.mkdirSync(outboxDir, { recursive: true });
  }
  
  // Get the draft (atomic check-and-update to prevent double-send)
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
  if (!draft) throw new Error(`Draft ${draftId} not found`);
  if (draft.status === 'sent' || draft.status === 'queued') {
    throw new Error(`Draft ${draftId} already ${draft.status}`);
  }
  
  // Immediately mark as queued to prevent race condition
  const updated = db.prepare(
    "UPDATE drafts SET status = 'queued' WHERE id = ? AND status = 'draft'"
  ).run(draftId);
  if (updated.changes === 0) throw new Error(`Draft ${draftId} already being sent`);
  
  // Get the thread and latest message for reply context
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?')
    .get(draft.conversation_id);
  const latestMsg = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at DESC LIMIT 1'
  ).get(draft.conversation_id);
  
  if (!latestMsg) throw new Error('No messages found in thread');
  
  // Determine recipients
  const toRecipients = parseRecipients(latestMsg.to_recipients);
  const ccRecipients = parseRecipients(latestMsg.cc_recipients);
  const senderEmail = latestMsg.sender_email;
  const userEmail = (process.env.USER_EMAIL || '').toLowerCase();
  
  let to, cc;
  if (options.replyAll) {
    // Reply all: send to original sender + all To/CC minus yourself
    to = [senderEmail, ...toRecipients].filter(e => e.toLowerCase() !== userEmail);
    cc = ccRecipients.filter(e => e.toLowerCase() !== userEmail);
    // Deduplicate
    to = [...new Set(to)];
    cc = cc.filter(e => !to.includes(e));
  } else {
    // Reply: send only to the sender
    to = [senderEmail];
    cc = [];
  }
  
  // Normalize reply subject — strip common intl prefixes (issue #22)
  const rawSubject = thread?.subject || latestMsg.subject || '';
  const cleanSubject = rawSubject.replace(/^(Re|Fw|Fwd|SV|VS|AW|TR|RE|FW|Antwort|Antw|Rif|R|RES|ENC|Doorst|Vl|Ynt|Svb):\s*/gi, '').trim();
  
  // Build the outbox JSON
  const outboxEntry = {
    action: 'reply',
    messageId: latestMsg.id,
    conversationId: draft.conversation_id,
    subject: `Re: ${cleanSubject}`,
    to: to.join(';'),
    cc: cc.join(';'),
    body: draft.body_text,
    replyAll: !!options.replyAll,
    draftId: draftId,
    createdAt: new Date().toISOString(),
    internetMessageId: latestMsg.internet_message_id || '',
  };
  
  // Write to outbox folder (tmp + rename for atomicity, rollback on failure)
  const fileName = `send_${draftId}_${Date.now()}.json`;
  const filePath = path.join(outboxDir, fileName);
  const tmpPath = filePath + '.tmp';
  
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(outboxEntry, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch (writeErr) {
    // Rollback: restore draft to 'draft' status
    db.prepare("UPDATE drafts SET status = 'draft' WHERE id = ?").run(draftId);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new Error(`Failed to write outbox file: ${writeErr.message}`);
  }
  
  // Update sent timestamp
  db.prepare("UPDATE drafts SET sent_at = datetime('now') WHERE id = ?")
    .run(draftId);
  
  console.log(`[outbox] Queued draft ${draftId} → ${fileName}`);
  
  return { ok: true, outboxFile: fileName, to, cc };
}

/**
 * Check outbox status — how many pending, sent, failed.
 */
export function outboxStatus() {
  const dropFolder = process.env.DROP_FOLDER;
  if (!dropFolder) return { enabled: false };
  
  const outboxDir = path.join(dropFolder, 'outbox');
  const sentDir = path.join(dropFolder, 'sent');
  
  let pending = 0, sent = 0;
  
  try {
    pending = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json')).length;
  } catch { /* dir might not exist */ }
  
  try {
    sent = fs.readdirSync(sentDir).filter(f => f.endsWith('.json')).length;
  } catch { /* dir might not exist */ }
  
  return { enabled: true, pending, sent };
}

function parseRecipients(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    return [];
  } catch {
    return [];
  }
}
