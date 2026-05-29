import { test, expect } from "@playwright/test";

const WORKER = "https://dmz.example.test";

async function configureDmz(page, { ownerToken = "" } = {}) {
  await page.evaluate(({ worker, owner }) => {
    localStorage.setItem("coda/onboarded", "true");
    localStorage.setItem("coda/dmz/worker-config", JSON.stringify({ workerUrl: worker, enabled: true }));
    localStorage.setItem("coda/dmz/client-id", "client-aaa");
    if (owner) localStorage.setItem("coda/dmz/owner-token", owner);
  }, { worker: WORKER, owner: ownerToken });
}

function installWorkerMock(page, state) {
  return page.route(`${WORKER}/dmz/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const headers = await req.allHeaders();
    const respond = (status, body) => route.fulfill({
      status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type,x-dmz-token,x-dmz-owner,x-dmz-client",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      },
      body: JSON.stringify(body),
    });

    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-dmz-token,x-dmz-owner,x-dmz-client", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" } });

    if (path === "/dmz/health") return respond(200, { ok: true, configured: true });

    if (path === "/dmz/messages" && method === "GET") {
      return respond(200, { ok: true, notes: state.notes.slice().sort((a, b) => b.at - a.at) });
    }

    if (path === "/dmz/message" && method === "POST") {
      const body = await req.postDataJSON();
      const text = String(body.body || "");
      if (/loli|childporn/i.test(text)) return respond(451, { ok: false, error: "moderation_blocked", detail: { severity: "hard" } });
      if (/explicit|xxx|nsfw/i.test(text)) return respond(422, { ok: false, error: "moderation_blocked", detail: { severity: "nsfw" } });
      const id = `note-${state.notes.length + 1}`;
      const at = Date.now();
      const cid = headers["x-dmz-client"] || "anon";
      state.notes.push({ id, body: text, at, name: "", clientId: cid });
      state.tokens[id] = `v1.${cid}.sig-${id}`;
      return respond(200, { ok: true, id, at, deleteToken: state.tokens[id] });
    }

    if (path === "/dmz/message" && method === "DELETE") {
      const body = await req.postDataJSON();
      const id = body.id;
      const token = headers["x-dmz-token"];
      const owner = headers["x-dmz-owner"];
      const senderOk = state.tokens[id] && token === state.tokens[id];
      const ownerOk = owner && owner === state.ownerToken;
      if (!senderOk && !ownerOk) return respond(403, { ok: false, error: "forbidden" });
      state.notes = state.notes.filter(n => n.id !== id);
      delete state.tokens[id];
      return respond(200, { ok: true });
    }

    return respond(404, { ok: false, error: "not_found" });
  });
}

test.describe("DMZ shared log via Worker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  });

  test("posts a note, sees it in the list, can remove own note", async ({ page }) => {
    const state = { notes: [], tokens: {}, ownerToken: "owner-secret" };
    await installWorkerMock(page, state);
    await configureDmz(page);
    await page.reload();

    await page.locator("#enterDmzBtn").click();
    await expect(page.locator("#dmzPage")).toBeVisible();
    await page.locator("#dmzTextarea").fill("family movie night, saturday 8pm");
    await page.locator("#dmzSubmit").click();
    await expect(page.locator(".dmz-note")).toHaveCount(1);
    await expect(page.locator(".dmz-note__body")).toContainText("movie night");
    await expect(page.locator(".dmz-note__delete")).toHaveCount(1);

    await page.locator(".dmz-note__delete").click();
    await expect(page.locator(".dmz-note")).toHaveCount(0);
    await expect(page.locator(".dmz__empty")).toBeVisible();
  });

  test("cannot remove notes posted from a different device when not the owner", async ({ page }) => {
    const state = {
      notes: [{ id: "note-x", body: "from another device", at: Date.now(), name: "", clientId: "client-zzz" }],
      tokens: { "note-x": "v1.client-zzz.sig-note-x" },
      ownerToken: "owner-secret",
    };
    await installWorkerMock(page, state);
    await configureDmz(page);
    await page.reload();

    await page.locator("#enterDmzBtn").click();
    await expect(page.locator(".dmz-note")).toHaveCount(1);
    await expect(page.locator(".dmz-note__body")).toContainText("from another device");
    await expect(page.locator(".dmz-note__delete")).toHaveCount(0);
  });

  test("owner token unlocks delete on any note", async ({ page }) => {
    const state = {
      notes: [{ id: "note-y", body: "stranger danger", at: Date.now(), name: "", clientId: "client-zzz" }],
      tokens: { "note-y": "v1.client-zzz.sig-note-y" },
      ownerToken: "owner-secret",
    };
    await installWorkerMock(page, state);
    await configureDmz(page, { ownerToken: "owner-secret" });
    await page.reload();

    await page.locator("#enterDmzBtn").click();
    await expect(page.locator(".dmz-note")).toHaveCount(1);
    await expect(page.locator(".dmz-note__delete")).toHaveCount(1);

    await page.locator(".dmz-note__delete").click();
    await expect(page.locator(".dmz-note")).toHaveCount(0);
  });

  test("server rejects NSFW content and the UI surfaces a clear status", async ({ page }) => {
    const state = { notes: [], tokens: {}, ownerToken: "owner-secret" };
    await installWorkerMock(page, state);
    await configureDmz(page);
    await page.reload();

    await page.locator("#enterDmzBtn").click();
    await page.locator("#dmzTextarea").fill("explicit nsfw stuff that should be blocked");
    await page.locator("#dmzSubmit").click();
    await expect(page.locator("#dmzStatus")).toContainText(/blocked/i, { timeout: 4000 });
    await expect(page.locator(".dmz-note")).toHaveCount(0);
  });
});
