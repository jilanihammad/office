# Email Wiz — PRD & Project Plan

*AI-powered executive assistant for Outlook/M365 — email triage, calendar intelligence, meeting prep, follow-up tracking, and response drafting. Goal: eliminate 80% of operational overhead so you focus on thinking and building.*

---

## Problem

Corporate PMs lose 15-25 hours/week to operational overhead: scanning hundreds of emails, prepping for meetings, chasing follow-ups, tracking commitments, coordinating across teams. The actual thinking and building — the high-value work — gets squeezed into the gaps.

## Vision

A personal executive assistant that handles the operational tax:
1. **Email** — Prioritized inbox with draft responses ready to review and send
2. **Calendar** — Meeting prep packets auto-generated, focus time protected
3. **Follow-ups** — Commitments tracked across email and meetings, nudges drafted automatically
4. **Daily brief** — One view of what needs attention, what's overdue, what's coming up
5. **Delegation** — Detect work that should be forwarded, draft the handoff

**One sentence:** Open the dashboard in the morning, see exactly what needs your attention, with drafts ready and context loaded — then get back to real work.

## Impact Model

| Feature | Time Saved/Week | Complexity |
|---------|----------------|------------|
| Daily Command Brief + Action Queue | 4-6 hrs | M (1-2 wks) |
| Auto Meeting Prep Briefs | 3-5 hrs | M |
| Commitment Tracker + Auto Follow-ups | 2-4 hrs | M |
| Time Protection Engine | 2-4 hrs | M |
| Smart Delegation Assistant | 1.5-3 hrs | S-M |
| Email Classification + Response Drafting | 3-5 hrs | M |
| Post-Meeting Autopilot | 1-2 hrs | M |
| Decision Register | 1-2 hrs | M |
| **Total potential** | **~18-31 hrs/week** | |

*S = 2-5 days, M = 1-2 weeks, L = 3-6 weeks*

---

## User Persona

- Corporate PM at a large tech company
- Gets 100-300+ emails/day across multiple workstreams
- Email is primary communication channel for cross-functional work
- Needs to identify action items, deadlines, escalations quickly
- Writing style: direct, professional, concise

---

## Core Features

### F1: Inbox Sync
- Connect to Outlook via Microsoft Graph API (or Power Automate fallback)
- Delta polling every 2-5 minutes for new/updated messages
- Full thread retrieval — not just latest message, the entire conversation
- Handle: plain text, HTML bodies, attachments (metadata only for MVP), forwarded chains
- Incremental sync — don't re-process already-classified emails

### F2: Email Classification
**Hybrid approach: rules + LLM**

**Rule-based first pass (fast, deterministic):**
- Direct-to-you (To:) vs CC'd vs mailing list → weight differently
- Sender importance: manager chain, known VPs/directors, skip-levels → auto-boost
- Keywords: "EOD", "by Friday", "action required", "please review", "blocker" → urgency signals
- Thread participation: you were asked a direct question → needs reply
- Age: unanswered for >24h and you're in To: → urgency boost
- Mailing list / mass distribution → auto-low unless you're mentioned by name

**LLM second pass (nuance):**
- Read thread summary, classify with reasoning
- Detect implicit asks ("would be great to get your thoughts" = action item)
- Detect FYI vs action-required vs decision-needed
- Confidence score + rationale stored for explainability

**Output categories:**

| Priority | Label | Definition | Example |
|----------|-------|-----------|---------|
| P0 | Urgent — Reply Today | Direct ask, deadline today/tomorrow, escalation, blocker | "Need your approval by EOD" |
| P1 | Important — This Week | Action needed but not time-critical, important decisions | "Can you review this doc by Friday?" |
| P2 | Follow Up | You should read and may need to respond eventually | "Sharing meeting notes from yesterday" |
| P3 | FYI / Archive | Informational, no action needed | Mailing list updates, newsletters |

### F3: Thread Analysis
Before drafting a response, build a structured "thread state":

```
{
  subject: "Q1 Planning — Budget Allocation",
  participants: ["VP Finance", "PM Lead", "You", "3 others"],
  threadLength: 8 messages over 3 days,
  summary: "VP Finance asked for Q1 budget proposals. PM Lead shared initial numbers. VP pushed back on headcount ask. You were asked to provide revised estimates.",
  openQuestions: ["What's your revised headcount estimate?", "Can you share the updated timeline?"],
  commitments: ["You committed to sharing revised numbers by Thursday"],
  deadlines: ["Thursday EOD for revised estimates"],
  sentiment: "slightly tense — budget pressure",
  yourLastMessage: "I'll have updated numbers by Thursday",
  pendingAction: "Share revised headcount estimates"
}
```

