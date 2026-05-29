import { test, expect } from "@playwright/test";

// Touch-gesture specs run on mobile-chromium only — desktop devices do
// not advertise TouchEvent in Playwright's default Chromium build.
test.describe.configure({ mode: "default" });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium",
    "swipe gestures depend on touch support, only the mobile project has it");
});

async function dispatchTouchSequence(page, selector, fromX, toX, y) {
  // Synthesize a horizontal touch swipe via the CDP touchscreen API.
  await page.locator(selector).waitFor();
  const box = await page.locator(selector).boundingBox();
  const startX = box.x + fromX;
  const startY = box.y + (y ?? box.height / 2);
  const endX   = box.x + toX;
  const endY   = startY;
  await page.touchscreen.tap(startX, startY).catch(() => {});
  // Better: dispatch raw touch events through evaluate so we exercise the
  // same listeners the app wires up.
  await page.evaluate(({ sel, sx, sy, ex, ey }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const touch = (x, y) => new Touch({
      identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y,
      radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
    });
    const evt = (type, x, y) => new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches:        type === "touchend" ? [] : [touch(x, y)],
      targetTouches:  type === "touchend" ? [] : [touch(x, y)],
      changedTouches: [touch(x, y)],
    });
    el.dispatchEvent(evt("touchstart", sx, sy));
    el.dispatchEvent(evt("touchmove",  (sx + ex) / 2, sy));
    el.dispatchEvent(evt("touchmove",  ex, ey));
    el.dispatchEvent(evt("touchend",   ex, ey));
  }, { sel: selector, sx: startX, sy: startY, ex: endX, ey: endY });
}

test.describe("Article-row swipe gestures (mobile)", () => {
  test("swipe right stars the article", async ({ page }) => {
    await page.goto("/");
    const firstRow = page.locator(".article-row").first();
    await firstRow.waitFor();
    const id = await firstRow.getAttribute("data-id");
    expect(id).toBeTruthy();

    const box = await firstRow.boundingBox();
    await page.evaluate(({ sel, dx }) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      const sx = b.left + 20;
      const sy = b.top + b.height / 2;
      const ex = sx + dx;
      const ey = sy;
      const touch = (x, y) => new Touch({
        identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
      });
      const evt = (type, list) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: list, targetTouches: list, changedTouches: list,
      });
      el.dispatchEvent(evt("touchstart", [touch(sx, sy)]));
      el.dispatchEvent(evt("touchmove",  [touch(sx + 40, sy)]));
      el.dispatchEvent(evt("touchmove",  [touch(ex, ey)]));
      el.dispatchEvent(evt("touchend",   [touch(ex, ey)]));
    }, { sel: ".article-row", dx: 150 });

    await expect(firstRow).toHaveAttribute("data-starred", "true");
  });

  test("swipe left marks the article read", async ({ page }) => {
    await page.goto("/");
    const firstRow = page.locator(".article-row").first();
    await firstRow.waitFor();
    await page.evaluate(({ sel }) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      const sx = b.right - 20;
      const sy = b.top + b.height / 2;
      const ex = sx - 150;
      const ey = sy;
      const touch = (x, y) => new Touch({
        identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
      });
      const evt = (type, list) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: list, targetTouches: list, changedTouches: list,
      });
      el.dispatchEvent(evt("touchstart", [touch(sx, sy)]));
      el.dispatchEvent(evt("touchmove",  [touch(sx - 40, sy)]));
      el.dispatchEvent(evt("touchmove",  [touch(ex, ey)]));
      el.dispatchEvent(evt("touchend",   [touch(ex, ey)]));
    }, { sel: ".article-row" });

    await expect(firstRow).toHaveAttribute("data-read", "true");
  });

  test("vertical drag does not trigger swipe action", async ({ page }) => {
    await page.goto("/");
    const firstRow = page.locator(".article-row").first();
    await firstRow.waitFor();
    const starredBefore = await firstRow.getAttribute("data-starred");
    const readBefore = await firstRow.getAttribute("data-read");

    await page.evaluate(({ sel }) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      const sx = b.left + b.width / 2;
      const sy = b.top + 5;
      const touch = (x, y) => new Touch({
        identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
      });
      const evt = (type, list) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: list, targetTouches: list, changedTouches: list,
      });
      el.dispatchEvent(evt("touchstart", [touch(sx, sy)]));
      el.dispatchEvent(evt("touchmove",  [touch(sx, sy + 100)]));
      el.dispatchEvent(evt("touchend",   [touch(sx, sy + 100)]));
    }, { sel: ".article-row" });

    await expect(firstRow).toHaveAttribute("data-starred", starredBefore || "false");
    await expect(firstRow).toHaveAttribute("data-read", readBefore || "false");
  });
});
