// age.js
// Live relative-age label. Pure function of a timestamp and the current
// instant, so the same entry re-renders to a fresh label as time passes.

export function formatAge(ts, now = Date.now()) {
  if (!ts || !Number.isFinite(ts)) return "";
  const diff = now - ts;
  if (diff < 0) return "just now";
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d}d`;
  return new Date(ts).toISOString().slice(0, 10);
}
