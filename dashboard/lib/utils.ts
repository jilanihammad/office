export function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatTime(date: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function priorityColor(priority: string): string {
  switch (priority) {
    case 'P0': return 'var(--p0)';
    case 'P1': return 'var(--p1)';
    case 'P2': return 'var(--p2)';
    default:   return 'var(--p3)';
  }
}

/**
 * Sanitize HTML — only allow <mark> tags (used for search highlights).
 * Strips everything else to prevent XSS from email content. (Issue #3)
 * 
 * Strategy: extract <mark>...</mark> segments, escape everything else,
 * then reconstruct. This avoids regex-bypass attacks.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  // Split on <mark> and </mark>, keeping them as delimiters
  const parts = html.split(/(<\/?mark>)/gi);
  let inMark = false;
  let result = '';
  for (const part of parts) {
    if (part.toLowerCase() === '<mark>') {
      inMark = true;
      result += '<mark>';
    } else if (part.toLowerCase() === '</mark>') {
      inMark = false;
      result += '</mark>';
    } else {
      // Escape all HTML in content (whether inside or outside mark)
      result += escapeHtml(part);
    }
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function priorityBg(priority: string): string {
  switch (priority) {
    case 'P0': return 'bg-red-500/10 border-red-500/30 text-red-400';
    case 'P1': return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
    case 'P2': return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    default:   return 'bg-neutral-500/10 border-neutral-500/30 text-neutral-400';
  }
}
