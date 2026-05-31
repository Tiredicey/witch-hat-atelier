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

const NO_RSS_SUFFIXES = [
  { suffix: "facebook.com", platform: "Facebook" },
  { suffix: "fb.com",       platform: "Facebook" },
  { suffix: "fb.watch",     platform: "Facebook" },
  { suffix: "instagram.com", platform: "Instagram" },
  { suffix: "instagr.am",   platform: "Instagram" },
  { suffix: "twitter.com",  platform: "X (Twitter)" },
  { suffix: "x.com",        platform: "X (Twitter)" },
  { suffix: "tiktok.com",   platform: "TikTok" },
];

function noRssPlatform(host) {
  const h = String(host || "").toLowerCase();
  for (const { suffix, platform } of NO_RSS_SUFFIXES) {
    if (h === suffix || h.endsWith("." + suffix)) return platform;
  }
  return "";
}

const NO_RSS_REASONS = {
  "Facebook":      "Facebook removed public page RSS feeds in 2018; there is no first-party URL to subscribe to.",
  "Instagram":     "Instagram has never published public RSS feeds.",
  "X (Twitter)":   "X / Twitter removed public RSS in 2013; the v2 API requires a paid tier and an account.",
  "TikTok":        "TikTok does not publish RSS feeds.",
};

const NO_RSS_ALTERNATIVES = {
  "Facebook": [
    "If they also post on Bluesky, paste their bsky.app/profile/<handle> URL. First-party RSS at /rss.",
    "If they run a newsletter or blog, paste that. Substack, Ghost, WordPress, and most CMSes expose /feed or /rss.",
    "If they post videos on YouTube, paste the channel URL.",
    "RSS-Bridge FacebookBridge has no upstream maintainer in 2026 and only succeeds on a small subset of public pages.",
  ],
  "Instagram": [
    "If they cross-post to Bluesky or run a personal site, paste those instead.",
    "RSS-Bridge InstagramBridge needs a self-hosted instance with logged-in cookies; better odds than the Facebook bridge.",
  ],
  "X (Twitter)": [
    "If they cross-post to Bluesky, paste their bsky.app/profile/<handle> URL.",
    "Mastodon profiles expose /<user>.rss natively on any instance.",
  ],
  "TikTok": [
    "If they post the same videos on YouTube, paste the channel URL. YouTube's feed is first-party.",
  ],
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

  const noRss = noRssPlatform(host);
  if (noRss) {
    const platform = noRss;
    const bridgeHint = buildBridgeHint(platform, url, opts.bridgeBase || "", opts.bridgeKind || "");
    return {
      kind: "refused",
      platform,
      reason: NO_RSS_REASONS[platform],
      bridgeHint,
      alternatives: NO_RSS_ALTERNATIVES[platform] || [],
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

  if (/\.substack\.com$/.test(host) && host !== "substack.com" && host !== "www.substack.com") {
    return {
      kind: "feed",
      feedUrl: `${url.protocol}//${host}/feed`,
      source: "substack",
      title: `Substack ${host.replace(/\.substack\.com$/, "")}`,
    };
  }

  if (host === "bsky.app" || host === "www.bsky.app") {
    const m = path.match(/^\/profile\/([A-Za-z0-9._:-]+)\/?$/);
    if (m) {
      return {
        kind: "feed",
        feedUrl: `https://bsky.app/profile/${m[1]}/rss`,
        source: "bluesky",
        title: `Bluesky @${m[1]}`,
      };
    }
  }

  if (host === "medium.com") {
    const at = path.match(/^\/@([A-Za-z0-9_.-]+)\/?$/);
    if (at) {
      return {
        kind: "feed",
        feedUrl: `https://medium.com/feed/@${at[1]}`,
        source: "medium-user",
        title: `Medium @${at[1]}`,
      };
    }
    const pub = path.match(/^\/([A-Za-z0-9_-]+)\/?$/);
    if (pub && pub[1] !== "feed") {
      return {
        kind: "feed",
        feedUrl: `https://medium.com/feed/${pub[1]}`,
        source: "medium-publication",
        title: `Medium ${pub[1]}`,
      };
    }
  }

  if (/\.tumblr\.com$/.test(host) && host !== "tumblr.com" && host !== "www.tumblr.com") {
    return {
      kind: "feed",
      feedUrl: `${url.protocol}//${host}/rss`,
      source: "tumblr",
      title: `Tumblr ${host.replace(/\.tumblr\.com$/, "")}`,
    };
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

function normaliseKind(bridgeKind) {
  return bridgeKind === "rss-bridge" ? "rss-bridge" : "rsshub";
}

function buildBridgeHint(platform, url, bridgeBase, bridgeKind) {
  if (!bridgeBase) {
    return {
      configured: false,
      message:
        `Configure a bridge URL in Settings if you want CODA to ` +
        `route ${platform} URLs through your own RSSHub or RSS-Bridge ` +
        `instance. CODA will not default to a public bridge instance.`,
    };
  }
  const kind = normaliseKind(bridgeKind);
  const base = String(bridgeBase).replace(/\/+$/, "");
  const label = kind === "rss-bridge" ? "RSS-Bridge" : "RSSHub";
  const candidateUrl =
    kind === "rss-bridge"
      ? rssBridgeUrlFor(platform, url, base)
      : (bridgePathFor(platform, url) ? `${base}${bridgePathFor(platform, url)}` : "");
  if (!candidateUrl) {
    return {
      configured: true,
      kind,
      message:
        `Your configured ${label} instance ${base} has no documented ` +
        `route for ${platform} URLs of this shape. Open a profile/page URL ` +
        `for that account, or paste the bridge feed URL directly.`,
    };
  }
  return {
    configured: true,
    kind,
    candidateUrl,
    message:
      `Candidate ${label} URL: ${candidateUrl}. Verify the bridge has this ` +
      `route enabled before adding.`,
  };
}

function rssBridgeUrlFor(platform, url, base) {
  const root = String(base).replace(/\/+$/, "");
  const segs = url.pathname.split("/").filter(Boolean);
  const build = (bridge, context, params) => {
    const sp = new URLSearchParams();
    sp.set("action", "display");
    sp.set("bridge", bridge);
    sp.set("context", context);
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    sp.set("format", "Atom");
    return `${root}/?${sp.toString()}`;
  };
  if (!segs.length) return "";
  const first = segs[0];
  if (platform === "Facebook") {
    const host = (url.host || "").toLowerCase();
    if (host === "fb.watch" || host.startsWith("l.facebook") || host.startsWith("lm.facebook")) return "";
    if (first.toLowerCase() === "groups" && segs[1]) {
      return build("FacebookBridge", "Group", { g: segs[1] });
    }
    if (FB_RESERVED.has(first.toLowerCase())) return "";
    if (!/^[A-Za-z0-9.]+$/.test(first)) return "";
    return build("FacebookBridge", "User", { u: first });
  }
  if (platform === "Instagram") {
    if (IG_RESERVED.has(first.toLowerCase())) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9._]+$/.test(handle)) return "";
    return build("InstagramBridge", "Username", { u: handle });
  }
  if (platform === "X (Twitter)") {
    if (X_RESERVED.has(first.toLowerCase())) return "";
    if (segs.some((s) => s.toLowerCase() === "status")) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]+$/.test(handle)) return "";
    return build("TwitterBridge", "By username", { u: handle });
  }
  if (platform === "TikTok") {
    if (!first.startsWith("@")) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9._]+$/.test(handle)) return "";
    return build("TikTokBridge", "By user", { username: handle });
  }
  return "";
}

