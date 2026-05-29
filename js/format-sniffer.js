// format-sniffer.js
//
// Detect the format of an arbitrary text payload dropped into the import
// surface. Returns one of:
//   { kind: "opml" }              — well-formed OPML document
//   { kind: "opml-fragment" }     — loose <outline xmlUrl=…> snippet
//   { kind: "inoreader-stars" }   — Google-Reader-shape JSON (items[] with
//                                   canonical/alternate URLs, or items[] tagged
//                                   /state/com.google/starred)
//   { kind: "unknown", reason }   — no match
//
// Pure function. No DOM, no IO. Easy to unit-test.

const STARRED_STATE_SUFFIX = "/state/com.google/starred";

export function sniffImportFormat(text) {
  if (typeof text !== "string") return { kind: "unknown", reason: "not text" };
  const trimmed = text.trim();
  if (!trimmed) return { kind: "unknown", reason: "empty file" };

  if (/^<\?xml/i.test(trimmed) || /^<opml\b/i.test(trimmed)) {
    return { kind: "opml" };
  }
  if (/<outline\b[^>]*\bxmlUrl=/i.test(trimmed)) {
    return { kind: "opml-fragment" };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data;
    try { data = JSON.parse(trimmed); }
    catch { return { kind: "unknown", reason: "looks like JSON but did not parse" }; }

    const items = Array.isArray(data)
      ? data
      : (Array.isArray(data && data.items) ? data.items : null);

    if (items && items.length > 0) {
      const hasStarred = items.some(it =>
        it && Array.isArray(it.categories) &&
        it.categories.some(c => typeof c === "string" && c.endsWith(STARRED_STATE_SUFFIX))
      );
      const hasCanonicalShape = items.some(it =>
        it && typeof it === "object" &&
        (Array.isArray(it.canonical) || Array.isArray(it.alternate) || typeof it.id === "string")
      );
      if (hasStarred || hasCanonicalShape) return { kind: "inoreader-stars" };
    }
    return { kind: "unknown", reason: "JSON did not look like an Inoreader export" };
  }

  return { kind: "unknown", reason: "could not identify format" };
}

// Wrap a loose <outline> fragment so parseOpml() accepts it.
export function wrapOpmlFragment(text) {
  const trimmed = text.trim();
  if (/^<\?xml/i.test(trimmed) || /^<opml\b/i.test(trimmed)) return trimmed;
  return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Pasted</title></head><body>${trimmed}</body></opml>`;
}