This is the pre-computed context that feeds the LLM — same principle as leadership-autopilot. The LLM reads structured data, it doesn't parse raw email chains.

### F4: Response Drafting
- Generate two variants: **concise** (2-3 sentences) and **full** (detailed)
- Tone matching from your writing style (seed with 10-15 examples of your actual sent emails)
- Detect reply vs reply-all: who was asked the question? who needs to see the answer?
- Handle: acknowledgments ("Got it, thanks"), information requests, decision responses, delegation
- Never auto-send — all drafts go to review queue
- One-click: approve draft → create in Outlook drafts folder (or send directly if you trust it)

### F5: Dashboard
```
┌──────────────────────────────────────────────────────────┐
│  Email Wiz                                    [Sync ✓]   │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  FILTERS   │  🔴 Urgent — Reply Today (5)               │
│            │  ┌─────────────────────────────────────┐    │
│  ○ All     │  │ VP Finance — Q1 Budget Allocation    │    │
│  ● Urgent  │  │ "Need revised estimates by EOD"      │    │
│  ○ Important│ │ [View Thread] [Edit Draft] [Send]    │    │
│  ○ Follow Up│ └─────────────────────────────────────┘    │
│  ○ FYI     │  ┌─────────────────────────────────────┐    │
│            │  │ PM Lead — Launch Readiness Review     │    │
│  STATS     │  │ "Blocker: need your sign-off"        │    │
│  Processed │  │ [View Thread] [Edit Draft] [Send]    │    │
│  today: 47 │  └─────────────────────────────────────┘    │
│  Drafts    │                                             │
│  ready: 12 │  🟡 Important — This Week (8)              │
│  Sent: 3   │  ...                                        │
│            │                                             │
├────────────┤  📋 Thread View (expanded)                  │
│            │  ┌─────────────────────────────────────┐    │
│  SETTINGS  │  │ Thread summary + participants        │    │
│  • Sync    │  │ Open questions highlighted           │    │
│  • Style   │  │ Your commitments / deadlines         │    │
│  • Rules   │  │                                      │    │
│            │  │ --- Draft Response ---                │    │
│            │  │ [Concise] [Full] tabs                │    │
│            │  │ Editable text area with draft        │    │
│            │  │ [Send] [Send as Reply-All] [Save]    │    │
│            │  └─────────────────────────────────────┘    │
└────────────┴─────────────────────────────────────────────┘
```

### F6: Action Items Extraction
- Parse all threads for commitments you made or were assigned
- Track: what, to whom, deadline, status (pending/done)
- Surface on dashboard: "You have 3 overdue commitments"
- Pull from both incoming asks and your own outgoing promises

---

## Calendar + Executive Assistant Features

### F7: Calendar Sync
- Connect to Outlook Calendar via Microsoft Graph API
- Scopes: `Calendars.Read`, `Calendars.ReadWrite` (for creating focus blocks)
- Sync events: title, attendees, time, location, body/agenda, recurrence
- Delta polling alongside email sync
- Link meetings to email threads by participants + subject overlap

### F8: Daily Command Brief
**The morning dashboard — one view of your entire day.**

Generated at 7:30 AM (configurable), updated on demand:

```
╔══════════════════════════════════════════════════╗
║  DAILY BRIEF — Thursday, Feb 12                  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  🔴 MUST DECIDE NOW (3)                          ║
║  • VP Finance wants budget revisions — EOD       ║
║    [Draft Ready] [View Thread]                   ║
║  • Launch readiness sign-off — blocker           ║
║    [Draft Ready] [View Thread]                   ║
║  • Headcount approval request from PM Lead       ║
║    [Draft Ready] [View Thread]                   ║
║                                                  ║
║  📋 MUST PREP TODAY (2)                          ║
║  • 2:00 PM — VP Review (prep brief ready)        ║
║    [View Brief]                                  ║
║  • 4:00 PM — Cross-functional sync               ║
║    [View Brief]                                  ║
║                                                  ║
║  ⏳ OVERDUE FOLLOW-UPS (2)                       ║
║  • Data team owes you API spec (2 days late)     ║
║    [Send Nudge]                                  ║
║  • You owe marketing the launch timeline         ║
║    [Draft Response]                              ║
║                                                  ║
║  📅 TODAY'S MEETINGS (6) — 4.5 hrs meeting load  ║
║  • 9:00 — Standup (30m)                          ║
║  • 10:00 — 1:1 with Manager (30m) [Prep Ready]  ║
║  • 11:00 — Sprint Planning (1h)                  ║
║  • 1:00 — Lunch (blocked)                        ║
║  • 2:00 — VP Review (1h) [Prep Ready] ⚠️         ║
║  • 4:00 — Cross-functional sync (30m)            ║
║                                                  ║
║  ✅ CAN DEFER (8 emails)                         ║
║  [View All]                                      ║
║                                                  ║
╚══════════════════════════════════════════════════╝
```

