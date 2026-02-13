/**
 * Database layer — SQLite via better-sqlite3
 * All email/calendar/memory data stored locally.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'emailwiz.db');

let db;

export function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');     // Wait up to 5s on lock contention
  db.pragma('wal_autocheckpoint = 1000'); // Auto-checkpoint every 1000 pages
  initSchema(db);
  
  // Additional indexes for large inbox performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_threads_latest ON threads(latest_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_classifications_priority ON classifications(priority);
    CREATE INDEX IF NOT EXISTS idx_commitments_status_due ON commitments(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_drafts_conversation ON drafts(conversation_id);
  `);
  
  return db;
}

function initSchema(db) {
  db.exec(`
    -- Email messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      subject TEXT,
      sender_email TEXT,
      sender_name TEXT,
      to_recipients TEXT,
      cc_recipients TEXT,
      body_preview TEXT,
      body_text TEXT,
      received_at TEXT,
      is_read INTEGER DEFAULT 0,
      has_attachments INTEGER DEFAULT 0,
      importance TEXT,
      internet_message_id TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_email);

    -- Threads (aggregated view of conversations)
    CREATE TABLE IF NOT EXISTS threads (
      conversation_id TEXT PRIMARY KEY,
      subject TEXT,
      message_count INTEGER DEFAULT 0,
      participants TEXT,
      latest_message_at TEXT,
      thread_state TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Classifications
    CREATE TABLE IF NOT EXISTS classifications (
      conversation_id TEXT PRIMARY KEY,
      priority TEXT,
      label TEXT,
      rule_signals TEXT,
      llm_rationale TEXT,
      confidence REAL,
      needs_reply INTEGER DEFAULT 0,
      classified_at TEXT DEFAULT (datetime('now')),
      overridden INTEGER DEFAULT 0,
      user_priority TEXT
    );

    -- Response drafts
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      variant TEXT,
      body_text TEXT,
      reply_type TEXT,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    );

    -- Calendar events
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      subject TEXT,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      organizer_email TEXT,
      organizer_name TEXT,
      attendees TEXT,
      body_text TEXT,
      is_recurring INTEGER DEFAULT 0,
      importance TEXT,
      prep_brief TEXT,
      prep_generated_at TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);

    -- Commitments tracker
    CREATE TABLE IF NOT EXISTS commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT,
      description TEXT,
      due_date TEXT,
      source_type TEXT,
      source_id TEXT,
      confidence REAL,
      status TEXT DEFAULT 'open',
      nudge_count INTEGER DEFAULT 0,
      last_nudged_at TEXT,
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Relationship memory
    CREATE TABLE IF NOT EXISTS relationship_memory (
      email TEXT PRIMARY KEY,
      name TEXT,
      role TEXT,
      relationship TEXT,
      patterns TEXT,
      notes TEXT,
      last_interaction TEXT,
      interaction_count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Institutional memory (decisions, milestones)
    CREATE TABLE IF NOT EXISTS institutional_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      date TEXT,
      summary TEXT,
      participants TEXT,
      source_type TEXT,
      source_ids TEXT,
      project TEXT,
      implications TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Working memory (daily session state)
    CREATE TABLE IF NOT EXISTS working_memory (
      date TEXT PRIMARY KEY,
      state TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sender rules (priority boosting)
    CREATE TABLE IF NOT EXISTS sender_rules (
      email_pattern TEXT PRIMARY KEY,
      priority_boost INTEGER DEFAULT 0,
      label TEXT
    );

    -- Style examples (for draft tone matching)
    CREATE TABLE IF NOT EXISTS style_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context TEXT,
      your_email TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );

    -- Sync state (delta links, cursors)
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export function close() {
  if (db) { db.close(); db = null; }
}
