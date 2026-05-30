import { chatComplete } from "./openai-compatible.js";

export const GROQ_PROVIDER = Object.freeze({
  id: "groq",
  surfaceId: "groq-summarise",
  label: "Groq",
  hostname: "api.groq.com",
  baseUrl: "https://api.groq.com/openai/v1",
  defaultModel: "llama-3.3-70b-versatile",
  tosUrl: "https://groq.com/terms-of-use/",
  pricingUrl: "https://groq.com/pricing/",
  keyPlaceholder: "gsk_…",
  hintHtml:
    "Free-tier prompts may be retained for evaluation per Groq's TOS &mdash; check " +
    "<a href=\"https://groq.com/pricing/\" target=\"_blank\" rel=\"noopener noreferrer\">groq.com/pricing</a> before pasting a key.",
});

export const GROQ_ID = GROQ_PROVIDER.id;
export const GROQ_BASE_URL = GROQ_PROVIDER.baseUrl;
export const GROQ_DEFAULT_MODEL = GROQ_PROVIDER.defaultModel;
export const GROQ_HOSTNAME = GROQ_PROVIDER.hostname;
export const GROQ_TOS_URL = GROQ_PROVIDER.tosUrl;
export const GROQ_PRICING_URL = GROQ_PROVIDER.pricingUrl;

export function summariseWithGroq(opts) {
  return chatComplete({ provider: GROQ_PROVIDER, ...opts });
}
