/**
 * Commitment extraction engine.
 * 
 * Scans classified email threads for commitments:
 * - Things YOU committed to ("I'll send this by Friday")
 * - Things OTHERS committed to you ("I'll have the doc ready by EOD")
 * - Asks directed at you ("Can you review this by Thursday?")
 * 
 * Uses LLM to extract structured commitments from thread context.
 */
import { getDb } from './db.js';
import * as llm from './llm.js';

const USER_EMAIL = () => (process.env.USER_EMAIL || '').toLowerCase();

/**
 * Extract commitments from a thread.
 * Called after classification — only runs on P0/P1 threads or threads with needs_reply.
 */
export async function extractCommitments(conversationId) {
  const db = getDb();
  
  const thread = db.prepare('SELECT * FROM threads WHERE conversation_id = ?').get(conversationId);
  if (!thread) return [];
  
  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY received_at ASC'
  ).all(conversationId);
  
  if (messages.length === 0) return [];
  
  // Build thread summary for LLM
  const userEmail = USER_EMAIL();
  const threadText = messages.slice(-10).map(m => {
    const isYou = m.sender_email.toLowerCase() === userEmail;
    return `From: ${isYou ? 'YOU' : m.sender_name || m.sender_email} (${m.received_at})\n${m.body_text || m.body_preview}`;
  }).join('\n---\n');
  
  const systemPrompt = `You extract commitments and action items from email threads.

A commitment is:
- An explicit promise to do something ("I'll send the report by Friday")
- A direct ask/request ("Can you review this by EOD?")
- A deadline mentioned for a deliverable

For each commitment, extract:
- owner: who must do it (use the person's name or "YOU" if it's the user)
- description: what needs to be done (short, specific)
- due_date: ISO date if mentioned, null if no deadline
- direction: "yours" (user must do it) or "theirs" (someone owes the user)
- confidence: 0.0-1.0 how confident you are this is a real commitment

Respond ONLY with a JSON array. No explanation. Empty array if no commitments found.
Example: [{"owner":"YOU","description":"Send revised budget estimates","due_date":"2026-02-14","direction":"yours","confidence":0.9}]`;

  const userPrompt = `Thread subject: ${thread.subject}
Thread (${messages.length} messages):

${threadText}

Extract all commitments. JSON array only.`;

  try {
    const response = await llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }], {
      maxTokens: 1024,
      temperature: 0.1,
    });
    
    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const commitments = JSON.parse(jsonStr);
    
    if (!Array.isArray(commitments)) return [];
    
    // Store commitments
    const upsert = db.prepare(`
      INSERT INTO commitments (owner, description, due_date, source_type, source_id, confidence, status)
      VALUES (?, ?, ?, 'email', ?, ?, 'open')
    `);
    
    const stored = [];
    for (const c of commitments) {
      if (!c.description || c.confidence < 0.5) continue;
      
      // Check for duplicates (same description + same source)
      const existing = db.prepare(
        "SELECT id FROM commitments WHERE source_id = ? AND description = ? AND status != 'done'"
      ).get(conversationId, c.description);
      
      if (existing) continue;
      
      const result = upsert.run(
        c.owner || 'Unknown',
        c.description,
        c.due_date || null,
        conversationId,
        c.confidence || 0.7
      );
      
      stored.push({ id: result.lastInsertRowid, ...c });
    }
    
    if (stored.length > 0) {
      console.log(`[commitments] Extracted ${stored.length} from "${thread.subject}"`);
    }
    
    return stored;
  } catch (err) {
    console.error(`[commitments] Extraction failed for ${conversationId}:`, err.message);
    return [];
  }
}

/**
 * Batch extract commitments from all unprocessed P0/P1 threads.
 */
export async function extractAllPending() {
  const db = getDb();
  
  // Find classified threads that haven't been scanned for commitments
  const threads = db.prepare(`
    SELECT c.conversation_id, c.priority, c.needs_reply
    FROM classifications c
    LEFT JOIN (
      SELECT DISTINCT source_id FROM commitments WHERE source_type = 'email'
    ) cm ON c.conversation_id = cm.source_id
    WHERE cm.source_id IS NULL
    AND (c.priority IN ('P0', 'P1') OR c.needs_reply = 1)
    ORDER BY c.priority ASC
    LIMIT 10
  `).all();
  
  let total = 0;
  for (const t of threads) {
    const extracted = await extractCommitments(t.conversation_id);
    total += extracted.length;
  }
  
  return { scanned: threads.length, extracted: total };
}

/**
 * Get overdue commitments.
 */
export function getOverdue() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  
  return db.prepare(`
    SELECT * FROM commitments 
    WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?
    ORDER BY due_date ASC
  `).all(today);
}

/**
 * Mark commitment as done.
 */
export function markDone(commitmentId) {
  const db = getDb();
  db.prepare("UPDATE commitments SET status = 'done', closed_at = datetime('now') WHERE id = ?")
    .run(commitmentId);
}

/**
 * Snooze / update commitment due date.
 */
export function updateDueDate(commitmentId, newDate) {
  const db = getDb();
  db.prepare('UPDATE commitments SET due_date = ? WHERE id = ?')
    .run(newDate, commitmentId);
}
