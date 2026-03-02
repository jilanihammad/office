# Office

AI executive assistant that triages email by urgency, tracks commitments extracted from threads, generates tone-matched draft replies, and compiles meeting prep briefs. Runs locally with zero cloud exposure beyond the LLM API call.

## What It Does

- **Hybrid email classification.** Rule engine scores 15+ signals (sender VIP status, direct vs. CC, urgency keywords, thread state, age, distribution size), then invokes Claude only for borderline cases (confidence < 0.7). Outputs P0-P3 priority with rationale. Most emails classify in <1ms. LLM handles ~15-25% of threads.
- **Commitment tracking.** LLM extracts structured commitments from P0/P1 threads: who, what, due date, direction (yours vs. theirs). Surfaces overdue items in the daily brief.
- **Draft generation.** Generates reply variants tone-matched to your writing style via a style learner that ingests your sent emails (rolling window of 50 examples).
- **Meeting prep briefs.** Before each meeting, compiles related email threads (by participant + subject overlap), open commitments involving attendees, and prior meeting context. Generates a 3-5 bullet prep brief.
- **Daily command brief.** Single view: urgent emails, today's meetings, overdue commitments.
- **Full-text search.** SQLite FTS5 across all emails, calendar events, and commitments.

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Dashboard (Next.js, port 3000)          │
│  Inbox · Thread detail · Calendar · Commitments │
└──────────────────────┬──────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────┐
│           Server (Express, port 3456)            │
│  classifier.js ── hybrid rules + LLM triage     │
│  commitments.js ─ LLM extraction + tracking      │
│  meetingprep.js ─ context assembly + LLM brief   │
│  stylelearner.js  sent email ingestion           │
│  outbox.js ────── send via Power Automate        │
│  search.js ────── FTS5 across all entities       │
│  sync.js ──────── Graph API delta sync           │
│  db.js ────────── SQLite schema (11 tables)      │
│  llm.js ───────── Bedrock Claude wrapper         │
└──────────────────────┬──────────────────────────┘
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐  ┌───────────┐  ┌──────────┐
   │ SQLite  │  │ MS Graph  │  │ Bedrock  │
   │ (local) │  │   API     │  │ Claude   │
   └─────────┘  └───────────┘  └──────────┘
```

**Data flow:** Power Automate exports emails to OneDrive drop folder, file watcher picks them up, Graph API delta sync for incremental updates, classifier scores, commitment extractor runs on P0/P1, everything stored in local SQLite.

**Nothing leaves the machine** except Microsoft Graph calls (email/calendar sync) and AWS Bedrock calls (LLM).

## The Classifier

The hybrid classifier (`classifier.js`, 262 lines):

**Rule-based first pass** (deterministic, ~0ms):
- Sender VIP rules with wildcard matching
- Recipient position: direct To (+20) vs CC-only (-10)
- Urgency keywords: "ASAP", "blocker", "EOD" (+30) / "FYI", "no action" (-20)
- Ask detection: "please review", "can you", "approval needed" (+20-25)
- Thread state: awaiting your reply (+25), you replied last (-15)
- Age signals: unanswered >24h (+15), >48h (+30)
- Distribution: >20 recipients (-30), >50 (-50)

**LLM second pass** (borderline only, confidence < 0.7):
- Sends thread summary with rule signals
- LLM returns priority, needs-reply, and one-sentence rationale
- Email content marked UNTRUSTED with explicit instruction to ignore embedded overrides

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, TypeScript |
| Backend | Express.js (ESM), Node.js |
| Database | SQLite via better-sqlite3 (11 tables + FTS5) |
| LLM | AWS Bedrock (Claude) |
| Email | Microsoft Graph API, Azure AD device code auth |
| Ingestion | Power Automate, OneDrive, local file watcher |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/brief` | Daily command brief |
| GET | `/api/threads` | Prioritized inbox |
| GET | `/api/thread/:id` | Thread + messages + classification |
| POST | `/api/draft/:id` | Generate reply draft |
| POST | `/api/sync` | Trigger email/calendar sync |
| GET | `/api/events` | Calendar (7-day view) |
| GET | `/api/commitments` | Tracked follow-ups |
| GET | `/api/search?q=` | Full-text search |

## Quick Start

```bash
npm install && cd server && npm install && cd ../dashboard && npm install

cp server/.env.example server/.env
# Set: DROP_FOLDER, AWS credentials, USER_EMAIL

npm run dev  # API on :3456, Dashboard on :3000
```

Requires: Azure AD app registration (Mail.Read, Calendars.Read, User.Read) + Power Automate flow for email ingestion. See `docs/POWER_AUTOMATE_SETUP.md`.

## Testing

55 tests covering security, reliability, and data integrity.

Run: `cd server && node --test test/`

## License

Private
