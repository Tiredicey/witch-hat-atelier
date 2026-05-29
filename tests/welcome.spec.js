import { test, expect } from "@playwright/test";

const SITE = "/";

async function clearOnboarded(page) {
  await page.addInitScript(() => {
    try { localStorage.removeItem("coda/onboarded"); } catch {}
  });
}

async function setOnboarded(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("coda/onboarded", "true"); } catch {}
  });
}

test.describe("Welcome onboarding card", () => {
  test("opens on first boot, hides on subsequent visits", async ({ page }) => {
    await clearOnboarded(page);
    await page.goto(SITE);
    const scrim = page.locator("#welcomeScrim");
    await expect(scrim).toBeVisible();
    await expect(scrim.getByRole("heading", { name: "Welcome to CODA" })).toBeVisible();
    await expect(scrim.locator("[data-step-pane='1']")).toBeVisible();
    await expect(scrim.locator("[data-step-pane='2']")).toBeHidden();
    await expect(scrim.locator("[data-step-pane='3']")).toBeHidden();
  });

  test("Try Hacker News button prefills the input", async ({ page }) => {
    await clearOnboarded(page);
    await page.goto(SITE);
    const input = page.locator("#welcomeFeedUrl");
    await expect(input).toHaveValue("");
    await page.locator("#welcomeHnBtn").click();
    await expect(input).toHaveValue("https://news.ycombinator.com/rss");
  });

  test("Skip on step 1 advances to step 2 without saving a feed", async ({ page }) => {
    await clearOnboarded(page);
    await page.goto(SITE);
    await page.locator("[data-skip='1']").click();
    await expect(page.locator("[data-step-pane='1']")).toBeHidden();
    await expect(page.locator("[data-step-pane='2']")).toBeVisible();
    const localChoice = page.locator(".welcome-card__choices button[data-kind='local']");
    await expect(localChoice).toBeVisible();
  });

  test("choosing local advances to step 3 and finishing marks onboarded", async ({ page }) => {
    await clearOnboarded(page);
    await page.goto(SITE);
    await page.locator("[data-skip='1']").click();
    await page.locator(".welcome-card__choices button[data-kind='local']").click();
    await expect(page.locator("[data-step-pane='3']")).toBeVisible();
    await page.locator("#welcomeDoneBtn").click();
    await expect(page.locator("#welcomeScrim")).toBeHidden();
    const flag = await page.evaluate(() => localStorage.getItem("coda/onboarded"));
    expect(flag).toBe("true");
  });

  test("does not open on subsequent visits", async ({ page }) => {
    await setOnboarded(page);
    await page.goto(SITE);
    await expect(page.locator("#welcomeScrim")).toBeHidden();
  });

  test("invalid URL on step 1 surfaces the error and does not advance", async ({ page }) => {
    await clearOnboarded(page);
    await page.goto(SITE);
    await page.locator("#welcomeFeedUrl").fill("not-a-url");
    await page.locator("#welcomeStep1Next").click();
    await expect(page.locator("#welcomeStatus")).toContainText(/URL/i);
    await expect(page.locator("[data-step-pane='1']")).toBeVisible();
    await expect(page.locator("[data-step-pane='2']")).toBeHidden();
  });
});
