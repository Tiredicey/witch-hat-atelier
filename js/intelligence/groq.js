export const GROQ_ID = "groq";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_DEFAULT_MODEL = "llama-3.1-70b-versatile";
export const GROQ_HOSTNAME = "api.groq.com";
export const GROQ_TOS_URL = "https://groq.com/terms-of-use/";
export const GROQ_PRICING_URL = "https://groq.com/pricing/";

const SYSTEM_PROMPT =
  "You summarise news and blog articles for an RSS reader. " +
  "Return three to five concise bullet points capturing the article's core claims and the source's framing. " +
  "Do not invent facts not in the source. Do not add a preamble or closing line.";

function buildUserMessage(article) {
  const title = (article && article.title) || "(untitled)";
  const source = (article && (article.source || article.feed)) || "(unknown source)";
  const body = (article && (article.body || article.summary || "")).toString();
  return `Title: ${title}\nSource: ${source}\n\n${body}`.trim();
}

function extractContent(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const msg = choice && choice.message ? choice.message : null;
  const content = msg && typeof msg.content === "string" ? msg.content.trim() : "";
  return content;
}

export async function summariseWithGroq({ apiKey, article, baseUrl, model, signal, fetchImpl }) {
  if (!apiKey) throw new Error("Missing Groq API key.");
  if (!article) throw new Error("No article supplied.");
  const url = (baseUrl || GROQ_BASE_URL).replace(/\/+$/, "") + "/chat/completions";
  const f = fetchImpl || ((u, init) => fetch(u, init));
  const res = await f(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || GROQ_DEFAULT_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildUserMessage(article) },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Groq returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    err.status = res.status;
    throw err;
  }
  const payload = await res.json();
  const summary = extractContent(payload);
  if (!summary) throw new Error("Groq returned an empty summary.");
  return { summary, model: payload.model || model || GROQ_DEFAULT_MODEL, hostname: GROQ_HOSTNAME };
}
