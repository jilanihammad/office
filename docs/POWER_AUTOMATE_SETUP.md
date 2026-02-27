# Power Automate + OneDrive Setup Guide

100% local. Nothing exposed to the internet.

**How it works:**
1. Power Automate flow triggers on new email/calendar event
2. Flow writes a JSON file to your OneDrive folder
3. OneDrive syncs it to your machine (already running on Windows)
4. Server (WSL) reads the local folder, ingests the JSON, classifies, done

## Prerequisites

- Microsoft 365 account with Power Automate access
- OneDrive syncing on Windows (usually pre-installed)
- WSL with Node.js installed
- AWS credentials for Bedrock (LLM classification)

## Step 1: Clone and Install

```bash
# In WSL
cd ~
git clone https://github.com/jilanihammad/office.git
cd office
npm install
cd server && npm install && cd ..
cd dashboard && npm install && cd ..
```

## Step 2: Find Your OneDrive Path

From WSL, find where OneDrive syncs on the Windows side:

```bash
ls /mnt/c/Users/
# Find your Windows username, then:
ls "/mnt/c/Users/<your-windows-user>/"
# Look for "OneDrive - <Company>" or just "OneDrive"
```

Common paths:
- `/mnt/c/Users/<your-user>/OneDrive - YourOrg/`
- `/mnt/c/Users/<your-user>/OneDrive/`

## Step 3: Create Drop Folders

```bash
# Replace with your actual OneDrive path
ONEDRIVE="/mnt/c/Users/<your-windows-user>/OneDrive"
mkdir -p "$ONEDRIVE/Office-Drop/"{inbox,calendar,outbox,sent-mail,processed}
```

Folder purposes:
- `inbox/` — Power Automate writes incoming emails here
- `calendar/` — Power Automate writes calendar events here
- `outbox/` — Server writes send requests → PA picks up and sends via Outlook
- `sent-mail/` — Power Automate writes your sent emails (style learning)
- `processed/` — Server archives ingested files here

