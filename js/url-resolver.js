// url-resolver.js
//
// Pure, browser-side resolution from "any URL the reader pasted" to a
// concrete feed URL, BEFORE involving the Worker /discover network round
// trip. Two reasons it lives here and not in the Worker:
//
//   1. Latency. For URLs that match a documented canonical pattern
//      (Reddit subreddit, Mastodon profile, GitHub releases, YouTube
//      channel-by-ID and playlist), there is no reason to spend a fetch
//      on /discover. The mapping is fully deterministic.
//   2. Honesty. For URLs that have no public RSS in 2026 (Facebook,
//      Instagram, X / Twitter, TikTok) the user deserves a clear refusal,
//      not a silent /discover call that comes back empty. The refusal
//      can optionally suggest a user-configured RSSHub bridge but
//      MUST NOT silently route through a public bridge.
//
// resolve(rawInput, { bridgeBase = "" }) returns one of:
//
//   { kind: "feed",     feedUrl, source, title? }
//       direct feed-URL pattern. No network needed.
//   { kind: "discover", pageUrl }
//       no pattern matched; caller should hit Worker /discover.
//   { kind: "refused",  platform, reason, bridgeHint? }
//       platform has no public feed; reason is shown to the user.
//   { kind: "invalid",  reason }
//       input could not be parsed as a URL.
//
// Every kind:"feed" mapping below is documented by the platform itself.
// Citations live in docs/add-feed.md so the source trail does not rot
// inside a comment.

const NO_RSS_PLATFORMS = {
  "facebook.com":   "Facebook",
  "www.facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "fb.com":         "Facebook",
  "instagram.com":  "Instagram",
  "www.instagram.com": "Instagram",
  "x.com":          "X (Twitter)",
  "www.x.com":      "X (Twitter)",
  "twitter.com":    "X (Twitter)",
  "www.twitter.com":"X (Twitter)",
  "mobile.twitter.com": "X (Twitter)",
  "tiktok.com":     "TikTok",
  "www.tiktok.com": "TikTok",
};

const NO_RSS_REASONS = {
  "Facebook":      "Facebook removed public page RSS feeds in 2018; there is no first-party URL to subscribe to.",
  "Instagram":     "Instagram has never published public RSS feeds.",
  "X (Twitter)":   "X / Twitter removed public RSS in 2013; the v2 API requires a paid tier and an account.",
  "TikTok":        "TikTok does not publish RSS feeds.",
};

export function resolve(rawInput, opts = {}) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) return { kind: "invalid", reason: "URL is empty." };

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    const scheme = trimmed.split(":", 1)[0];
    return { kind: "invalid", reason: `Unsupported protocol: ${scheme}:` };
  }
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "invalid", reason: "That does not look like a URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "invalid", reason: `Unsupported protocol: ${url.protocol}` };
  }

  const host = url.host.toLowerCase();
  const path = url.pathname || "/";

  if (NO_RSS_PLATFORMS[host]) {
    const platform = NO_RSS_PLATFORMS[host];
    const bridgeHint = buildBridgeHint(platform, url, opts.bridgeBase || "");
    return {
      kind: "refused",
      platform,
      reason: NO_RSS_REASONS[platform],
      bridgeHint,
    };
  }

  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    const yt = resolveYouTube(url);
    if (yt) return yt;
  }
  if (host === "youtu.be") {
    return {
      kind: "refused",
      platform: "YouTube short link",
      reason: "Short youtu.be links point at single videos, not feeds. Paste the channel or playlist URL instead.",
    };
  }

  if (host === "reddit.com" || host === "www.reddit.com" || host === "old.reddit.com") {
    const m = path.match(/^\/r\/([A-Za-z0-9_]+)\/?$/);
    if (m) {
      return {
        kind: "feed",
        feedUrl: `https://www.reddit.com/r/${m[1]}/.rss`,
        source: "reddit-subreddit",
        title: `r/${m[1]}`,
      };
    }
    const userMatch = path.match(/^\/user\/([A-Za-z0-9_-]+)\/?$/);
    if (userMatch) {
      return {
        kind: "feed",
        feedUrl: `https://www.reddit.com/user/${userMatch[1]}/.rss`,
        source: "reddit-user",
        title: `u/${userMatch[1]}`,
      };
    }
  }

  if (host === "github.com" || host === "www.github.com") {
    const m = path.match(/^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\/(?:releases|commits|tags)?)?\/?$/);
    if (m && m[1] !== "orgs" && m[1] !== "search" && m[1] !== "settings") {
      return {
        kind: "feed",
        feedUrl: `https://github.com/${m[1]}/${m[2]}/releases.atom`,
        source: "github-releases",
        title: `${m[1]}/${m[2]} releases`,
      };
    }
  }

  const mastoUser = path.match(/^\/@([A-Za-z0-9_.-]+)\/?$/);
  if (mastoUser && !/(youtube|reddit|github|medium|substack)\./.test(host)) {
    return {
      kind: "feed",
      feedUrl: `${url.protocol}//${url.host}/@${mastoUser[1]}.rss`,
      source: "mastodon-profile",
      title: `@${mastoUser[1]}@${url.host}`,
    };
  }

  return { kind: "discover", pageUrl: url.toString() };
}

