// ─── Transport ───────────────────────────────────────────────────────────────
// One function talks to the model: `stream()`. It resolves where to send the
// request, opens an SSE stream, assembles the content blocks as they arrive,
// and reports partial text to the caller so speech can begin before the
// sentence is finished.
//
// Routing, in order:
//   1. A key in this browser  → api.anthropic.com direct. Works in dev and in
//      production, needs nothing deployed. The key never leaves localStorage.
//   2. No key                 → /.netlify/functions/claude, the serverless
//      proxy that holds ANTHROPIC_API_KEY server-side.
// If neither is available the caller gets a typed error it can render as a
// state with a fix attached, not a dead-end banner.

export const MODELS = [
  { key: "haiku", id: "claude-haiku-4-5", label: "Haiku", blurb: "Fastest. Best for a running conversation." },
  { key: "sonnet", id: "claude-sonnet-5", label: "Sonnet", blurb: "The daily driver — fast, and it plans well." },
  { key: "opus", id: "claude-opus-5", label: "Opus", blurb: "Deepest reasoning. Reach for it on hard calls." },
];

export const modelId = (key) => (MODELS.find((m) => m.key === key) || MODELS[1]).id;

// $ per million tokens. These drive the spend *estimate* on Settings only —
// nothing in the app depends on them being exact. One place to correct.
export const RATES = {
  haiku: { in: 1, out: 5 },
  sonnet: { in: 3, out: 15 },
  opus: { in: 5, out: 25 },
};

export function estimateCost(modelKey, inTok, outTok) {
  const r = RATES[modelKey] || RATES.sonnet;
  return (inTok / 1e6) * r.in + (outTok / 1e6) * r.out;
}

export const PROXY_URL = "/.netlify/functions/claude";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

export class TransportError extends Error {
  constructor(message, { kind = "unknown", status = 0, retryable = false } = {}) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;      // "nokey" | "auth" | "rate" | "overloaded" | "network" | "badrequest" | "unknown"
    this.status = status;
    this.retryable = retryable;
  }
}

function classify(status, message = "") {
  const m = message.toLowerCase();
  if (status === 401 || status === 403 || m.includes("api key") || m.includes("authentication")) {
    return { kind: "auth", retryable: false };
  }
  if (status === 429) return { kind: "rate", retryable: true };
  if (status === 529 || status === 503 || m.includes("overloaded")) return { kind: "overloaded", retryable: true };
  if (status >= 500) return { kind: "server", retryable: true };
  if (status === 400) return { kind: "badrequest", retryable: false };
  return { kind: "unknown", retryable: false };
}

/** A short, human sentence for each failure — shown next to a working retry. */
export function explain(err) {
  if (!(err instanceof TransportError)) return err?.message || "Something went wrong.";
  switch (err.kind) {
    case "nokey": return "SYNC needs an Anthropic API key before it can do anything. Add one in Settings.";
    case "auth": return "That API key was rejected. Check it in Settings — keys start with sk-ant-.";
    case "rate": return "Rate limited by the API. Give it a few seconds.";
    case "overloaded": return "The model is overloaded right now. Worth another try.";
    case "server": return "The API had a server error. Not your side.";
    case "network": return "Couldn't reach the API. Check the connection.";
    case "badrequest": return err.message || "The request was rejected.";
    default: return err.message || "Something went wrong.";
  }
}

/* ── SSE line parsing ──────────────────────────────────────────────────────── */
// Anthropic sends `event: <name>` / `data: <json>` pairs separated by blank
// lines. Chunk boundaries land anywhere, so the buffer is carried across reads.
// Exported for scripts/stream-smoke.mjs — the assembler is the one piece of
// this file that can be tested without a network, and it is also the piece
// most likely to break silently.
export function* parseSSE(buffer) {
  let idx;
  while ((idx = buffer.value.indexOf("\n\n")) !== -1) {
    const raw = buffer.value.slice(0, idx);
    buffer.value = buffer.value.slice(idx + 2);
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data || data === "[DONE]") continue;
    try { yield JSON.parse(data); } catch { /* a partial frame; the API doesn't send them, but never throw on one */ }
  }
}

