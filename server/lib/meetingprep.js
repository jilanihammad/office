/**
 * Meeting prep engine.
 * 
 * Before each meeting, auto-compiles:
 * - Related email threads (by participants + subject overlap)
 * - Open commitments involving attendees
 * - Recent decisions/context from institutional memory
 * - LLM-generated prep brief
 */
import { getDb } from './db.js';
import * as llm from './llm.js';

/**
 * Generate a meeting prep brief for an event.
 * @param {string} eventId - Calendar event ID
 * @returns {{ event, relatedThreads, commitments, brief }}
 */
export async function generateMeetingPrep(eventId) {
  const db = getDb();
  
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  
  const attendees = safeParseJSON(event.attendees);
  const attendeeEmails = attendees.map(a => 
    (typeof a === 'string' ? a : a.email || '').toLowerCase()
  ).filter(Boolean);
  
  // Find related email threads by participant overlap
  const relatedThreads = findRelatedThreads(db, attendeeEmails, event.subject);
  
  // Find open commitments involving attendees
  const commitments = findRelatedCommitments(db, attendeeEmails);
  
  // Find previous meeting notes/decisions
  const history = findMeetingHistory(db, event.subject, attendeeEmails);
  
  // Generate LLM brief
  const brief = await generateBrief(event, relatedThreads, commitments, history);
  
  // Store the prep brief on the event
  db.prepare('UPDATE events SET prep_brief = ?, prep_generated_at = datetime(\'now\') WHERE id = ?')
    .run(brief, eventId);
  
  return {
    event: { ...event, attendees },
    relatedThreads,
    commitments,
    previousMeetings: history,
    brief,
  };
}

/**
 * Find email threads involving any of the attendees.
 */
function findRelatedThreads(db, attendeeEmails, meetingSubject) {
  if (attendeeEmails.length === 0) return [];
  
  // Get recent threads
  const recentThreads = db.prepare(`
    SELECT t.*, c.priority, c.label, c.needs_reply
    FROM threads t
    LEFT JOIN classifications c ON t.conversation_id = c.conversation_id
    WHERE t.latest_message_at > datetime('now', '-14 days')
    ORDER BY t.latest_message_at DESC
    LIMIT 200
  `).all();
  
  // Score threads by relevance
  const scored = recentThreads.map(thread => {
    let score = 0;
    const participants = safeParseJSON(thread.participants);
    
    // Participant overlap
    const overlap = participants.filter(p => 
      attendeeEmails.some(e => p.toLowerCase().includes(e))
    ).length;
    score += overlap * 10;
    
    // Subject similarity (simple keyword overlap)
    if (meetingSubject && thread.subject) {
      const meetingWords = meetingSubject.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const threadWords = thread.subject.toLowerCase();
      const matches = meetingWords.filter(w => threadWords.includes(w)).length;
      score += matches * 5;
    }
    
    // Priority boost
    if (thread.priority === 'P0') score += 5;
    if (thread.priority === 'P1') score += 3;
    if (thread.needs_reply) score += 3;
    
    return { ...thread, relevanceScore: score, participantOverlap: overlap };
  });
  
  return scored
    .filter(t => t.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 10);
}

/**
 * Find commitments involving attendees.
 */
function findRelatedCommitments(db, attendeeEmails) {
  const allOpen = db.prepare(
    "SELECT * FROM commitments WHERE status IN ('open', 'overdue') ORDER BY due_date ASC"
  ).all();
  
  return allOpen.filter(c => {
    const owner = (c.owner || '').toLowerCase();
    return owner === 'you' || attendeeEmails.some(e => owner.includes(e));
  });
}

/**
 * Find previous meetings with similar subject/attendees.
 */
function findMeetingHistory(db, subject, attendeeEmails) {
  const pastEvents = db.prepare(`
    SELECT * FROM events 
    WHERE start_time < datetime('now') AND prep_brief IS NOT NULL
    ORDER BY start_time DESC
    LIMIT 50
  `).all();
  
  return pastEvents.filter(e => {
    const eventAttendees = safeParseJSON(e.attendees);
    const eventEmails = eventAttendees.map(a => 
      (typeof a === 'string' ? a : a.email || '').toLowerCase()
    );
    const overlap = eventEmails.filter(e => attendeeEmails.includes(e)).length;
    return overlap >= 2; // At least 2 shared attendees
  }).slice(0, 5);
}

/**
 * Generate LLM prep brief.
 */
async function generateBrief(event, relatedThreads, commitments, history) {
  const attendees = safeParseJSON(event.attendees);
  
  const threadSummaries = relatedThreads.slice(0, 5).map(t => 
    `- "${t.subject}" (${t.priority || 'unclassified'}) — ${t.message_count} messages, last activity ${t.latest_message_at}`
  ).join('\n');
  
  const commitmentList = commitments.map(c =>
    `- ${c.owner}: ${c.description}${c.due_date ? ` (due ${c.due_date})` : ''} [${c.status}]`
  ).join('\n');
  
  const attendeeList = attendees.map(a => 
    typeof a === 'string' ? a : `${a.name || ''} (${a.email || ''})`
  ).join(', ');
  
  const prompt = `Generate a concise meeting prep brief.

Meeting: ${event.subject}
Time: ${event.start_time} — ${event.end_time}
Location: ${event.location || 'Not specified'}
Attendees: ${attendeeList}
${event.body_text ? `Agenda: ${event.body_text.slice(0, 500)}` : ''}

Related email threads:
${threadSummaries || '(none found)'}

Open commitments involving attendees:
${commitmentList || '(none)'}

Previous meetings with these attendees: ${history.length}

Write a brief (3-5 bullet points) covering:
1. Key context: what's the likely topic / what was discussed recently
2. Open items: what's pending or overdue with these people
3. Your prep: what should you have ready for this meeting
4. Watch out: anything tense, overdue, or political

Be direct. No filler.`;

  try {
    return await llm.chat(
      'You are a meeting prep assistant. Write concise, actionable briefs.',
      [{ role: 'user', content: prompt }],
      { maxTokens: 512, temperature: 0.3 }
    );
  } catch (err) {
    return `Meeting prep generation failed: ${err.message}. Manual context: ${relatedThreads.length} related threads, ${commitments.length} open commitments.`;
  }
}

/**
 * Auto-generate prep for upcoming meetings (next 24h) that don't have one.
 */
export async function prepUpcoming() {
  const db = getDb();
  
  const upcoming = db.prepare(`
    SELECT * FROM events 
    WHERE start_time > datetime('now') 
    AND start_time < datetime('now', '+24 hours')
    AND (prep_brief IS NULL OR prep_generated_at < datetime('now', '-6 hours'))
    ORDER BY start_time ASC
  `).all();
  
  const results = [];
  for (const event of upcoming) {
    try {
      const prep = await generateMeetingPrep(event.id);
      results.push({ event: event.subject, status: 'ok', commitments: prep.commitments.length });
    } catch (err) {
      results.push({ event: event.subject, status: 'error', error: err.message });
    }
  }
  
  return results;
}

function safeParseJSON(str) {
  try { return JSON.parse(str || '[]'); }
  catch { return str; }
}
