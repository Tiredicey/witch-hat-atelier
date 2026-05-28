// quality.js
//
// §1 quality heuristic (simplified). Per S1, only 22.6% of parsed feeds
// clear a basic recency + content + metadata bar. We score each feed on a
// 0..1 scale; the Worker only writes entries from feeds that score ≥ 0.5
// to the user's R2 bucket. The full distribution-matching scorer from S1
// is a follow-up; this is the recency/content/metadata triplet.

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

export function scoreFeed({ feedTitle, entries }) {
  if (!entries || entries.length === 0) {
    return { score: 0, reason: "no entries" };
  }
  let parts = [];

  // 1. Recency: most recent entry within the last 12 months?
  const newest = entries.reduce((m, e) => Math.max(m, e.published || 0), 0);
  const recencyAge = Date.now() - newest;
  const recencyScore = newest && recencyAge < ONE_YEAR_MS
    ? Math.max(0, 1 - recencyAge / ONE_YEAR_MS)
    : 0;
  parts.push(["recency", recencyScore]);

  // 2. Content: do entries actually have body text (not just titles)?
  const withContent = entries.filter(e =>
    (e.body && e.body.length > 0 && e.body.some(p => p.length > 40)) ||
    (e.excerpt && e.excerpt.length > 40)
  ).length;
  const contentScore = withContent / entries.length;
  parts.push(["content", contentScore]);

  // 3. Metadata: do entries have ids, titles, and links?
  const withMeta = entries.filter(e => e.id && e.title && e.link).length;
  const metadataScore = withMeta / entries.length;
  parts.push(["metadata", metadataScore]);

  // 4. Feed title present? (One-shot bonus, capped at 0.1)
  const titleBonus = feedTitle && feedTitle.length > 0 ? 0.1 : 0;

  const base = (recencyScore + contentScore + metadataScore) / 3;
  const score = Math.min(1, base + titleBonus);

  return {
    score,
    parts,
    reason: score >= 0.5 ? "ok" : qualityReason(parts),
  };
}

export function passesQuality(scored) {
  return scored && scored.score >= 0.5;
}

function qualityReason(parts) {
  const weak = parts.filter(([_, v]) => v < 0.3).map(([k]) => k);
  if (weak.length === 0) return "low overall score";
  return `weak: ${weak.join(", ")}`;
}