Verify the folders appear in OneDrive (check Windows File Explorer or https://onedrive.com).

## Step 4: Configure the Server

```bash
cd ~/office/server
cp .env.example .env
```

Edit `.env`:
```bash
# OneDrive drop folder (use the WSL path)
DROP_FOLDER=/mnt/c/Users/<your-windows-user>/OneDrive/Office-Drop

# How often to check for new files (seconds)
DROP_POLL_SECONDS=10

# AWS Bedrock (for LLM classification)
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-2
LLM_MODEL=us.anthropic.claude-opus-4-6-v1

# Your work email (for classification — detecting "To: you" vs CC)
USER_EMAIL=your.name@company.com

# Azure AD — leave blank (using Power Automate instead)
AZURE_CLIENT_ID=
AZURE_TENANT_ID=
```

## Step 5: Create the Email Flow

1. Go to https://make.powerautomate.com
2. **+ Create** → **Automated cloud flow**
3. Name: `Office — Email to OneDrive`
4. Trigger: **"When a new email arrives (V3)"** (Office 365 Outlook)

### Configure Trigger
- Folder: `Inbox`
- Include Attachments: `No`

### Add "Create file" Action
5. **+ New step** → search **"Create file"** → select **OneDrive for Business**
6. Configure:
   - **Folder Path**: `/Office-Drop/inbox`
   - **File Name**: `@{triggerOutputs()?['body/id']}.json`
   - **File Content**:
```
{
  "id": "@{triggerOutputs()?['body/id']}",
  "conversationId": "@{triggerOutputs()?['body/conversationId']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "from": "@{triggerOutputs()?['body/from']}",
  "fromName": "@{triggerOutputs()?['body/from']}",
  "to": "@{triggerOutputs()?['body/toRecipients']}",
  "cc": "@{triggerOutputs()?['body/ccRecipients']}",
  "bodyPreview": "@{triggerOutputs()?['body/bodyPreview']}",
  "body": "@{triggerOutputs()?['body/body']}",
  "receivedDateTime": "@{triggerOutputs()?['body/receivedDateTime']}",
  "isRead": @{triggerOutputs()?['body/isRead']},
  "hasAttachments": @{triggerOutputs()?['body/hasAttachments']},
  "importance": "@{triggerOutputs()?['body/importance']}"
}
```

7. **Save**

## Step 6: Create the Calendar Flow

1. **+ Create** → **Automated cloud flow**
2. Name: `Office — Calendar to OneDrive`
3. Trigger: **"When an event is created (V3)"** or **"When an event is added, updated or deleted (V3)"**

### Add "Create file" Action
4. Configure:
   - **Folder Path**: `/Office-Drop/calendar`
   - **File Name**: `@{triggerOutputs()?['body/id']}.json`
   - **File Content**:
```
{
  "id": "@{triggerOutputs()?['body/id']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "start": "@{triggerOutputs()?['body/start']}",
  "end": "@{triggerOutputs()?['body/end']}",
  "location": "@{triggerOutputs()?['body/location']}",
  "organizer": "@{triggerOutputs()?['body/organizer']}",
  "organizerName": "@{triggerOutputs()?['body/organizer']}",
  "attendees": "@{triggerOutputs()?['body/requiredAttendees']}",
  "body": "@{triggerOutputs()?['body/body']}",
  "isRecurring": @{triggerOutputs()?['body/isRecurrence']},
  "importance": "@{triggerOutputs()?['body/importance']}"
}
```

5. **Save**

## Step 7: Backfill Recent Emails (Optional)

To import your existing inbox (not just new emails going forward):

1. **+ Create** → **Instant cloud flow** (manual trigger)
2. Add: **"Get emails (V3)"** action
   - Folder: `Inbox`
   - Top: `200` (adjust as needed)
   - Fetch Only Unread: `No`
3. Add: **Apply to each** on the output
4. Inside the loop: **Create file** (OneDrive for Business)
   - Folder: `/Office-Drop/inbox`
   - File Name: `@{items('Apply_to_each')?['id']}.json`
   - File Content: same JSON template as Step 5
5. **Run once** manually

## Step 8: Start and Verify

```bash
cd ~/office
npm run dev
```

You should see:
```
[db] SQLite initialized
[watcher] Watching /mnt/c/Users/.../OneDrive - .../Office-Drop
[watcher] Poll interval: 10s
[server] Office running at http://localhost:3456
```

Open your Windows browser to **http://localhost:3000** — WSL localhost is accessible from Windows.

Send yourself a test email. Within ~30 seconds:
1. Power Automate creates a JSON file in OneDrive (cloud)
2. OneDrive syncs it to your Windows machine (~5-15s)
3. WSL server reads it from `/mnt/c/...` (~10s poll)
4. Email appears classified in the dashboard

Quick health check:
```bash
curl http://localhost:3456/api/health
```

## Step 9: Send Flow (outbox → Outlook)

This closes the loop — draft a reply in the dashboard, click Send, it goes out via Outlook.

1. **+ Create** → **Automated cloud flow**
2. Name: `Office — Send from Outbox`
3. Trigger: **"When a file is created"** (OneDrive for Business)
   - Folder: `/Office-Drop/outbox`
4. Add: **"Get file content"** → select the trigger file
5. Add: **"Parse JSON"** on the file content with this schema:
```json
{
  "type": "object",
  "properties": {
    "to": {"type": "string"},
    "cc": {"type": "string"},
    "subject": {"type": "string"},
    "body": {"type": "string"},
    "internetMessageId": {"type": "string"}
  }
}
```
6. Add: **"Send an email (V2)"** (Office 365 Outlook)
   - To: `@{body('Parse_JSON')?['to']}`
   - CC: `@{body('Parse_JSON')?['cc']}`
   - Subject: `@{body('Parse_JSON')?['subject']}`
   - Body: `@{body('Parse_JSON')?['body']}`
7. Add: **"Move file"** — move the JSON from `/Office-Drop/outbox/` to `/Office-Drop/sent/`
8. **Save**

Now when you click "Send Reply" in the dashboard, it writes a JSON to the outbox, and this flow picks it up and sends via Outlook.

## Step 10: Sent Mail Flow (learn your style)

This teaches the system how you write, so drafts match your tone.

1. **+ Create** → **Automated cloud flow**
2. Name: `Office — Learn Sent Mail`
3. Trigger: **"When a new email is sent (V3)"** (Office 365 Outlook)
4. Add: **"Create file"** (OneDrive for Business)
   - Folder: `/Office-Drop/sent-mail`
   - File Name: `@{triggerOutputs()?['body/id']}.json`
   - File Content:
```
{
  "id": "@{triggerOutputs()?['body/id']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "to": "@{triggerOutputs()?['body/toRecipients']}",
  "body": "@{triggerOutputs()?['body/body']}",
  "sentDateTime": "@{triggerOutputs()?['body/sentDateTime']}"
}
```
5. **Save**

The server processes these every 5 minutes and builds your writing style profile.

## Sync Chain

```
Outlook inbox
  → Power Automate trigger (instant)
    → OneDrive "Create file" (cloud, ~1-2s)
      → OneDrive Windows sync (~5-15s)
        → WSL file watcher (polls every 10s)
          → SQLite + classify
            → Dashboard at localhost:3000
```

Total latency: **~20-45 seconds** from email received to classified in dashboard.

## Troubleshooting

**Files not appearing in WSL**: Check the path. Run `ls "/mnt/c/Users/<you>/OneDrive/Office-Drop/inbox/"` — you should see `.json` files after Power Automate runs.

**"Permission denied" reading OneDrive files**: WSL2 can sometimes have permission issues with `/mnt/c/`. Fix: add to `/etc/wsl.conf`:
```ini
[automount]
options = "metadata,umask=22,fmask=11"
```
Then restart WSL: `wsl --shutdown` from PowerShell.

**Dashboard not loading in Windows browser**: Make sure you're using `http://localhost:3000` (not 127.0.0.1). If it doesn't work, check WSL networking: `ip addr show eth0` in WSL and try that IP.

**Power Automate flow failing**: Check run history at make.powerautomate.com. Common issue: the OneDrive "Create file" action needs the `/Office-Drop/inbox` folder to already exist in OneDrive.

**Classification always P2/P3**: Set `USER_EMAIL` in `.env` to your work email. Without it, the classifier can't detect "direct To: you" signals, which is a major priority boost.

**LLM classification not running**: Check AWS credentials. Rule-based classification works without Bedrock (keywords, sender rules, thread state) — LLM only kicks in for borderline cases.