Three sections only: **Must decide now / Must prep today / Can defer.**

One-click actions on every item: Draft reply, Nudge, Delegate, Decline, Snooze.

### F9: Auto Meeting Prep Briefs
**Generated 15-30 minutes before important meetings.**

Trigger criteria (any of):
- VP or director attending
- External attendees
- No clear agenda in invite
- Strategic project tag
- You haven't met with these people in >2 weeks

Brief format (90-second read):

```
MEETING PREP: VP Review — Q1 Budget Allocation
Thursday 2:00 PM — 3:00 PM | Conference Room B

GOAL: Get approval on revised headcount estimates

ATTENDEES:
• Sarah Chen (VP Finance) — last email: pushed back on headcount numbers
• Mike Torres (PM Lead) — shared initial budget proposal
• You — committed to revised estimates by today

CONTEXT (from recent threads):
• Original ask: $2.4M headcount budget for Q1
• VP concern: headcount growth rate vs revenue growth
• Your revised proposal: $1.8M with phased hiring
• Open question: whether to include contractor budget

OPEN ACTION ITEMS:
• [YOU] Share revised headcount estimates (due today)
• [Mike] Update project timeline to reflect new budget

RECENT DECISIONS:
• Agreed to defer 2 hires to Q2 (email thread, Feb 8)
• Marketing budget approved as-is (meeting, Feb 6)

RECOMMENDED TALK TRACK:
1. Lead with revised $1.8M number + phased approach
2. Address contractor question proactively
3. Ask for approval contingent on Q1 revenue targets
```

### F10: Commitment Tracker + Autonomous Follow-ups
**Track who owes what to whom, across email and meetings.**

Data model:
```
{
  owner: "Data Team — Alex",
  commitment: "Deliver API spec for v2 integration",
  due_date: "2026-02-10",
  source: "email thread — API Integration Planning",
  source_link: "outlook://message/AAMkAG...",
  confidence: 0.9,
  status: "overdue",  // open → due_soon → overdue → nudged → closed
  days_overdue: 2
}
```

Extraction sources:
- Email threads: "I'll have this to you by Friday" → commitment
- Your sent emails: "Can you send me X by Wednesday?" → expected delivery
- Meeting notes (if you voice-note action items post-meeting)

Nudge policy:
- T+1 business day overdue: soft reminder draft ("Hi Alex, just checking in on the API spec — are we still on track?")
- T+3: firmer with explicit date ("Following up — the API spec was due Monday. Can you share an updated ETA?")
- All nudges require your approval before sending (one-click approve/edit/skip)
- Auto-close when completion evidence appears in reply ("Here's the spec")

### F11: Time Protection Engine
**Defend your focus time.**

Detection rules:
- >5 meeting hours in a day → alert: "Heavy meeting day — no focus blocks"
- >3 back-to-back meetings → alert: "No buffer between meetings"
- No 90-min uninterrupted block → suggest creating one
- Meeting during lunch (12-1pm) → flag

Actions:
- Auto-hold recurring deep-work blocks (e.g., 9-10:30 AM daily)
- Invite triage:
  - **Accept**: you're a decision maker, your manager invited you, critical project
  - **Suggest delegate**: FYI meeting, your report owns the domain
  - **Suggest decline**: no agenda, >10 attendees and you're optional, conflicts with focus block
- Decline with polite template: "Thanks for including me — I'll review notes async. Please loop me in if there's a specific question for me."
- **Never auto-decline**: manager meetings, skip-level, anything flagged critical

### F12: Smart Delegation Assistant
**Detect work that shouldn't be yours and draft the handoff.**

