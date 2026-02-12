/**
 * Email classifier — hybrid rules + LLM.
 * 
 * Rule-based first pass (fast, deterministic) → LLM second pass for borderline cases.
 */
import { getDb } from './db.js';
import * as llm from './llm.js';

const USER_EMAIL = () => process.env.USER_EMAIL?.toLowerCase() || '';

/**
 * Classify a thread by priority.
 * @param {object} thread - { conversation_id, subject, messages[] }
 * @returns {{ priority, label, signals, confidence, needsReply, llmRationale }}
 */
export async function classifyThread(thread) {
  // Step 1: Rule-based classification
  const ruleResult = ruleClassify(thread);
  
  // Step 2: If borderline, consult LLM
  if (ruleResult.needsLLM) {
    const llmResult = await llmClassify(thread, ruleResult);
    return {
      ...llmResult,
      rule_signals: JSON.stringify(ruleResult.signals),
    };
  }
  
  return {
    priority: ruleResult.priority,
    label: PRIORITY_LABELS[ruleResult.priority],
    rule_signals: JSON.stringify(ruleResult.signals),
    llm_rationale: null,
    confidence: ruleResult.confidence,
    needs_reply: ruleResult.needsReply ? 1 : 0,
  };
}

const PRIORITY_LABELS = {
  P0: 'Urgent — Reply Today',
  P1: 'Important — This Week',
  P2: 'Follow Up',
  P3: 'FYI / Archive',
};

/**
 * Rule-based classification (deterministic).
 */
function ruleClassify(thread) {
  let score = 0;
  const signals = [];
  const latestMsg = thread.messages[thread.messages.length - 1];
  const userEmail = USER_EMAIL();
  
  // --- Sender rules from DB ---
  const db = getDb();
  const senderRule = db.prepare(
    'SELECT * FROM sender_rules WHERE ? LIKE email_pattern'
  ).get(latestMsg.sender_email);
  
  if (senderRule) {
    score += senderRule.priority_boost * 10;
    signals.push(`sender:${senderRule.label}`);
  }
  
  // --- Recipient signals ---
  const toRecipients = safeParseArray(latestMsg.to_recipients);
  const ccRecipients = safeParseArray(latestMsg.cc_recipients);
  
  const inTo = toRecipients.some(r => r.toLowerCase() === userEmail);
  const inCc = ccRecipients.some(r => r.toLowerCase() === userEmail);
  
  if (inTo) { score += 20; signals.push('direct:to'); }
  else if (inCc) { score -= 10; signals.push('cc-only'); }
  
  // --- Content signals ---
  const body = (latestMsg.body_text || latestMsg.body_preview || '').toLowerCase();
  const subject = (thread.subject || '').toLowerCase();
  const text = `${subject} ${body}`;
  
  if (/\b(eod|end of day|by today|asap|urgent|blocker|blocking)\b/.test(text)) {
    score += 30; signals.push('keyword:urgent');
  }
  if (/\b(by friday|this week|by eow|end of week)\b/.test(text)) {
    score += 15; signals.push('keyword:this-week');
  }
  if (/\b(fyi|no action|for your info|just sharing|no response needed)\b/.test(text)) {
    score -= 20; signals.push('keyword:fyi');
  }
  if (/\b(please review|can you|could you|would you|need your|action required|action needed)\b/.test(text)) {
    score += 20; signals.push('keyword:ask');
  }
  if (/\b(approve|approval|sign.?off|green.?light)\b/.test(text)) {
    score += 25; signals.push('keyword:approval');
  }
  
  // --- Thread signals ---
  const youWereAsked = latestMsg.sender_email.toLowerCase() !== userEmail && inTo;
  if (youWereAsked) {
    score += 25;
    signals.push('thread:awaiting-your-reply');
  }
  
  // Check if you already replied
  const yourReplies = thread.messages.filter(
    m => m.sender_email.toLowerCase() === userEmail
  );
  const latestIsFromOther = latestMsg.sender_email.toLowerCase() !== userEmail;
  if (yourReplies.length > 0 && !latestIsFromOther) {
    score -= 15; signals.push('thread:you-replied-last');
  }
  
  // --- Age signals ---
  const hoursOld = (Date.now() - new Date(latestMsg.received_at).getTime()) / 3600000;
  if (youWereAsked && hoursOld > 24) { score += 15; signals.push('age:stale-24h'); }
  if (youWereAsked && hoursOld > 48) { score += 15; signals.push('age:stale-48h'); }
  
  // --- Distribution signals ---
  const recipientCount = toRecipients.length + ccRecipients.length;
  if (recipientCount > 20) { score -= 30; signals.push('distribution:mass'); }
  if (recipientCount > 50) { score -= 20; signals.push('distribution:blast'); }
  
  // --- Importance header ---
  if (latestMsg.importance === 'high') { score += 10; signals.push('importance:high'); }
  
  // --- Map score to priority ---
  let priority;
  if (score >= 40) priority = 'P0';
  else if (score >= 20) priority = 'P1';
  else if (score >= 0) priority = 'P2';
  else priority = 'P3';
  
  const needsReply = youWereAsked || score >= 20;
  const confidence = Math.min(1.0, Math.abs(score) / 60);
  
  // Borderline = LLM should weigh in
  const needsLLM = score >= -10 && score <= 50 && confidence < 0.7;
  
  return { priority, score, signals, confidence, needsReply, needsLLM };
}