/* ── block assembly ────────────────────────────────────────────────────────── */
// Turns the delta stream back into the `content` array the Messages API expects
// to receive on the next turn. Every block type survives the round trip —
// including server-side ones like web_search_tool_result, which must be echoed
// back verbatim or the model loses its own citations.
export function makeAssembler() {
  const blocks = [];
  return {
    start(index, block) {
      blocks[index] = { ...block };
      if (block.type === "text") blocks[index].text = block.text || "";
      if (block.type === "thinking") blocks[index].thinking = block.thinking || "";
      if (block.type === "tool_use" || block.type === "server_tool_use") blocks[index]._json = "";
    },
    delta(index, delta) {
      const b = blocks[index];
      if (!b) return "";
      switch (delta.type) {
        case "text_delta": b.text = (b.text || "") + delta.text; return delta.text;
        case "input_json_delta": b._json += delta.partial_json; return "";
        case "thinking_delta": b.thinking = (b.thinking || "") + delta.thinking; return "";
        case "signature_delta": b.signature = delta.signature; return "";
        default: return "";
      }
    },
    stop(index) {
      const b = blocks[index];
      if (!b) return;
      if (b._json !== undefined) {
        try { b.input = b._json ? JSON.parse(b._json) : {}; }
        catch { b.input = {}; b._parseFailed = true; }
        delete b._json;
      }
    },
    content() {
      return blocks.filter(Boolean).map(({ _json, _parseFailed, ...b }) => b);
    },
    failures() {
      return blocks.filter((b) => b && b._parseFailed).map((b) => b.name);
    },
  };
}

/* ── the call ──────────────────────────────────────────────────────────────── */
/**
 * @param {object}   o
 * @param {string}   o.system         system prompt
 * @param {Array}    o.messages       Messages API message list
 * @param {Array}    o.tools          tool definitions (client + server)
 * @param {string}   o.modelKey       "haiku" | "sonnet" | "opus"
 * @param {number}   o.maxTokens
 * @param {string}   o.apiKey         when present, go direct
 * @param {function} o.onText         (chunk, fullText) => void, called as text streams
 * @param {function} o.onToolStart    (name) => void, called when a tool block opens
 * @param {AbortSignal} o.signal
 * @returns {Promise<{content: Array, stopReason: string, usage: object}>}
 */
export async function stream({
  system, messages, tools = [], modelKey = "sonnet", maxTokens = 2048,
  apiKey = "", onText, onToolStart, signal,
}) {
  const direct = !!apiKey;
  const url = direct ? DIRECT_URL : PROXY_URL;

  const headers = { "content-type": "application/json" };
  if (direct) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    // Anthropic requires this header to opt in to browser-origin requests.
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }

  const body = { model: modelId(modelKey), max_tokens: maxTokens, messages, stream: true };
  if (system) body.system = system;
  if (tools.length) body.tools = tools;

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new TransportError("Network request failed", { kind: "network", retryable: true });
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.message || detail;
    } catch { /* non-JSON error body; the status is the whole story */ }
    // The proxy is only "missing" if we chose it because there was no key.
    if (!direct && (res.status === 404 || res.status === 405)) {
      throw new TransportError("No API key set, and no proxy is deployed at " + PROXY_URL, { kind: "nokey", status: res.status });
    }
    const c = classify(res.status, detail);
    throw new TransportError(detail, { ...c, status: res.status });
  }

  const asm = makeAssembler();
  let stopReason = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let full = "";

  // A proxy that buffers the stream hands back plain JSON. Handle that shape
  // rather than failing — the turn still completes, it just arrives at once.
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("event-stream") || !res.body) {
    const j = await res.json();
    if (j?.error) throw new TransportError(j.error.message || "Request failed", classify(200, j.error.message || ""));
    const content = j.content || [];
    const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (text && onText) onText(text, text);
    return { content, stopReason: j.stop_reason || "end_turn", usage: j.usage || usage };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const buffer = { value: "" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer.value += decoder.decode(value, { stream: true });
    for (const ev of parseSSE(buffer)) {
      switch (ev.type) {
        case "message_start":
          usage = { ...usage, ...(ev.message?.usage || {}) };
          break;
        case "content_block_start":
          asm.start(ev.index, ev.content_block);
          if (ev.content_block?.type === "tool_use") onToolStart?.(ev.content_block.name);
          if (ev.content_block?.type === "server_tool_use") onToolStart?.(ev.content_block.name || "web_search");
          break;
        case "content_block_delta": {
          const chunk = asm.delta(ev.index, ev.delta || {});
          if (chunk) { full += chunk; onText?.(chunk, full); }
          break;
        }
        case "content_block_stop":
          asm.stop(ev.index);
          break;
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.usage) usage = { ...usage, ...ev.usage };
          break;
        case "error":
          throw new TransportError(ev.error?.message || "Stream error", classify(500, ev.error?.message || ""));
        default:
          break;
      }
    }
  }

  return { content: asm.content(), stopReason: stopReason || "end_turn", usage, malformedTools: asm.failures() };
}
