import { chatComplete } from "./openai-compatible.js";

export const GEMINI_PROVIDER = Object.freeze({
  id: "gemini",
  surfaceId: "gemini-summarise",
  label: "Google Gemini",
  hostname: "generativelanguage.googleapis.com",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  defaultModel: "gemini-2.5-flash",
  tosUrl: "https://ai.google.dev/gemini-api/terms",
  pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  keyPlaceholder: "AIza\u2026",
  hintHtml:
    "On the Gemini API free tier, Google may use your prompts to improve its products per the Gemini API terms &mdash; check " +
    "<a href=\"https://ai.google.dev/gemini-api/terms\" target=\"_blank\" rel=\"noopener noreferrer\">ai.google.dev/gemini-api/terms</a> before pasting a key.",
});

export const GEMINI_ID = GEMINI_PROVIDER.id;
export const GEMINI_BASE_URL = GEMINI_PROVIDER.baseUrl;
export const GEMINI_DEFAULT_MODEL = GEMINI_PROVIDER.defaultModel;
export const GEMINI_HOSTNAME = GEMINI_PROVIDER.hostname;
export const GEMINI_TOS_URL = GEMINI_PROVIDER.tosUrl;
export const GEMINI_PRICING_URL = GEMINI_PROVIDER.pricingUrl;

export function summariseWithGemini(opts) {
  return chatComplete({ provider: GEMINI_PROVIDER, ...opts });
}