/**
 * LLM classification for borderline cases.
 */
async function llmClassify(thread, ruleResult) {
  const latestMsg = thread.messages[thread.messages.length - 1];
  const threadSummary = thread.messages
    .slice(-5)
    .map(m => `From: ${m.sender_name} (${m.sender_email})\n${m.body_preview}`)
    .join('\n---\n');
  
  const prompt = `You are an email triage assistant. Classify this email thread by urgency.

Thread subject: ${thread.subject}
Thread length: ${thread.messages.length} messages

Recent messages:
${threadSummary}

Rule signals already detected: ${ruleResult.signals.join(', ')}
Rule score: ${ruleResult.score} (borderline — needs your judgment)

Classify as one of:
- P0: Urgent — needs reply today (direct ask with deadline, blocker, escalation)
- P1: Important — needs action this week (review request, decision needed)
- P2: Follow up — should read, may need response later
- P3: FYI — informational, no action needed

Respond in exactly this format:
Priority: P0/P1/P2/P3
Needs reply: yes/no
Rationale: [one sentence]`;

  try {
    const response = await llm.chat(
      'You are a precise email triage assistant. Respond only in the requested format.',
      [{ role: 'user', content: prompt }],
      { maxTokens: 256, temperature: 0.1 }
    );
    
    const priorityMatch = response.match(/Priority:\s*(P[0-3])/i);
    const replyMatch = response.match(/Needs reply:\s*(yes|no)/i);
    const rationaleMatch = response.match(/Rationale:\s*(.+)/i);
    
    const priority = priorityMatch?.[1] || ruleResult.priority;
    const needsReply = replyMatch?.[1]?.toLowerCase() === 'yes';
    
    return {
      priority,
      label: PRIORITY_LABELS[priority],
      confidence: 0.85,
      needs_reply: needsReply ? 1 : 0,
      llm_rationale: rationaleMatch?.[1] || response.trim(),
    };
  } catch (err) {
    console.error('LLM classification failed, using rule result:', err.message);
    return {
      priority: ruleResult.priority,
      label: PRIORITY_LABELS[ruleResult.priority],
      confidence: ruleResult.confidence,
      needs_reply: ruleResult.needsReply ? 1 : 0,
      llm_rationale: `LLM failed: ${err.message}`,
    };
  }
}

function safeParseArray(json) {
  try { return JSON.parse(json || '[]'); }
  catch { return []; }
}
