import { test, expect } from "@playwright/test";

const SITE = "/";

async function seedSubsViaImport(page) {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Seed</title></head>
  <body>
    <outline text="Example Blog" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com/"/>
    <outline text="Other Source" type="rss" xmlUrl="https://other.example.com/rss" htmlUrl="https://other.example.com/"/>
  </body>
</opml>`;

  await page.locator("#enterSettingsBtn").click();
  await page.locator("#opml-import-file").setInputFiles({
    name: "seed.opml",
    mimeType: "application/xml",
    buffer: Buffer.from(opml, "utf-8"),
  });
  await expect(page.locator("#opml-triage")).toBeVisible();
  page.once("dialog", async (d) => { await d.accept(); });
  await page.locator("#opml-commit-import").click();
  await expect(page.locator("#opml-import-status")).toContainText(/Imported 2 feed/);
}

test.describe("Subscription list + actions", () => {
  test("list renders every imported feed", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    const rows = page.locator(".subs-list__row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator(".subs-list__title")).toContainText("Example Blog");
    await expect(rows.last().locator(".subs-list__title")).toContainText("Other Source");
  });

  test("empty state shows when no subscriptions exist", async ({ page }) => {
    await page.goto(SITE);
    await page.locator("#enterSettingsBtn").click();
    await expect(page.locator("#subs-list-empty")).toBeVisible();
  });

  test("removeFeed removes from subs.json and re-renders", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    await expect(page.locator(".subs-list__row")).toHaveCount(2);
    const result = await page.evaluate(async () => {
      return window.codaSubs.removeFeed("https://example.com/feed.xml");
    });
    expect(result).toEqual({ removed: true, totalFeeds: 1 });
    await page.evaluate(() => window.codaSubs.renderSubsList());
    await expect(page.locator(".subs-list__row")).toHaveCount(1);
    await expect(page.locator(".subs-list__row").first().locator(".subs-list__title"))
      .toContainText("Other Source");
  });

  test("renameFeed updates the stored title", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    const result = await page.evaluate(async () => {
      return window.codaSubs.renameFeed("https://other.example.com/rss", "Renamed Source");
    });
    expect(result).toEqual({ renamed: true });
    await page.evaluate(() => window.codaSubs.renderSubsList());
    await expect(page.locator(".subs-list__row").last().locator(".subs-list__title"))
      .toContainText("Renamed Source");
  });

  test("moveFeed updates the stored shelf", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    const result = await page.evaluate(async () => {
      return window.codaSubs.moveFeed("https://example.com/feed.xml", "indie");
    });
    expect(result).toEqual({ moved: true });
    await page.evaluate(() => window.codaSubs.renderSubsList());
    await expect(page.locator(".subs-list__row").first().locator(".subs-list__meta"))
      .toContainText(/indie/);
  });

  test("removeFeed returns removed:false for an unknown url", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    const result = await page.evaluate(async () => {
      return window.codaSubs.removeFeed("https://does-not-exist.example/feed");
    });
    expect(result).toEqual({ removed: false, totalFeeds: 2 });
  });

  test("menu button is present and labelled", async ({ page }) => {
    await page.goto(SITE);
    await seedSubsViaImport(page);
    const btn = page.locator(".subs-list__row").first().locator(".subs-list__menu-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-label", "Actions");
  });
});
