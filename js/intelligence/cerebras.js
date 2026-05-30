import { chatComplete } from "./openai-compatible.js";

export const CEREBRAS_PROVIDER = Object.freeze({
  id: "cerebras",
  surfaceId: "cerebras-summarise",
  label: "Cerebras",
  hostname: "api.cerebras.ai",
  baseUrl: "https://api.cerebras.ai/v1",
  defaultModel: "gpt-oss-120b",
  tosUrl: "https://www.cerebras.ai/terms-of-service",
  pricingUrl: "https://inference-docs.cerebras.ai/introduction",
  keyPlaceholder: "csk-…",
  hintHtml:
    "Cerebras Cloud Inference is governed by the Cerebras Terms of Service &mdash; check " +
    "<a href=\"https://www.cerebras.ai/terms-of-service\" target=\"_blank\" rel=\"noopener noreferrer\">cerebras.ai/terms-of-service</a> before pasting a key.",
});

export const CEREBRAS_ID = CEREBRAS_PROVIDER.id;
export const CEREBRAS_BASE_URL = CEREBRAS_PROVIDER.baseUrl;
export const CEREBRAS_DEFAULT_MODEL = CEREBRAS_PROVIDER.defaultModel;
export const CEREBRAS_HOSTNAME = CEREBRAS_PROVIDER.hostname;

export function summariseWithCerebras(opts) {
  return chatComplete({ provider: CEREBRAS_PROVIDER, ...opts });
}
