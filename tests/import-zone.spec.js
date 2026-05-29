import { test, expect } from "@playwright/test";

const SITE = "/";

const OPML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Example Blog" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com/"/>
    <outline text="Other Blog"   type="rss" xmlUrl="https://other.example.com/rss" htmlUrl="https://other.example.com/"/>
  </body>
</opml>`;

const INOREADER_SAMPLE = JSON.stringify({
  items: [
    {
      id: "tag:google.com,2005:reader/item/0001",
      title: "A starred article",
      canonical: [{ href: "https://example.com/posts/one" }],
      alternate: [{ href: "https://example.com/posts/one" }],
      categories: ["user/-/state/com.google/starred"],
      timestampUsec: "1716000000000000",
    },
  ],
});

const GARBAGE = "this is just plain text, not opml or json";

async function dropTextAsFile(page, selector, filename, mime, body) {
  // Use the fallback file input which the zone delegates to
  const fileInput = page.locator("#import-zone-file");
  await fileInput.setInputFiles({
    name: filename,
    mimeType: mime,
    buffer: Buffer.from(body, "utf-8"),
  });
}

test.describe("Unified import drop zone", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SITE);
    await page.locator("#enterSettingsBtn").click();
    await expect(page.locator("#import-zone")).toBeVisible();
  });

  test("OPML file is detected and triage list appears", async ({ page }) => {
    await dropTextAsFile(page, "#import-zone-file", "subs.opml", "application/xml", OPML_SAMPLE);
    await expect(page.locator("#opml-triage")).toBeVisible();
    await expect(page.locator("#import-zone-status")).toContainText(/Parsed 2 feed/);
  });

  test("Inoreader JSON is detected and reports stars imported", async ({ page }) => {
    await dropTextAsFile(page, "#import-zone-file", "stars.json", "application/json", INOREADER_SAMPLE);
    await expect(page.locator("#import-zone-status")).toContainText(/Imported 1 star/);
    await expect(page.locator("#opml-triage")).toBeHidden();
  });

  test("Unknown format surfaces an honest error", async ({ page }) => {
    await dropTextAsFile(page, "#import-zone-file", "garbage.txt", "text/plain", GARBAGE);
    await expect(page.locator("#import-zone-status")).toContainText(/Could not identify/);
    await expect(page.locator("#import-zone-status")).toHaveAttribute("data-status", "fail");
    await expect(page.locator("#opml-triage")).toBeHidden();
  });

  test("Drop zone visual state toggles on drag", async ({ page }) => {
    const zone = page.locator("#import-zone");
    await zone.dispatchEvent("dragenter");
    await expect(zone).toHaveAttribute("data-over", "true");
    await zone.dispatchEvent("dragleave");
    await expect(zone).toHaveAttribute("data-over", "false");
  });

  test("Legacy input IDs survive as hidden inputs (back-compat)", async ({ page }) => {
    await expect(page.locator("#opml-import-file")).toHaveCount(1);
    await expect(page.locator("#opml-import-file")).toHaveClass(/import-zone__legacy/);
    await expect(page.locator("#inoreader-stars-file")).toHaveCount(1);
    await expect(page.locator("#inoreader-stars-file")).toHaveClass(/import-zone__legacy/);
    // The class hides them visually via the clip-path trick; Playwright's
    // toBeHidden() does not recognise that pattern so we verify with a
    // bounding-box check instead.
    const opmlBox = await page.locator("#opml-import-file").boundingBox();
    expect(opmlBox?.width || 0).toBeLessThan(5);
  });
});
