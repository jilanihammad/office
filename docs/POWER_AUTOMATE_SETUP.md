# Power Automate Setup Guide

This guide sets up Power Automate cloud flows to push your Outlook email and calendar data to the Office server — no Azure AD app registration needed.

## Prerequisites

- Microsoft 365 account with Power Automate access (most corporate accounts have this)
- Office server running locally (`npm run dev` in the office directory)
- A tunnel to expose localhost (see Step 1)

## Step 1: Set Up a Tunnel

The server runs on localhost:3456. Power Automate needs a public URL to reach it.

**Option A: Cloudflare Tunnel (recommended, free)**
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3456
```
This gives you a URL like `https://random-words.trycloudflare.com`

**Option B: ngrok**
```bash
brew install ngrok
ngrok http 3456
```
This gives you a URL like `https://abc123.ngrok-free.app`

Copy your tunnel URL — you'll need it for the flows.

## Step 2: Create the Email Flow

1. Go to https://make.powerautomate.com
2. Click **+ Create** → **Automated cloud flow**
3. Name it: `Office — Email Sync`
4. Trigger: search for **"When a new email arrives (V3)"** (Office 365 Outlook)
5. Click **Create**

### Configure the Trigger
- Folder: `Inbox` (or leave default for all folders)
- Include Attachments: `No` (we don't need them yet)
- Only with Attachments: `No`

### Add HTTP Action
6. Click **+ New step** → search **HTTP**
7. Configure:
   - **Method**: `POST`
   - **URI**: `https://<your-tunnel-url>/api/webhook/email`
   - **Headers**:
     - `Content-Type`: `application/json`
     - `X-Webhook-Secret`: `e3aa40eaa6bf29a1f2023560bb46b43c29edfc2d5e3730cf`
   - **Body** (switch to raw JSON input):
```json
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

8. Click **Save**

### Test It
9. Send yourself a test email
10. Check the flow run history — it should show a successful HTTP 200
11. Check `http://localhost:3000` — the email should appear in the inbox

## Step 3: Create the Calendar Flow

1. **+ Create** → **Automated cloud flow**
2. Name: `Office — Calendar Sync`
3. Trigger: **"When an event is created (V3)"** or **"When an event is added, updated or deleted (V3)"**
4. Add HTTP action:
   - **Method**: `POST`
   - **URI**: `https://<your-tunnel-url>/api/webhook/calendar`
   - **Headers**: same as email flow
   - **Body**:
```json
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

## Step 4: Backfill Existing Emails (Optional)

To import your recent emails (not just new ones going forward):

1. Create a new flow: **Instant cloud flow** (manual trigger)
2. Add: **"Get emails (V3)"** action
   - Folder: `Inbox`
   - Top: `100` (or however many you want)
   - Fetch Only Unread: `No`
3. Add: **Apply to each** on the email results
4. Inside the loop, add HTTP POST to `/api/webhook/email` with the same body template
5. Run it once manually

Or use the bulk endpoint — create a script that exports emails to JSON and POST to `/api/webhook/bulk`.

## Step 5: Verify

```bash
# Check health — should show message/thread/event counts
curl http://localhost:3456/api/health

# Check the brief
curl http://localhost:3456/api/brief
```

Open `http://localhost:3000` to see the dashboard.

## Keeping the Tunnel Running

The tunnel needs to stay active for Power Automate to reach your server.

**For development**: just run it when you're working.

**For always-on**: 
```bash
# Cloudflare named tunnel (persists across restarts)
cloudflared tunnel create office
cloudflared tunnel route dns office office.yourdomain.com
cloudflared tunnel run office
```

Or add it to your startup items.

## Troubleshooting

**Flow fails with 401**: Check that `X-Webhook-Secret` header matches `WEBHOOK_SECRET` in `.env`

**Flow fails with connection error**: Tunnel isn't running or URL changed. Cloudflare quick tunnels change URL on restart — use a named tunnel for stability.

**Emails not appearing**: Check flow run history in Power Automate. Look for the HTTP action result — it should show `{"ok":true,"processed":1}`.

**Classification not working**: Make sure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set in `.env` for Bedrock LLM calls. Rule-based classification works without LLM; only borderline cases need it.
