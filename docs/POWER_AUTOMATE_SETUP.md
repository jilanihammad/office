# Power Automate + OneDrive Setup Guide

100% local. Nothing exposed to the internet.

**How it works:**
1. Power Automate flow triggers on new email/calendar event
2. Flow writes a JSON file to your OneDrive folder
3. OneDrive desktop app syncs that folder to your Mac
4. Server watches the local folder, ingests the JSON, classifies, done

## Prerequisites

- Microsoft 365 account with Power Automate access
- **OneDrive for Mac** installed and syncing ([download](https://www.microsoft.com/en-us/microsoft-365/onedrive/download))
- Office server running locally (`npm run dev`)

## Step 1: Install OneDrive for Mac

If you don't already have it:
1. Download from https://www.microsoft.com/en-us/microsoft-365/onedrive/download
2. Sign in with your corporate account
3. Let it finish the initial sync
4. Note your OneDrive local path — usually `~/Library/CloudStorage/OneDrive-YourCompany/`

## Step 2: Create the Drop Folder

In your OneDrive, create a folder called `Office-Drop` with two subfolders:

```
OneDrive-YourCompany/
  Office-Drop/
    inbox/        ← Power Automate writes email JSON here
    calendar/     ← Power Automate writes calendar JSON here
```

You can create these in Finder or via terminal:
```bash
mkdir -p ~/Library/CloudStorage/OneDrive-YourCompany/Office-Drop/inbox
mkdir -p ~/Library/CloudStorage/OneDrive-YourCompany/Office-Drop/calendar
```

## Step 3: Configure the Server

Edit `server/.env`:
```
DROP_FOLDER=~/Library/CloudStorage/OneDrive-YourCompany/Office-Drop
DROP_POLL_SECONDS=10
```

Replace `YourCompany` with whatever your OneDrive folder is actually named.

## Step 4: Create the Email Flow

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

## Step 5: Create the Calendar Flow

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

## Step 6: Backfill Recent Emails

To import your existing inbox (not just new emails):

1. **+ Create** → **Instant cloud flow** (manual trigger)
2. Add: **"Get emails (V3)"** action
   - Folder: `Inbox`
   - Top: `200`
   - Fetch Only Unread: `No`
3. Add: **Apply to each** on the output
4. Inside the loop: **Create file** (OneDrive for Business)
   - Folder: `/Office-Drop/inbox`
   - File Name: `@{items('Apply_to_each')?['id']}.json`
   - File Content: same JSON template as Step 4
5. **Run once** manually

## Step 7: Verify

Start the server:
```bash
cd /Users/jilani/clawd/office
npm run dev
```

You should see:
```
[watcher] Watching /Users/.../OneDrive-.../Office-Drop
[watcher] Poll interval: 10s
```

Send yourself a test email. Within ~30 seconds:
1. Power Automate creates a JSON file in OneDrive
2. OneDrive syncs it to your Mac
3. Server picks it up, classifies it
4. It appears in the dashboard at http://localhost:3000

Check health:
```bash
curl http://localhost:3456/api/health
```

## How the Sync Chain Works

```
Outlook inbox
  → Power Automate trigger (instant)
    → OneDrive "Create file" (cloud, ~1s)
      → OneDrive desktop sync (local, ~5-30s)
        → Server file watcher (polls every 10s)
          → SQLite + classify
            → Dashboard
```

Total latency: ~15-45 seconds from email received to dashboard display.

## Troubleshooting

**Files not appearing locally**: Check OneDrive is running (menu bar icon). Click it and verify sync status. Make sure the `Office-Drop` folder shows the cloud/sync icon.

**Server not picking up files**: Check `DROP_FOLDER` in `.env` matches the actual local path. Run `ls ~/Library/CloudStorage/` to see exact OneDrive folder name.

**Classification always P2**: Make sure AWS credentials are set in `.env` for Bedrock LLM. Without them, only rule-based classification runs (still useful, but less nuanced).

**Duplicate processing**: Files are moved to `processed/` after ingestion. If you see duplicates, check that the server has write permissions to the drop folder.

**OneDrive not syncing a folder**: Right-click the folder in Finder → "Always Keep on This Device" to force local sync.
