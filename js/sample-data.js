// sample-data.js
//
// Hand-written demo content. NOT fetched from real feeds.
// The roadmap §14 step 5 deliverable is an empty shell with plausible
// fixture content so the layout is visible without a backend. Real feed
// fetching is the Cloudflare Worker job described in ROADMAP §4.
//
// Every number in these excerpts is sourced from ROADMAP §0 anchors [S1]–[S8].
// Body paragraphs paraphrase the source; they are not pulled verbatim.

export const SAMPLE = [
  {
    id: "a1",
    source: "mnot.net",
    shelf: "standards",
    title: "Web Feeds in 2026: a quieter conclusion",
    age: "2h",
    read: false,
    excerpt: "Of 196,598 sites scanned, 35.9% still expose an autodiscovery link. Of those feeds, 22.6% clear a basic quality bar. The web didn't die; its tooling did.",
    body: [
      "Of 196,598 sites scanned across the Tranco top 500,000, 35.9% still expose a feed autodiscovery link. That number alone is not the story.",
      "The story is the gap between exposure and quality. Of 543,577 feed URLs probed, the parse success rate sits at 98.3%. The web's plumbing works. But only 22.6% of parsed feeds clear a basic recency-plus-content quality bar.",
      "WordPress feeds reach the bar at 36.5%. Blogger reaches it at 5.9%. Substack and Squarespace both land near 90%. Platform choice predicts feed health far more than any other variable we measured.",
      "The reader you should build in 2026 is not one with more AI. It is one that filters at index time, so the user never sees the 77.4% of feeds that don't deserve their attention."
    ]
  },
  {
    id: "a-podcast",
    source: "coda.demo",
    shelf: "standards",
    title: "Audio entry: a silent demo clip",
    age: "5h",
    read: false,
    excerpt: "A demo podcast entry that carries an audio enclosure, so the list shows an audio badge and the reader shows a player. The clip is a short silent tone, not a real episode.",
    body: [
      "This entry exists to exercise audio rendering. Its enclosure points at a tiny silent clip embedded inline, so nothing is fetched from the network.",
      "When real feeds carry a podcast enclosure, the same player appears here and the same badge appears in the list. Transcription of the audio is a separate, later step."
    ],
    enclosure: { url: "data:audio/wav;base64,UklGRhQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YfAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=", type: "audio/wav", length: "" }
  },
  {
    id: "a2",
    source: "ietf.org",
    shelf: "standards",
    title: "draft-nottingham-feed-menu-00",
    age: "11h",
    read: false,
    excerpt: "A small extension to the feed autodiscovery contract: instead of one rel=alternate, an explicit menu listing every feed a site publishes, with hints about which is canonical.",
    body: [
      "The current contract is one rel=alternate per page. Sites that publish ten section feeds either burn ten link tags into every page or hide nine of them.",
      "The proposed mechanism is a single feed-menu document at a well-known location. Readers fetch it once, cache it, and present the menu to the user instead of guessing.",
      "Status: straw-man. No implementations yet. The point of publishing the draft is to find out who already solved this and why I haven't heard about it."
    ]
  },
  {
    id: "a3",
    source: "jsonfeed.org",
    shelf: "standards",
    title: "JSON Feed 1.1, six years on",
    age: "yesterday",
    read: true,
    excerpt: "The spec did what it set out to do: make feeds writable by humans without an XML library. The adoption story is more complicated.",
    body: [
      "The spec did what it set out to do. You can write a valid JSON Feed by hand in a text editor, which is not true of any flavour of Atom.",
      "Adoption is roughly 4% of feeds that publish at all. The big platforms (WordPress, Substack, Ghost) emit both Atom and JSON Feed; the long tail emits whatever their generator emits.",
      "Verdict: a quiet success. Not the format that won, but a format that made the others better by example."
    ]
  },
  {
    id: "a4",
    source: "w3.org",
    shelf: "standards",
    title: "WebSub: still the only push spec that shipped",
    age: "2d",
    read: false,
    excerpt: "Eight years after Recommendation status, WebSub is supported by roughly 4% of feeds, and those 4% include almost every high-volume publisher.",
    body: [
      "WebSub reached Recommendation status in January 2018. Eight years on, support sits at about 4% of feeds.",
      "The 4% is not the long tail. It is the head: WordPress.com, Tumblr, Medium, every Substack. A reader that subscribes to ten Substacks via WebSub will see new posts within seconds, no polling cost.",
      "If you build polling without WebSub fallback, you are paying for bandwidth you do not need to pay for."
    ]
  },
  {
    id: "a5",
    source: "winters27 / github",
    shelf: "engineering",
    title: "Obsidian BYOC: bring your own cloud, twelve providers",
    age: "3d",
    read: false,
    excerpt: "An architectural precedent for sync that doesn't lock the user into the vendor. Dropbox, Google Drive, OneDrive, S3, R2, B2, WebDAV. The user picks.",
    body: [
      "The architecture is straightforward. An event log written to a folder. A materialised snapshot updated periodically. The backend is whatever the user wired up.",
      "Encryption is optional (rclone-crypt or in-app AES-256) and lives on the client. The provider never sees plaintext.",
      "This is the model CODA is borrowing. Not because it is novel, but because it is correct."
    ]
  },
  {
    id: "a6",
    source: "opml.org",
    shelf: "standards",
    title: "OPML 2.0 and the politics of import",
    age: "4d",
    read: true,
    excerpt: "OPML is the only thing standing between the user and lock-in. Every reader exports it; every reader imports it. The friction is what to do with the import once it arrives.",
    body: [
      "OPML is older than half its users. It has no business still being the export format. And yet, every reader from Google Reader onward has implemented it, because the alternative is lock-in.",
      "The interesting problem is not the import; it is the triage. A typical OPML export contains 89 feeds; 17 of them have not published in two years. A reader that imports everything wholesale is doing the user a quiet harm."
    ]
  }
];
