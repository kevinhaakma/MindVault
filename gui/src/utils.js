// Stable string → 32-bit hash
export function hashId(s) {
  let h = 0;
  for (let i = 0; i < (s?.length || 0); i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
  return h;
}

// Heat gradient: 0 → cold blue, 1 → hot orange
export function heatColor(t) {
  const c = [42, 48, 80].map((v, i) => Math.round(v + ([255, 107, 61][i] - v) * t));
  return `rgb(${c.join(",")})`;
}

// Relative time string
export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)     return "just now";
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(epochSec) {
  if (!epochSec) return "";
  return new Date(epochSec * 1000).toLocaleString();
}

// Memory liveness: 0.25 (stale) → 1.0 (fresh + recalled)
export function livenessOf(n) {
  const now = Date.now() / 1000;
  const ageDays = Math.max(0, (now - (n.created_at || 0)) / 86400);
  const staleness = Math.min(1, ageDays / 180);
  const accessBoost = Math.min(1, (n.access_count || 0) / 6);
  return Math.max(0.25, 1 - staleness * 0.7 + accessBoost * 0.4);
}