const FB_RESERVED = new Set([
  "profile.php", "people", "pages", "groups", "watch", "events",
  "marketplace", "gaming", "story.php", "permalink.php", "sharer",
  "login", "help", "settings", "photo.php", "media",
]);
const IG_RESERVED = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts", "directory",
]);
const X_RESERVED = new Set([
  "i", "home", "search", "hashtag", "explore", "notifications",
  "messages", "settings", "compose", "intent", "share",
]);

function bridgePathFor(platform, url) {
  const segs = url.pathname.split("/").filter(Boolean);
  if (!segs.length) return "";
  const first = segs[0];
  if (platform === "Facebook") {
    const host = (url.host || "").toLowerCase();
    if (host === "fb.watch" || host.startsWith("l.facebook") || host.startsWith("lm.facebook")) return "";
    if (FB_RESERVED.has(first.toLowerCase())) return "";
    if (!/^[A-Za-z0-9.]+$/.test(first)) return "";
    return `/facebook/page/${first}`;
  }
  if (platform === "Instagram") {
    if (IG_RESERVED.has(first.toLowerCase())) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9._]+$/.test(handle)) return "";
    return `/instagram/user/${handle}`;
  }
  if (platform === "X (Twitter)") {
    if (X_RESERVED.has(first.toLowerCase())) return "";
    if (segs.some((s) => s.toLowerCase() === "status")) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]+$/.test(handle)) return "";
    return `/twitter/user/${handle}`;
  }
  if (platform === "TikTok") {
    if (!first.startsWith("@")) return "";
    const handle = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9._]+$/.test(handle)) return "";
    return `/tiktok/user/@${handle}`;
  }
  return "";
}
