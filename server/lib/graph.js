/**
 * Microsoft Graph API integration — modular provider.
 * 
 * This is the ONLY module that talks to Microsoft Graph.
 * If Azure AD isn't available, replace this with power-automate.js
 * that exposes the same interface.
 * 
 * Interface contract:
 *   - authenticate() → returns access token
 *   - fetchNewMessages(deltaLink?) → { messages[], deltaLink }
 *   - fetchThread(conversationId) → message[]
 *   - fetchCalendarEvents(startDate, endDate) → event[]
 *   - createDraft(conversationId, body, replyAll) → draftId
 *   - sendDraft(draftId) → void
 */
import { ConfidentialClientApplication, PublicClientApplication } from '@azure/msal-node';
import { getDb } from './db.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const SCOPES = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'User.Read',
  'offline_access',
];

let msalApp = null;
let cachedToken = null;

/**
 * Initialize MSAL public client (Auth Code + PKCE for delegated user auth).
 */
function getMsalApp() {
  if (msalApp) return msalApp;
  
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenantId = process.env.AZURE_TENANT_ID;
  
  if (!clientId || !tenantId) {
    throw new Error('AZURE_CLIENT_ID and AZURE_TENANT_ID required. Set them in .env');
  }
  
  msalApp = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    cache: {
      // MSAL handles token caching in memory; we persist refresh token in sync_state
    },
  });
  
  return msalApp;
}

/**
 * Get access token. Uses cached token or refresh token if available.
 * On first run, initiates device code flow (user authenticates in browser).
 */
export async function authenticate() {
  const app = getMsalApp();
  
  // Try silent acquisition first (cached token)
  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await app.acquireTokenSilent({
        account: accounts[0],
        scopes: SCOPES,
      });
      cachedToken = result.accessToken;
      return cachedToken;
    } catch (e) {
      // Silent failed — fall through to interactive
    }
  }
  
  // Device code flow — user visits URL and enters code
  const result = await app.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      console.log('\n========================================');
      console.log('AUTHENTICATION REQUIRED');
      console.log('========================================');
      console.log(response.message);
      console.log('========================================\n');
    },
  });
  
  cachedToken = result.accessToken;
  return cachedToken;
}

/**
 * Make authenticated Graph API call.
 */
async function graphFetch(url, options = {}) {
  if (!cachedToken) await authenticate();
  
  const fullUrl = url.startsWith('http') ? url : `${GRAPH_BASE}${url}`;
  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      'Authorization': `Bearer ${cachedToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (res.status === 401) {
    // Token expired — re-authenticate and retry
    await authenticate();
    return graphFetch(url, options);
  }
  
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API ${res.status}: ${body}`);
  }
  
  return res.json();
}

/**
 * Fetch new/updated messages using delta query.
 * Returns { messages, deltaLink } for incremental sync.
 */
export async function fetchNewMessages(deltaLink) {
  const url = deltaLink || '/me/mailFolders/inbox/messages/delta?$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,isRead,hasAttachments,importance,internetMessageId&$top=50&$orderby=receivedDateTime desc';
  
  const messages = [];
  let nextLink = url;
  let newDeltaLink = null;
  
  while (nextLink) {
    const data = await graphFetch(nextLink);
    
    if (data.value) {
      for (const msg of data.value) {
        messages.push(normalizeMessage(msg));
      }
    }
    
    nextLink = data['@odata.nextLink'] || null;
    if (data['@odata.deltaLink']) {
      newDeltaLink = data['@odata.deltaLink'];
    }
  }
  
  return { messages, deltaLink: newDeltaLink };
}

/**
 * Fetch all messages in a conversation thread.
 */
export async function fetchThread(conversationId) {
  const data = await graphFetch(
    `/me/messages?$filter=conversationId eq '${conversationId}'&$select=id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,isRead,importance&$orderby=receivedDateTime asc&$top=50`
  );
  
  return (data.value || []).map(normalizeMessage);
}

/**
 * Fetch calendar events in a date range.
 */
export async function fetchCalendarEvents(startDate, endDate) {
  const start = new Date(startDate).toISOString();
  const end = new Date(endDate).toISOString();
  
  const data = await graphFetch(
    `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=id,subject,start,end,location,organizer,attendees,body,isRecurring,importance&$orderby=start/dateTime&$top=100`
  );
  
  return (data.value || []).map(normalizeEvent);
}

/**
 * Create a reply draft in Outlook.
 */
export async function createDraft(messageId, body, replyAll = false) {
  const endpoint = replyAll ? 'createReplyAll' : 'createReply';
  const data = await graphFetch(`/me/messages/${messageId}/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({
      comment: body,
    }),
  });
  return data.id;
}

/**
 * Send a draft.
 */
export async function sendDraft(draftId) {
  await graphFetch(`/me/messages/${draftId}/send`, { method: 'POST' });
}

// --- Normalizers ---

function normalizeMessage(msg) {
  return {
    id: msg.id,
    conversation_id: msg.conversationId,
    subject: msg.subject || '',
    sender_email: msg.from?.emailAddress?.address || '',
    sender_name: msg.from?.emailAddress?.name || '',
    to_recipients: JSON.stringify(
      (msg.toRecipients || []).map(r => r.emailAddress?.address)
    ),
    cc_recipients: JSON.stringify(
      (msg.ccRecipients || []).map(r => r.emailAddress?.address)
    ),
    body_preview: msg.bodyPreview || '',
    body_text: msg.body?.contentType === 'text'
      ? msg.body.content
      : stripHtml(msg.body?.content || ''),
    received_at: msg.receivedDateTime,
    is_read: msg.isRead ? 1 : 0,
    has_attachments: msg.hasAttachments ? 1 : 0,
    importance: msg.importance || 'normal',
    internet_message_id: msg.internetMessageId || '',
  };
}

function normalizeEvent(evt) {
  return {
    id: evt.id,
    subject: evt.subject || '',
    start_time: evt.start?.dateTime,
    end_time: evt.end?.dateTime,
    location: evt.location?.displayName || '',
    organizer_email: evt.organizer?.emailAddress?.address || '',
    organizer_name: evt.organizer?.emailAddress?.name || '',
    attendees: JSON.stringify(
      (evt.attendees || []).map(a => ({
        email: a.emailAddress?.address,
        name: a.emailAddress?.name,
        response: a.status?.response,
      }))
    ),
    body_text: stripHtml(evt.body?.content || ''),
    is_recurring: evt.isRecurring ? 1 : 0,
    importance: evt.importance || 'normal',
  };
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