Maintain a lightweight ownership map:
```
{
  "Alex (Data Team)": ["API", "data pipeline", "ETL", "schema"],
  "Jordan (Design)": ["UX", "mockups", "design review", "figma"],
  "Sam (Eng Lead)": ["architecture", "code review", "deployment", "infra"]
}
```

Detection:
- You're CC'd (not in To:) on a thread about a domain owned by a report
- Someone asks you something that maps to a delegate's domain
- Thread is operational (not strategic) and below your level

Draft handoff:
```
"Forwarding to Alex who owns our data pipeline work.

Alex — can you review the schema change request below and respond
by Thursday? Let me know if you need me to weigh in on the
prioritization question.

[Original thread below]"
```

Auto-create follow-up tracker entry tied to delegate + deadline.

### F13: Post-Meeting Autopilot
After a meeting ends:
- Prompt: "Any action items from this meeting?" (dashboard notification or voice note)
- You speak or type the action items
- System creates tracked commitments, assigns owners
- Drafts follow-up email: "Thanks all — here are the action items from today's discussion..."
- One-click send

### F14: Weekly Executive Digest
Generated Sunday evening or Monday morning:

```
WEEKLY DIGEST — Week of Feb 10

WINS:
• Q1 budget approved (VP Review, Thursday)
• API v2 spec delivered (2 days late but done)

RISKS:
• Marketing launch timeline still unconfirmed (3 days overdue)
• Two meetings declined by VP — possible priority shift

PENDING YOUR ACTION:
• 3 emails need replies (1 urgent)
• 2 commitments due this week

NEXT WEEK PREP:
• Monday: All-hands (no prep needed)
• Wednesday: QBR dry run (prep brief will generate Tuesday)
• Friday: 1:1 with skip-level (last met 3 weeks ago — relationship note)

STATS:
• Emails processed: 247 | Replies sent: 34
• Meetings attended: 22 | Focus hours: 12
• Commitments closed: 8 | Created: 5
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard (Next.js)                │
│         http://localhost:3000                        │
└───────────────────────┬─────────────────────────────┘
                        │ REST + SSE
                        ▼
┌─────────────────────────────────────────────────────┐
│                  Backend (Express)                    │
│               http://localhost:3456                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Graph    │  │ Classify │  │ Draft Generator   │  │
│  │ Sync     │  │ Engine   │  │ (LLM)             │  │
│  │ Worker   │  │ (Rules + │  │                   │  │
│  │          │  │  LLM)    │  │ • Thread state    │  │
│  │ • Delta  │  │          │  │ • Tone matching   │  │
│  │   query  │  │ • Rule   │  │ • 2 variants      │  │
│  │ • Token  │  │   pass   │  │ • Reply detection │  │
│  │   refresh│  │ • LLM    │  │                   │  │
│  │ • Thread │  │   pass   │  │                   │  │
│  │   fetch  │  │ • Score  │  │                   │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              SQLite Database                  │    │
│  │  • messages    • threads    • classifications │    │
│  │  • drafts      • action_items  • sync_state  │    │
│  │  • style_examples  • sender_rules            │    │
│  └──────────────────────────────────────────────┘    │
└───────────────────────┬─────────────────────────────┘
                        │ Microsoft Graph API
                        ▼
┌─────────────────────────────────────────────────────┐
│              Microsoft 365 / Outlook                 │
│         (OAuth 2.0 + PKCE, delegated auth)          │
└─────────────────────────────────────────────────────┘
```

### Integration Options (choose based on IT policy)

**Option A: Microsoft Graph API (preferred)**
- Register app in Azure AD / Entra ID
- OAuth 2.0 Authorization Code + PKCE flow
- Scopes: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `Calendars.ReadWrite`, `User.Read`, `offline_access`
- Token stored in OS keychain (macOS Keychain via `keytar`)
- Delta queries for incremental sync: `GET /me/mailFolders/inbox/messages/delta`
- Thread retrieval: `GET /me/messages?$filter=conversationId eq '{id}'&$orderby=receivedDateTime`

**Option B: Power Automate (zero IT friction fallback)**
- Create Flow: "When new email arrives → HTTP POST to localhost webhook"
- Payload: sender, subject, body (HTML), conversationId, receivedDateTime
- No app registration needed
- Limitation: can't create drafts in Outlook, can't read full threads retroactively
- Good for MVP classification + alerting, weaker for full thread analysis

