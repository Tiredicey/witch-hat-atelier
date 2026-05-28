import { LocalAdapter } from "../storage.js";
import { WebDAVAdapter } from "./webdav.js";
import { DropboxAdapter } from "./dropbox.js";
import { S3Adapter } from "./s3.js";
import { GitHubAdapter } from "./github.js";
import { TelegramAdapter } from "./telegram.js";
import { ChainAdapter } from "./chain.js";

export const ADAPTER_KINDS = ["local", "github", "telegram", "webdav", "dropbox", "s3"];

export const ADAPTER_LABELS = {
  local: "Local (browser only)",
  github: "GitHub (private repo)",
  telegram: "Telegram (bot, unlimited)",
  webdav: "WebDAV (Nextcloud, generic)",
  dropbox: "Dropbox",
  s3: "S3-compatible (R2, B2, Wasabi)",
};

const SETTINGS_KEY = "coda/settings";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { kind: "local" };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !ADAPTER_KINDS.includes(parsed.kind)) {
      return { kind: "local" };
    }
    return parsed;
  } catch {
    return { kind: "local" };
  }
}

export function saveSettings(cfg) {
  if (!cfg || !ADAPTER_KINDS.includes(cfg.kind)) {
    throw new Error("invalid settings");
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
}

export function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

function buildSingleAdapter(cfg, prefix) {
  const kind = cfg?.kind || "local";
  switch (kind) {
    case "local":
      return new LocalAdapter(prefix);
    case "webdav":
      return new WebDAVAdapter({
        url: cfg.url,
        username: cfg.username,
        password: cfg.password,
        prefix,
      });
    case "dropbox":
      return new DropboxAdapter({
        token: cfg.token,
        path: cfg.path || "/Apps/CODA",
        prefix,
      });
    case "s3":
      return new S3Adapter({
        endpoint: cfg.endpoint,
        region: cfg.region || "auto",
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        bucket: cfg.bucket,
        prefix,
      });
    case "github":
      return new GitHubAdapter({
        token: cfg.token,
        owner: cfg.owner,
        repo: cfg.repo,
        branch: cfg.branch || "main",
        prefix,
      });
    case "telegram":
      return new TelegramAdapter({
        token: cfg.token,
        chatId: cfg.chatId,
        prefix,
      });
    default:
      throw new Error(`unknown adapter kind: ${kind}`);
  }
}

export function makeAdapter(cfg, prefix = "coda/v1") {
  if (cfg && cfg.kind === "chain" && Array.isArray(cfg.adapters) && cfg.adapters.length) {
    const built = cfg.adapters.map(sub => buildSingleAdapter(sub, prefix));
    const labels = cfg.adapters.map(sub => ADAPTER_LABELS[sub.kind] || sub.kind);
    return new ChainAdapter({ chain: built, labels });
  }
  const primary = buildSingleAdapter(cfg, prefix);
  if (cfg && cfg.mirrorLocal && cfg.kind !== "local") {
    const local = new LocalAdapter(prefix);
    const label = ADAPTER_LABELS[cfg.kind] || cfg.kind;
    return new ChainAdapter({ chain: [primary, local], labels: [label, "Local (mirror)"] });
  }
  return primary;
}
