# Office — AI Executive Assistant

AI-powered executive assistant for Outlook/M365. Email triage, calendar awareness, draft generation, and a daily command brief.

## Architecture

```
office/
├── server/          Express API (port 3456)
│   ├── server.js    API endpoints
│   └── lib/
│       ├── db.js        SQLite (better-sqlite3)
│       ├── graph.js     Microsoft Graph API
│       ├── sync.js      Incremental sync engine
│       ├── classifier.js Hybrid rules + LLM classifier
│       └── llm.js       Bedrock Claude integration
├── dashboard/       Next.js frontend (port 3000)
│   └── app/
│       ├── page.tsx           Command brief + inbox
│       ├── thread/[id]/       Thread detail + drafts
│       ├── calendar/          7-day calendar view
│       └── commitments/       Follow-up tracker
└── data/            SQLite database
```

## Quick Start

```bash
# 1. Configure
cp server/.env.example server/.env
# Edit: AZURE_CLIENT_ID, AZURE_TENANT_ID, AWS credentials, USER_EMAIL

# 2. Install
npm install
cd server && npm install && cd ..
cd dashboard && npm install && cd ..

# 3. Run
npm run dev
# → API:       http://localhost:3456
# → Dashboard: http://localhost:3000
```

## Features

### Phase 1 (Built)
- **Email sync** — Incremental via Graph API delta queries
- **Hybrid classification** — Rule-based first pass + LLM for borderline (P0-P3)
- **Draft generation** — Concise and full variants, tone-matched, with custom instructions
- **Calendar sync** — 7-day view with meeting details
- **Daily command brief** — Urgent emails, meetings, overdue follow-ups
- **Commitment tracker** — Track promises and follow-ups
- **Priority override** — Manual reclassification
- **Sender rules** — Boost/demote specific senders

### Phase 2 (Planned)
- Meeting prep briefs (auto-generated before meetings)
- Commitment extraction from emails/meetings
- Smart delegation suggestions
- Weekly executive digest
- Time protection engine

## Data Model

All data stored locally in SQLite (`data/emailwiz.db`):
- `messages` — Raw email messages
- `threads` — Aggregated conversation threads
- `classifications` — Priority + signals + LLM rationale
- `drafts` — Generated reply drafts
- `events` — Calendar events
- `commitments` — Tracked follow-ups
- `relationship_memory` — Contact context
- `institutional_memory` — Decisions/milestones
- `sender_rules` — Priority rules by sender
- `style_examples` — Your writing samples for tone matching
- `sync_state` — Delta links and cursors

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Status + sync state |
| GET | `/api/brief` | Daily command brief |
| GET | `/api/threads` | Prioritized inbox (filter by priority) |
| GET | `/api/thread/:id` | Thread + messages + classification |
| GET | `/api/events` | Calendar events |
| GET | `/api/commitments` | Tracked follow-ups |
| GET | `/api/stats` | Dashboard stats |
| POST | `/api/sync` | Manual sync trigger |
| POST | `/api/draft/:id` | Generate reply draft |
| POST | `/api/classify/:id` | Reclassify thread |
| POST | `/api/override/:id` | Override priority |
| GET/POST | `/api/sender-rules` | Manage sender rules |

## Auth

Uses Azure AD device code flow. On first start, you'll see a URL + code to authenticate in your browser. Tokens refresh automatically.

Requires Azure AD app registration with these Graph API permissions:
- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
- `Calendars.Read`, `Calendars.ReadWrite`
- `User.Read`