**Option C: Outlook Add-in (future enhancement)**
- Sideloadable without IT approval
- Runs inside Outlook as a sidebar panel
- Direct access to current email via Office.js
- Good complement to the dashboard — quick actions from within Outlook

### Data Model

```sql
-- Core tables
CREATE TABLE messages (
  id TEXT PRIMARY KEY,           -- Graph message ID
  conversation_id TEXT NOT NULL,
  subject TEXT,
  sender_email TEXT,
  sender_name TEXT,
  to_recipients TEXT,            -- JSON array
  cc_recipients TEXT,            -- JSON array
  body_preview TEXT,
  body_html TEXT,
  body_text TEXT,
  received_at DATETIME,
  is_read BOOLEAN,
  has_attachments BOOLEAN,
  importance TEXT,               -- Graph importance field
  in_reply_to TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE threads (
  conversation_id TEXT PRIMARY KEY,
  subject TEXT,
  message_count INTEGER,
  participants TEXT,             -- JSON array
  latest_message_at DATETIME,
  thread_state TEXT,             -- JSON: summary, open questions, commitments, deadlines
  updated_at DATETIME
);

CREATE TABLE classifications (
  conversation_id TEXT PRIMARY KEY,
  priority TEXT,                 -- P0/P1/P2/P3
  label TEXT,                    -- "Urgent — Reply Today"
  rule_signals TEXT,             -- JSON: which rules fired
  llm_rationale TEXT,            -- LLM's reasoning
  confidence REAL,               -- 0.0-1.0
  needs_reply BOOLEAN,
  classified_at DATETIME,
  overridden_by_user BOOLEAN DEFAULT FALSE,
  user_priority TEXT             -- if user overrides
);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  variant TEXT,                  -- 'concise' or 'full'
  body_text TEXT,
  reply_type TEXT,               -- 'reply' or 'reply-all'
  status TEXT,                   -- 'draft', 'approved', 'sent', 'discarded'
  created_at DATETIME,
  sent_at DATETIME
);

CREATE TABLE action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  description TEXT,
  assigned_to TEXT,              -- 'you' or someone else
  deadline TEXT,
  status TEXT,                   -- 'pending', 'done', 'overdue'
  extracted_at DATETIME
);

CREATE TABLE sender_rules (
  email_pattern TEXT PRIMARY KEY, -- exact email or domain glob
  priority_boost INTEGER,         -- -2 to +2
  label TEXT                      -- "manager", "vp", "mailing-list"
);

CREATE TABLE style_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  context TEXT,                  -- "reply to status ask", "acknowledge receipt"
  your_email TEXT,               -- actual email you wrote
  added_at DATETIME
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,           -- Graph event ID
  subject TEXT,
  start_time DATETIME,
  end_time DATETIME,
  location TEXT,
  organizer_email TEXT,
  organizer_name TEXT,
  attendees TEXT,                -- JSON array [{email, name, response}]
  body_text TEXT,                -- Agenda / description
  is_recurring BOOLEAN,
  importance TEXT,
  prep_brief TEXT,               -- Generated meeting prep (markdown)
  prep_generated_at DATETIME,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT,                    -- "you" or name/email
  description TEXT,
  due_date TEXT,
  source_type TEXT,              -- 'email' or 'meeting' or 'manual'
  source_id TEXT,                -- conversation_id or event_id
  confidence REAL,
  status TEXT,                   -- 'open', 'due_soon', 'overdue', 'nudged', 'closed'
  nudge_count INTEGER DEFAULT 0,
  last_nudged_at DATETIME,
  closed_at DATETIME,
  created_at DATETIME
);

CREATE TABLE delegation_map (
  person_email TEXT,
  person_name TEXT,
  domains TEXT,                  -- JSON array of domain keywords
  updated_at DATETIME
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME
);
-- Stores: delta_link, last_sync_at, token_expiry, calendar_delta_link, etc.
```

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Backend | Node.js / Express | Same stack as leadership-autopilot, proven pattern |
| Frontend | Next.js + Tailwind | Fast to build, good SSE support for streaming |
| Database | SQLite (via `better-sqlite3`) | No server, queryable, fast, single file backup |
| LLM | Claude via Bedrock | Already configured, best draft quality |
| Auth | MSAL.js (`@azure/msal-node`) | Official Microsoft library for Graph OAuth |
| Token storage | OS Keychain (`keytar`) | Secure, no plaintext tokens |
| Email parsing | `mailparser` or custom | Handle HTML→text, forwarded chains, signatures |
| Scheduling | `node-cron` or `setInterval` | Delta polling every 2-5 min |

