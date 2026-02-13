const API = '/api';

// API key for authenticated requests — stored in sessionStorage only (fix #22: no localStorage)
function getApiKey(): string {
  if (typeof window !== 'undefined') {
    return (window as Record<string, string>).__API_KEY || sessionStorage.getItem('apiKey') || '';
  }
  return '';
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { 'X-Api-Key': key } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    cache: 'no-store',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Types ---

export interface Thread {
  conversation_id: string;
  subject: string;
  message_count: number;
  participants: string[];
  latest_message_at: string;
  priority: string;
  label: string;
  confidence: number;
  needs_reply: number;
  llm_rationale: string | null;
  rule_signals: string[];
  latest_message?: {
    sender_name: string;
    sender_email: string;
    body_preview: string;
    received_at: string;
  };
}

export interface Message {
  id: string;
  conversation_id: string;
  subject: string;
  sender_email: string;
  sender_name: string;
  body_preview: string;
  body_text: string;
  received_at: string;
  is_read: number;
  has_attachments: number;
  importance: string;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start_time: string;
  end_time: string;
  location: string;
  organizer_email: string;
  organizer_name: string;
  attendees: { email: string; name: string; response: string }[];
  body_text: string;
  is_recurring: number;
}

export interface Commitment {
  id: number;
  owner: string;
  description: string;
  due_date: string;
  source_type: string;
  confidence: number;
  status: string;
  nudge_count: number;
}

export interface Brief {
  date: string;
  mustDecideNow: Thread[];
  mustPrepToday: Thread[];
  overdueFollowUps: Commitment[];
  dueSoon: Commitment[];
  todayMeetings: CalendarEvent[];
  tomorrowMeetings: CalendarEvent[];
  stats: {
    meetingHoursToday: string;
    meetingCount: number;
    totalThreads: number;
    classified: number;
    draftsReady: number;
  };
}

export interface ThreadDetail {
  thread: Thread;
  messages: Message[];
  classification: {
    priority: string;
    label: string;
    rule_signals: string;
    llm_rationale: string | null;
    confidence: number;
    needs_reply: number;
  } | null;
  drafts: { id: number; variant: string; body_text: string; status: string; created_at: string }[];
}

export interface Health {
  status: string;
  lastMailSync: string | null;
  lastCalendarSync: string | null;
  messages: number;
  threads: number;
  events: number;
}

export interface Stats {
  messages: number;
  threads: number;
  events: number;
  draftsReady: number;
  draftsSent: number;
  byPriority: Record<string, number>;
}

// --- API calls ---

export const api = {
  health: () => get<Health>('/health'),
  brief: () => get<Brief>('/brief'),
  threads: (priority?: string, limit = 50) =>
    get<{ threads: Thread[] }>(`/threads?limit=${limit}${priority ? `&priority=${priority}` : ''}`),
  thread: (id: string) => get<ThreadDetail>(`/thread/${encodeURIComponent(id)}`),
  events: (date?: string) => get<{ events: CalendarEvent[] }>(`/events${date ? `?date=${date}` : ''}`),
  commitments: (status?: string) =>
    get<{ commitments: Commitment[] }>(`/commitments${status ? `?status=${status}` : ''}`),
  stats: () => get<Stats>('/stats'),
  sync: () => post<{ ok: boolean; results: unknown }>('/sync'),
  override: (conversationId: string, priority: string) =>
    post<{ ok: boolean }>(`/override/${encodeURIComponent(conversationId)}`, { priority }),
  draft: (conversationId: string, variant: string, instructions?: string) =>
    post<{ ok: boolean; draft: { id: number; variant: string; body_text: string; status: string } }>(
      `/draft/${encodeURIComponent(conversationId)}`,
      { variant, instructions }
    ),
  classify: (conversationId: string) =>
    post<{ ok: boolean; classification: unknown }>(`/classify/${encodeURIComponent(conversationId)}`),
  senderRules: () => get<{ rules: { email_pattern: string; priority_boost: number; label: string }[] }>('/sender-rules'),
  addSenderRule: (rule: { email_pattern: string; priority_boost: number; label: string }) =>
    post<{ ok: boolean }>('/sender-rules', rule),
  send: (draftId: number, replyAll = false) =>
    post<{ ok: boolean; outboxFile: string; to: string[]; cc: string[] }>(`/send/${draftId}`, { replyAll }),
  search: (q: string, type?: string) =>
    get<{ emails: (Thread & { snippet: string })[]; events: (CalendarEvent & { snippet: string })[]; commitments: Commitment[] }>(
      `/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`
    ),
  extractCommitments: () => post<{ ok: boolean; scanned: number; extracted: number }>('/commitments/extract-all'),
  completeCommitment: (id: number) => post<{ ok: boolean }>(`/commitments/${id}/done`),
  meetingPrep: (eventId: string) => get<{
    event: CalendarEvent;
    relatedThreads: Thread[];
    commitments: Commitment[];
    brief: string;
  }>(`/prep/${encodeURIComponent(eventId)}`),
  briefText: () => get<{ text: string; date: string }>('/brief/text'),
};