function resolveYouTube(url) {
  const path = url.pathname || "/";
  const params = url.searchParams;

  if (params.has("list")) {
    const playlistId = params.get("list");
    if (/^PL[A-Za-z0-9_-]+$|^UU[A-Za-z0-9_-]+$|^FL[A-Za-z0-9_-]+$|^OL[A-Za-z0-9_-]+$/.test(playlistId)) {
      return {
        kind: "feed",
        feedUrl: `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
        source: "youtube-playlist",
        title: `YouTube playlist ${playlistId}`,
      };
    }
  }

  const channelMatch = path.match(/^\/channel\/(UC[A-Za-z0-9_-]+)\/?/);
  if (channelMatch) {
    return {
      kind: "feed",
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`,
      source: "youtube-channel",
      title: `YouTube channel ${channelMatch[1]}`,
    };
  }

  const userMatch = path.match(/^\/user\/([A-Za-z0-9_-]+)\/?/);
  if (userMatch) {
    return {
      kind: "feed",
      feedUrl: `https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`,
      source: "youtube-user",
      title: `YouTube user ${userMatch[1]}`,
    };
  }

  if (/^\/@[A-Za-z0-9._-]+/.test(path) || /^\/c\/[A-Za-z0-9._-]+/.test(path)) {
    return null;
  }

  return null;
}

function buildBridgeHint(platform, url, bridgeBase) {
  if (!bridgeBase) {
    return {
      configured: false,
      message:
        `Configure an RSSHub bridge URL in Settings if you want CODA to ` +
        `route ${platform} URLs through your own bridge. CODA will not ` +
        `default to a public bridge instance.`,
    };
  }
  const base = String(bridgeBase).replace(/\/+$/, "");
  const path = bridgePathFor(platform, url);
  if (!path) {
    return {
      configured: true,
      message:
        `Your configured bridge ${base} does not have a documented route ` +
        `pattern for ${platform} URLs of this shape. Open the bridge's docs ` +
        `for the exact route, then paste the bridge URL directly.`,
    };
  }
  return {
    configured: true,
    candidateUrl: `${base}${path}`,
    message:
      `Candidate bridge URL: ${base}${path}. Verify the bridge has this ` +
      `route enabled before adding.`,
  };
}

function bridgePathFor(platform, url) {
  const segs = url.pathname.split("/").filter(Boolean);
  if (platform === "Facebook" && segs.length >= 1) {
    return `/facebook/page/${segs[0]}`;
  }
  if (platform === "Instagram" && segs.length >= 1) {
    return `/instagram/user/${segs[0]}`;
  }
  if (platform === "X (Twitter)" && segs.length >= 1) {
    return `/twitter/user/${segs[0]}`;
  }
  if (platform === "TikTok" && segs.length >= 1) {
    const handle = segs[0].replace(/^@/, "");
    return `/tiktok/user/@${handle}`;
  }
  return "";
}