---

## Classification Rules (Deterministic Layer)

```javascript
function ruleBasedClassify(message, thread, senderRules) {
  let score = 0;  // Higher = more urgent
  const signals = [];

  // === Sender signals ===
  const senderRule = senderRules.find(r => matchSender(message.sender_email, r));
  if (senderRule) {
    score += senderRule.priority_boost * 10;
    signals.push(`sender:${senderRule.label}`);
  }

  // === Recipient signals ===
  const inTo = message.to_recipients.includes(YOUR_EMAIL);
  const inCc = message.cc_recipients.includes(YOUR_EMAIL);
  if (inTo) { score += 20; signals.push('direct:to'); }
  if (inCc) { score -= 10; signals.push('cc-only'); }

  // === Content signals ===
  const body = message.body_text.toLowerCase();
  if (/\b(eod|end of day|by today|asap|urgent|blocker)\b/.test(body)) {
    score += 30; signals.push('keyword:urgent');
  }
  if (/\b(by friday|this week|by eow)\b/.test(body)) {
    score += 15; signals.push('keyword:this-week');
  }
  if (/\b(fyi|no action|for your info|just sharing)\b/.test(body)) {
    score -= 20; signals.push('keyword:fyi');
  }
  if (/\b(please review|can you|could you|would you|need your)\b/.test(body)) {
    score += 20; signals.push('keyword:ask');
  }

  // === Thread signals ===
  const lastInThread = thread.messages[thread.messages.length - 1];
  const youWereAsked = lastInThread.sender_email !== YOUR_EMAIL
    && lastInThread.to_recipients.includes(YOUR_EMAIL);
  if (youWereAsked) { score += 25; signals.push('thread:awaiting-your-reply'); }

  // === Age signals ===
  const hoursOld = (Date.now() - new Date(message.received_at)) / 3600000;
  if (youWereAsked && hoursOld > 24) { score += 15; signals.push('age:stale-24h'); }
  if (youWereAsked && hoursOld > 48) { score += 15; signals.push('age:stale-48h'); }

  // === Distribution signals ===
  const recipientCount = message.to_recipients.length + message.cc_recipients.length;
  if (recipientCount > 20) { score -= 30; signals.push('distribution:mass'); }

  // === Map score to priority ===
  let priority;
  if (score >= 40) priority = 'P0';
  else if (score >= 20) priority = 'P1';
  else if (score >= 0) priority = 'P2';
  else priority = 'P3';

  return { priority, score, signals, needsLLM: score >= -10 && score <= 50 };
  // needsLLM: borderline cases get LLM review
}
```

---

## LLM Prompts

### Classification Prompt (for borderline cases)

```
You are an email triage assistant. Classify this email thread by urgency.

Thread summary:
{thread_state}

Latest message:
From: {sender}
To: {recipients}
Subject: {subject}
Body: {body_preview}

Rule signals already detected: {signals}
Rule score: {score} (borderline — needs your judgment)

Classify as one of:
- P0: Urgent — needs reply today (direct ask with deadline, blocker, escalation)
- P1: Important — needs action this week (review request, decision needed)
- P2: Follow up — should read, may need response later
- P3: FYI — informational, no action needed

Response format:
Priority: P0/P1/P2/P3
Needs reply: yes/no
Rationale: [one sentence explaining why]
```

### Response Draft Prompt

```
You are drafting an email response on behalf of the user.

User's writing style: direct, professional, concise. Avoids filler.
See style examples below.

Thread state:
{thread_state_json}

Open questions directed at you:
{open_questions}

Your commitments:
{commitments}

Task: Draft TWO response variants.

Variant 1 — CONCISE (2-3 sentences max):
[Draft a brief, action-oriented response]

Variant 2 — FULL (1-2 paragraphs):
[Draft a detailed response addressing all open questions]

Rules:
- Match the user's tone from the style examples
- Address all open questions
- Reference specific commitments/deadlines if relevant
- If reply-all is appropriate (question was asked to a group), note it
- Never be sycophantic or overly formal
- If you don't have enough context, say what's missing

Style examples:
{style_examples}
```

---

## Phased Rollout

