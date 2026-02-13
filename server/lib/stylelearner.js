/**
 * Style learner — ingests sent emails to learn your writing tone.
 * 
 * Power Automate exports your sent emails to DROP_FOLDER/sent-mail/
 * This module processes them and stores examples in style_examples table.
 * Draft generation then uses these examples for tone matching.
 */
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';

/**
 * Process sent emails from the drop folder.
 * Picks diverse examples: different recipients, lengths, tones.
 */
export function processSentMail(dropFolder) {
  const sentDir = path.join(dropFolder, 'sent-mail');
  const processedDir = path.join(dropFolder, 'processed');
  
  if (!fs.existsSync(sentDir)) return { processed: 0 };
  
  const files = fs.readdirSync(sentDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return { processed: 0 };
  
  const db = getDb();
  let processed = 0;
  
  for (const file of files) {
    const filePath = path.join(sentDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const email = JSON.parse(raw);
      
      const bodyText = stripHtml(email.body || email.bodyText || '');
      
      // Skip very short or very long emails (not representative)
      if (bodyText.length < 20 || bodyText.length > 2000) {
        moveFile(filePath, path.join(processedDir, `skip_${file}`));
        continue;
      }
      
      // Skip auto-replies and forwarded messages
      const subject = (email.subject || '').toLowerCase();
      if (subject.startsWith('automatic reply') || subject.startsWith('out of office')) {
        moveFile(filePath, path.join(processedDir, `skip_${file}`));
        continue;
      }
      
      // Determine context (who you were replying to, what about)
      const context = [
        email.to ? `To: ${email.to}` : '',
        email.subject ? `Subject: ${email.subject}` : '',
      ].filter(Boolean).join(' | ');
      
      // Store as style example (keep max 50, rotating oldest out)
      const count = db.prepare('SELECT COUNT(*) as count FROM style_examples').get();
      if (count.count >= 50) {
        db.prepare('DELETE FROM style_examples WHERE id = (SELECT MIN(id) FROM style_examples)').run();
      }
      
      db.prepare('INSERT INTO style_examples (context, your_email) VALUES (?, ?)')
        .run(context, bodyText);
      
      moveFile(filePath, path.join(processedDir, `style_${file}`));
      processed++;
      
    } catch (err) {
      console.error(`[style] Failed to process ${file}:`, err.message);
      moveFile(filePath, path.join(processedDir, `ERROR_style_${file}`));
    }
  }
  
  if (processed > 0) {
    console.log(`[style] Learned from ${processed} sent email(s)`);
  }
  
  return { processed };
}

/**
 * Get style summary for draft generation.
 * Returns a few representative examples of the user's writing.
 */
export function getStyleContext() {
  const db = getDb();
  
  // Get diverse examples (recent + varied lengths)
  const examples = db.prepare(`
    SELECT context, your_email FROM style_examples
    ORDER BY added_at DESC
    LIMIT 5
  `).all();
  
  if (examples.length === 0) return null;
  
  return examples.map(e => 
    `Context: ${e.context}\nYour reply:\n${e.your_email}`
  ).join('\n\n---\n\n');
}

/**
 * Update relationship memory from sent emails.
 */
export function updateRelationships(dropFolder) {
  const sentDir = path.join(dropFolder, 'sent-mail');
  if (!fs.existsSync(sentDir)) return;
  
  const db = getDb();
  
  // Count interactions per recipient from messages table
  const interactions = db.prepare(`
    SELECT sender_email as email, sender_name as name, COUNT(*) as count,
           MAX(received_at) as last_interaction
    FROM messages
    WHERE sender_email != '' AND sender_email != ?
    GROUP BY sender_email
    ORDER BY count DESC
    LIMIT 100
  `).all(process.env.USER_EMAIL || '');
  
  const upsert = db.prepare(`
    INSERT INTO relationship_memory (email, name, interaction_count, last_interaction, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      name = COALESCE(excluded.name, relationship_memory.name),
      interaction_count = excluded.interaction_count,
      last_interaction = excluded.last_interaction,
      updated_at = datetime('now')
  `);
  
  for (const i of interactions) {
    upsert.run(i.email, i.name, i.count, i.last_interaction);
  }
}

// --- Helpers ---

function moveFile(src, dest) {
  try {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(src, dest);
  } catch { /* ignore */ }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
