# Intelligence providers

This page is required by ROADMAP §17.5.3 and §17.11. Every time a §17.3 / §17.7 / §17.8 / §17.9 / §17.10 surface is added in a PR, a row goes in the table that matches its section, recording free-tier terms, prompt-logging policy, and the canonical TOS link **as of that PR's commit date**.

The roadmap's own restatement of free-tier terms is the source of truth that landed at commit time. Free tiers, rate limits, prompt-retention policies, and TOS wording change. Re-check the provider's canonical TOS before pasting a key. CODA never bundles or proxies a provider key — every cell below describes a destination the user supplies in Settings.

## Status

PR §17.11:1 shipped the Settings panel + provider registry scaffolding. PR §17.11:2 wired the first provider (Groq) end-to-end. PR §17.11:3 adds Cerebras alongside Groq behind a shared OpenAI-compatible client. Subsequent §17.11 PRs add the remaining rows below. Each section's "Added in PR" column links to the PR that landed that row.

## §17.3 / §17.7 — On-device and BYO-endpoint surfaces

| Surface | Mode | What the user supplies | Free-tier terms at PR-merge date | Prompt-logging / telemetry posture | Canonical TOS link | Added in PR |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |

## §17.8 — OpenAI-compatible BYO LLM providers

| Provider | `baseUrl` | Default model | Free tier at PR-merge date | Prompt-logging note at PR-merge date | Canonical TOS link | Added in PR |
|---|---|---|---|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Free tier with daily request/token caps and ~500 tok/s throughput at the entry date; current limits are listed on the Groq pricing page. | Free-tier prompts may be retained for evaluation per Groq's TOS. Re-check before pasting a key. | <https://groq.com/terms-of-use/> (pricing: <https://groq.com/pricing/>) | PR §17.11:2 |
| Cerebras | `https://api.cerebras.ai/v1` | `gpt-oss-120b` | Free Cerebras Cloud Inference tier with per-minute and daily caps at the entry date; current limits are listed in the Cerebras inference docs. | Free-tier usage is governed by the Cerebras Terms of Service which covers Cerebras Cloud Inference. Re-check before pasting a key. | <https://www.cerebras.ai/terms-of-service> (docs: <https://inference-docs.cerebras.ai/introduction>) | PR §17.11:3 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | Gemini API free tier, no card; per-minute and per-day request caps at the entry date. Current limits are listed on the Gemini API pricing page. | On the free tier Google may use prompts to improve its products per the Gemini API terms; the paid tier does not. Re-check before pasting a key. | <https://ai.google.dev/gemini-api/terms> (pricing: <https://ai.google.dev/gemini-api/docs/pricing>) | PR §17.11:4 |

## §17.9 — Rotating-credit providers

These rotate sign-up credit ($5–$25 promotional) rather than offering a permanent free tier. They are off by default in the Settings dropdown until the user enables "Show rotating-credit providers" per §17.9.2.

| Provider | `baseUrl` | Default model | Credit at PR-merge date | Prompt-logging note at PR-merge date | Canonical TOS link | Added in PR |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |

## §17.10 — Self-hosted single-deployment override (owner-authorised 2026-05-29)

Routes that the canonical hosted CODA Worker explicitly refuses. Only self-hosted single-deployment installs enable these, gated by both an environment flag on the Worker **and** the Settings checkbox.

| Surface | Worker env flag | Settings checkbox | Free-tier terms at PR-merge date | TOS link | Added in PR |
|---|---|---|---|---|---|
| _none yet_ | | | | | |

## Trust posture (binding, restated from §17.1)

1. CODA ships zero credentials for any provider in this document.
2. Every surface above is dark until the user enables the master checkbox in Settings and then the surface's own checkbox.
3. Article text only leaves the device on an explicit user gesture, and the first such request per session shows a one-line disclosure naming the destination hostname.
4. A surface that disappears from this document also disappears from the Settings panel in the same PR — checkboxes are not orphaned in the UI.

## §18.3 rung 6 — Voice I/O (Web Speech API)

The voice rung uses the browser's built-in Web Speech API. No product credential, no paid provider, two on-device-leaning surfaces gated behind their own Settings checkboxes (off by default, under the master intelligence checkbox).

| Surface | API | Where it runs | Privacy note at entry date | Added in PR |
|---|---|---|---|---|
| Read article aloud | `speechSynthesis` + `SpeechSynthesisUtterance` | On-device. Uses the voices installed in the operating system / browser. Nothing leaves the device. | No network request. Honors `prefers-reduced-motion` and dark/light per §6/§7 by inheriting the shell. | §18.3 rung 6 |
| Voice commands (microphone) | `SpeechRecognition` / `webkitSpeechRecognition` | Browser-dependent. Chrome and Edge transcribe captured audio on the browser maker's servers; some other engines run on-device. | A one-time-per-session disclosure states that audio may be sent to the browser maker before the microphone starts. Recognised input is restricted to a fixed command allowlist (summarise · read · stop); free-form text is rejected, not executed. CODA never receives or stores the audio. | §18.3 rung 6 |

Honest caveat per §18.5: `SpeechRecognition` is **not** guaranteed on-device. The deliberate on-device STT path stays `whisper.cpp` (§17.7, issue #62) and remains a follow-up. Free-form conversational Q&A is rung 2 and is not shipped by this rung.

## §18.3 rung 2 — Ask about the article (grounded Q&A)

A reader-pane question box that answers from the open article only. It reuses the §17.8 providers the user already enabled and keyed (Groq, Cerebras, Gemini) with the same ordered failover; no new key field, no new host. One independent Settings kill switch (`#intelAskEnable`, off by default) under the master intelligence checkbox.

Untrusted-input isolation (§18.2.6) is implemented, not just claimed: the article is sent in a dedicated `user` message wrapped between `<<<ARTICLE>>>` and `<<<END ARTICLE>>>`, and the system prompt instructs the model to treat that block as quoted data and never follow instructions inside it. Conversation history is memory-only and is cleared when the open article changes; nothing is written to a storage adapter.

Scope honesty: this is text Q&A over the already-open article only. It does not fetch live web pages (rung 3, blocked on §18.2.6 design for arbitrary web text) and does not take actions (rung 5). Free-form voice Q&A becomes possible now that rung 2 exists, but is left as a follow-up that routes the §18.3 rung 6 microphone into this surface.

### Voice dictation into Q&A (§18.3 rung 6 → rung 2)

When both the microphone (rung 6) and the Ask surface (rung 2) are enabled, a spoken utterance that is not one of the fixed commands (summarise · read · stop) is transcribed into the Ask question box rather than rejected. It is filled in for review and the user presses Ask to send, so the §17.1.2 disclosure and §18.2.6 isolation of rung 2 still apply and nothing is sent on a misheard phrase. With Q&A disabled, non-command speech is rejected per the original §18.2.10 allowlist.

## §18.3 rung 4 — Brief my unread (cross-article briefing)

A list-pane control that summarises the unread articles in the current shelf into one briefing, grouped by feed or theme. Reuses the §17.8 providers and ordered failover; one independent Settings kill switch (`#intelBriefingEnable`, off by default). One request sends up to 20 unread titles and ~500-character excerpts from the current shelf to the provider, after the §17.1.2 disclosure (which names the count and host). Each item is wrapped between `<<<ARTICLES>>>` and `<<<END ARTICLES>>>` and the system prompt forbids following instructions inside that block (§18.2.6). The 20-item / per-item-snippet caps are the token-budget control called for in §18.3 rung 4.