### Phase 1: Foundation (1 week)
- [ ] Microsoft Graph OAuth setup (or Power Automate fallback)
- [ ] Delta polling sync worker — inbox messages + calendar events into SQLite
- [ ] Thread grouping by conversationId
- [ ] Basic dashboard: list of recent threads, sorted by date
- [ ] Today's calendar view

### Phase 2: Email Classification + Drafting (1-2 weeks)
- [ ] Rule-based classifier (sender rules, keyword detection, recipient analysis)
- [ ] LLM classifier for borderline cases
- [ ] Dashboard: prioritized inbox with P0/P1/P2/P3 sections
- [ ] Thread state builder (summary, participants, open questions)
- [ ] Style example seeding (import 10-15 sent emails)
- [ ] Draft generator: concise + full variants
- [ ] Reply vs reply-all detection
- [ ] Draft editing UI with send/save/discard

### Phase 3: Daily Brief + Meeting Prep (1-2 weeks)
- [ ] Daily Command Brief — morning dashboard with 3 sections
- [ ] One-click actions: Draft, Nudge, Delegate, Decline, Snooze
- [ ] Meeting prep brief generator (triggered by importance criteria)
- [ ] Meeting-to-email thread linking (participants + subject overlap)
- [ ] Calendar-aware email urgency ("meeting in 2 hours, prep not done")

### Phase 4: Follow-ups + Commitments (1-2 weeks)
- [ ] Commitment extraction from email threads
- [ ] Commitment tracker: open → due soon → overdue → nudged → closed
- [ ] Nudge draft generation (soft T+1, firm T+3)
- [ ] One-click nudge approval/edit/send
- [ ] Auto-close on completion evidence in replies
- [ ] Post-meeting action item capture (dashboard prompt or voice note)

### Phase 5: Time Protection + Delegation (1 week)
- [ ] Meeting load detection (overload alerts, no-buffer warnings)
- [ ] Focus block auto-hold on calendar
- [ ] Invite triage suggestions (accept/delegate/decline)
- [ ] Decline template library
- [ ] Ownership map for delegation
- [ ] Delegation draft generation with follow-up tracking

### Phase 6: Intelligence Layer (1 week)
- [ ] Decision register across email + meetings
- [ ] Weekly executive digest
- [ ] Stats dashboard (emails processed, drafts used, focus hours, response time)
- [ ] Sender rules learning from user overrides
- [ ] Stakeholder memory (relationship context, last touch, open loops)

### Key Product Strategy
**Start with high-quality drafts + one-click execution.** Don't start with full autonomy. Build trust through accurate classification and good drafts, then selectively automate high-confidence actions (nudges, declines, delegations). This is the fastest path to adoption and real time savings.

---

## Runtime Constraints

- **100% local execution** — no cloud hosting, no EC2, no external servers. Everything runs on your local machine (Mac Mini or laptop).
- **Cron-based automation** — polling jobs (email sync, calendar sync, commitment checks) run every 15-30 minutes via cron or `node-cron`.
- **Only external API: AWS Bedrock** — Claude Opus 4.6 via Bedrock is the sole external service.
- **Dashboard access: localhost only** — `http://localhost:3000` (dashboard) and `http://localhost:3456` (API). No public endpoints.
- **Why:** Privacy and security are non-negotiable. No corporate email data touches third-party infrastructure.

## Memory System

Three tiers of memory, each serving a different purpose:

### Tier 1: Working Memory (ephemeral, resets daily)
**What:** Current session state — today's triage decisions, drafts in progress, meetings prepped.

```json
{
  "date": "2026-02-12",
  "triaged": ["conv_123", "conv_456"],
  "drafts_approved": 3,
  "drafts_pending": 2,
  "meetings_prepped": ["event_789"],
  "focus_blocks_held": ["9:00-10:30"],
  "nudges_sent": ["commitment_42"]
}
```

- Stored in SQLite `working_memory` table, partitioned by date
- Prevents re-processing: "I already classified this thread today"
- Feeds the Daily Brief: "You've handled 12 of 18 items so far"
- Cleared/archived after 7 days

### Tier 2: Relationship Memory (persistent, grows over time)
**What:** Context about people you interact with — communication patterns, reliability, preferences, reporting structure.

