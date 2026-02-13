/**
 * Full-text search via SQLite FTS5.
 * Searches across messages, threads, events, and commitments.
 */
import { getDb } from './db.js';

let ftsInitialized = false;

/**
 * Initialize FTS5 virtual tables (idempotent).
 */
export function initSearch() {
  const db = getDb();
  
  if (ftsInitialized) return;
  
  db.exec(`
    -- Full-text index on messages
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      conversation_id UNINDEXED,
      subject,
      sender_name,
      sender_email,
      body_text,
      content='messages',
      content_rowid='rowid'
    );

    -- Triggers to keep FTS in sync
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, conversation_id, subject, sender_name, sender_email, body_text)
      VALUES (new.rowid, new.conversation_id, new.subject, new.sender_name, new.sender_email, new.body_text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, conversation_id, subject, sender_name, sender_email, body_text)
      VALUES ('delete', old.rowid, old.conversation_id, old.subject, old.sender_name, old.sender_email, old.body_text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, conversation_id, subject, sender_name, sender_email, body_text)
      VALUES ('delete', old.rowid, old.conversation_id, old.subject, old.sender_name, old.sender_email, old.body_text);
      INSERT INTO messages_fts(rowid, conversation_id, subject, sender_name, sender_email, body_text)
      VALUES (new.rowid, new.conversation_id, new.subject, new.sender_name, new.sender_email, new.body_text);
    END;

    -- Full-text index on events
    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      event_id UNINDEXED,
      subject,
      organizer_name,
      body_text,
      content='events',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, event_id, subject, organizer_name, body_text)
      VALUES (new.rowid, new.id, new.subject, new.organizer_name, new.body_text);
    END;

    CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, event_id, subject, organizer_name, body_text)
      VALUES ('delete', old.rowid, old.id, old.subject, old.organizer_name, old.body_text);
    END;
  `);
  
  ftsInitialized = true;
  console.log('[search] FTS5 indexes initialized');
}

/**
 * Rebuild FTS index from existing data (run once after first sync).
 */
export function rebuildIndex() {
  const db = getDb();
  
  // Clear and rebuild messages FTS
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
  db.exec("INSERT INTO events_fts(events_fts) VALUES('rebuild')");
  
  const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages_fts').get();
  const evtCount = db.prepare('SELECT COUNT(*) as count FROM events_fts').get();
  
  console.log(`[search] Rebuilt index: ${msgCount.count} messages, ${evtCount.count} events`);
  return { messages: msgCount.count, events: evtCount.count };
}

/**
 * Search across emails, events, and commitments.
 * @param {string} query - Search query (supports FTS5 syntax: AND, OR, NOT, "phrases")
 * @param {object} options - { limit, type }
 * @returns {{ emails: [], events: [], commitments: [] }}
 */
export function search(query, options = {}) {
  const db = getDb();
  const { limit = 20, type } = options;
  
  const results = { emails: [], events: [], commitments: [] };
  
  if (!query || query.trim().length === 0) return results;
  
  // Sanitize query for FTS5 (escape special chars)
  const ftsQuery = sanitizeFtsQuery(query);
  
  // Search emails
  if (!type || type === 'email') {
    try {
      results.emails = db.prepare(`
        SELECT m.id, m.conversation_id, m.subject, m.sender_name, m.sender_email, 
               m.body_preview, m.received_at, m.has_attachments,
               c.priority, c.label, c.needs_reply,
               snippet(messages_fts, 4, '<mark>', '</mark>', '...', 40) as snippet
        FROM messages_fts
        JOIN messages m ON messages_fts.rowid = m.rowid
        LEFT JOIN classifications c ON m.conversation_id = c.conversation_id
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit);
    } catch (err) {
      console.error('[search] Email search failed:', err.message);
    }
  }
  
  // Search events
  if (!type || type === 'event') {
    try {
      results.events = db.prepare(`
        SELECT e.*, 
               snippet(events_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
        FROM events_fts
        JOIN events e ON events_fts.rowid = e.rowid
        WHERE events_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit);
    } catch (err) {
      console.error('[search] Event search failed:', err.message);
    }
  }
  
  // Search commitments (simple LIKE since there are fewer)
  if (!type || type === 'commitment') {
    try {
      const likeQuery = `%${query}%`;
      results.commitments = db.prepare(`
        SELECT * FROM commitments
        WHERE description LIKE ? OR owner LIKE ?
        ORDER BY due_date ASC
        LIMIT ?
      `).all(likeQuery, likeQuery, limit);
    } catch (err) {
      console.error('[search] Commitment search failed:', err.message);
    }
  }
  
  return results;
}

/**
 * Sanitize a query string for FTS5.
 * Wraps terms in quotes if they contain special characters.
 */
function sanitizeFtsQuery(query) {
  // If user used explicit FTS syntax (AND, OR, NOT, quotes), pass through
  if (/\b(AND|OR|NOT)\b/.test(query) || query.includes('"')) {
    return query;
  }
  
  // Otherwise, treat as a simple phrase search or implicit AND
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 1) return `"${terms[0]}"*`; // Prefix search for single term
  return terms.map(t => `"${t}"`).join(' '); // Implicit AND
}