```json
{
  "email": "sarah.chen@company.com",
  "name": "Sarah Chen",
  "role": "VP Finance",
  "relationship": "skip-level stakeholder",
  "patterns": {
    "communication_style": "direct, data-driven, prefers tables over prose",
    "response_time": "usually replies within 2 hours",
    "reliability": "high — delivers on commitments",
    "pet_peeves": "hates vague timelines, wants specific dates",
    "meeting_behavior": "always starts on time, ends early if agenda is done"
  },
  "notes": [
    "Pushed back hard on headcount in Q1 planning (Feb 2026)",
    "Prefers 1-pagers over slide decks",
    "Ally on the data platform investment — reference her support"
  ],
  "last_interaction": "2026-02-12T14:00:00",
  "interaction_frequency": "2-3 times/week",
  "open_loops": ["Awaiting Q1 budget final sign-off"]
}
```

- Stored in SQLite `relationship_memory` table
- Updated automatically: response times, interaction frequency, commitment delivery rate
- Updated manually: notes, preferences, relationship context (you tell the system or it infers from patterns)
- Feeds: meeting prep briefs, draft tone adjustment, delegation suggestions
- **Example use:** Before your 1:1 with Sarah, the prep brief says: "Sarah prefers specific dates — have exact timelines ready. She's an ally on data platform — reference if relevant."

### Tier 3: Institutional Memory (persistent, queryable archive)
**What:** Decisions made, commitments history, project milestones, organizational context.

```json
{
  "type": "decision",
  "date": "2026-02-12",
  "summary": "Q1 budget approved at $1.8M with phased hiring",
  "participants": ["Sarah Chen", "Mike Torres", "You"],
  "source": "VP Review meeting + email thread",
  "source_ids": ["event_789", "conv_456"],
  "project": "Q1 Planning",
  "implications": ["2 hires deferred to Q2", "Contractor budget excluded"],
  "follow_ups": ["Share updated project timeline by Feb 14"]
}
```

- Stored in SQLite `institutional_memory` table
- Types: decisions, milestones, commitments (completed), escalations, project context
- Queryable by: date range, project, person, type
- Feeds: meeting prep (recent decisions), weekly digest (wins/risks), commitment tracking (historical patterns)
- **Example use:** Before QBR, system pulls: "Here are all decisions made this quarter, organized by project. 3 are at risk of reversal based on recent email sentiment."

### Memory Integration with LLM

When building context for any LLM call (classification, drafting, meeting prep), the memory system injects relevant context:

```
# Memory Context (auto-injected)

## Relevant Relationship Context
- Sarah Chen: VP Finance, direct/data-driven, hates vague timelines
- Mike Torres: PM Lead, reliable, usually over-communicates (good)

## Recent Decisions (last 14 days)
- Q1 budget: $1.8M approved, phased hiring
- API v2: spec delivered, implementation starting next sprint

## Open Commitments Involving Thread Participants
- [YOU → Sarah] Share revised project timeline (due Feb 14)
- [Mike → YOU] Updated sprint plan (due Feb 13)
```

This gives the LLM the same context a human executive assistant would have after working with you for months.

## Security Considerations

- **All data stays local** — SQLite database on local disk, no cloud sync
- OAuth tokens stored in macOS Keychain, never in plaintext
- Email bodies stored locally — never sent to third parties
- LLM calls go through AWS Bedrock only (enterprise-grade data handling)
- No telemetry, no analytics, no external data transmission except Bedrock API
- Session tokens auto-refresh; revocable from Azure AD portal
- Optional: SQLCipher encryption at rest for the SQLite database

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Morning triage time | <10 min (from ~30-45 min) |
| Draft acceptance rate | >60% sent with minor edits |
| Classification accuracy | >90% matches user's mental model |
| Sync latency | <5 min from email arrival to dashboard |
| Missed urgent emails | 0 (P0 classification recall = 100%) |

---

## Open Questions

1. **IT policy check:** Can you register apps in Azure AD? Determines Graph API vs Power Automate path.
2. **Shared mailbox:** Do you need to monitor shared/team mailboxes or just your personal inbox?
3. **Calendar integration:** Worth adding meeting-related email context? ("This thread is about tomorrow's 2pm review")
4. **Mobile access:** Need to access the dashboard from phone? (Tailscale + responsive design would work)
5. **Multi-account:** Just work Outlook, or also personal email?

---

*Repo: TBD — will live at `/Users/jilani/clawd/email-wiz`*
*Architecture: Express + Next.js + SQLite + Bedrock Claude*
*Pattern: Same as leadership-autopilot — deterministic data layer, LLM reads pre-computed context*
