// The transport turns a byte stream back into the exact `content` array the
// Messages API expects to receive on the next turn. If block assembly is wrong,
// a turn either loses its tool call or loses its citations — both silently.
// This exercises it against a synthetic stream, with chunk boundaries in the
// worst possible places.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const {
  parseSSE, makeAssembler, stream, MODELS, modelId, estimateCost, explain, TransportError,
} = await import("../src/agent/transport.js");

/* ── the model registry ────────────────────────────────────────────────────── */
eq("three models offered", MODELS.length, 3);
eq("sonnet is the default fallback", modelId("nonsense"), "claude-sonnet-5");
eq("haiku id", modelId("haiku"), "claude-haiku-4-5");
eq("opus id", modelId("opus"), "claude-opus-5");
check("cost estimate is positive", estimateCost("sonnet", 1e6, 1e6) > 0);
eq("cost of nothing is nothing", estimateCost("sonnet", 0, 0), 0);

/* ── every failure has a sentence a person can act on ──────────────────────── */
for (const kind of ["nokey", "auth", "rate", "overloaded", "server", "network", "badrequest"]) {
  const msg = explain(new TransportError("the raw detail from the API", { kind }));
  check(`${kind} explains itself`, typeof msg === "string" && msg.length > 10);
}

/* ── SSE framing ───────────────────────────────────────────────────────────── */
const buf = { value: "event: a\ndata: {\"type\":\"one\"}\n\nevent: b\ndata: {\"type\":\"two\"}\n\ndata: {\"type\":\"par" };
const events = [...parseSSE(buf)];
eq("two whole frames parsed", events.map((e) => e.type), ["one", "two"]);
eq("the partial frame stayed in the buffer", buf.value, "data: {\"type\":\"par");

// A frame that arrives split across reads must survive being reassembled.
buf.value += "tial\"}\n\n";
eq("the split frame completes", [...parseSSE(buf)].map((e) => e.type), ["partial"]);

// Malformed JSON must never throw — it would take the whole turn down.
const bad = { value: "data: {not json}\n\ndata: {\"type\":\"fine\"}\n\n" };
eq("malformed frames are skipped, not thrown", [...parseSSE(bad)].map((e) => e.type), ["fine"]);

/* ── block assembly ────────────────────────────────────────────────────────── */
const asm = makeAssembler();
asm.start(0, { type: "text", text: "" });
asm.delta(0, { type: "text_delta", text: "Booked. " });
asm.delta(0, { type: "text_delta", text: "Two till four." });
asm.stop(0);

asm.start(1, { type: "tool_use", id: "tu_1", name: "schedule_block", input: {} });
// Tool arguments arrive as JSON fragments that are individually invalid.
asm.delta(1, { type: "input_json_delta", partial_json: '{"title":"Cl' });
asm.delta(1, { type: "input_json_delta", partial_json: 'ient call","st' });
asm.delta(1, { type: "input_json_delta", partial_json: 'art":"14:00"}' });
asm.stop(1);

asm.start(2, { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://example.com", title: "A source" }] });
asm.stop(2);

const content = asm.content();
eq("three blocks assembled", content.length, 3);
eq("text was concatenated", content[0].text, "Booked. Two till four.");
eq("tool input parsed from fragments", content[1].input, { title: "Client call", start: "14:00" });
eq("the tool id survived", content[1].id, "tu_1");
eq("the server-tool block survived verbatim", content[2].content[0].url, "https://example.com");
check("internal scratch fields are stripped", !("_json" in content[1]));
eq("nothing was flagged malformed", asm.failures(), []);

// Truncated tool JSON must degrade to an empty object and be reported, not
// crash the turn.
const broken = makeAssembler();
broken.start(0, { type: "tool_use", id: "tu_2", name: "add_tasks", input: {} });
broken.delta(0, { type: "input_json_delta", partial_json: '{"tasks":[{"tit' });
broken.stop(0);
eq("truncated tool input becomes an empty object", broken.content()[0].input, {});
eq("the failure is reported", broken.failures(), ["add_tasks"]);

// Thinking blocks pass through with their signature intact.
const thinking = makeAssembler();
thinking.start(0, { type: "thinking", thinking: "" });
thinking.delta(0, { type: "thinking_delta", thinking: "weighing it" });
thinking.delta(0, { type: "signature_delta", signature: "sig123" });
thinking.stop(0);
eq("thinking text assembled", thinking.content()[0].thinking, "weighing it");
eq("thinking signature kept", thinking.content()[0].signature, "sig123");

// A delta for a block that never opened must be ignored rather than throw.
const orphan = makeAssembler();
eq("an orphan delta is ignored", orphan.delta(9, { type: "text_delta", text: "x" }), "");
eq("an orphan stop is ignored", orphan.stop(9), undefined);

/* ── the whole call, against a fake API ────────────────────────────────────── */
const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":120}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done. "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Two till four."}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join("");

function sseResponse(text, { chunkSize = 7 } = {}) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) { controller.close(); return; }
      // Deliberately tiny chunks: every frame is split, most mid-token.
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let seenRequest = null;
globalThis.fetch = async (url, init) => {
  seenRequest = { url, init };
  return sseResponse(SSE);
};

const chunks = [];
const result = await stream({
  system: "sys",
  messages: [{ role: "user", content: "book it" }],
  tools: [{ name: "schedule_block", description: "d", input_schema: { type: "object" } }],
  modelKey: "sonnet",
  apiKey: "sk-ant-test",
  onText: (chunk) => chunks.push(chunk),
});

eq("the streamed text is complete", result.content[0].text, "Done. Two till four.");
eq("stop reason captured", result.stopReason, "end_turn");
eq("input tokens captured", result.usage.input_tokens, 120);
eq("output tokens captured", result.usage.output_tokens, 42);
eq("text arrived incrementally", chunks.join(""), "Done. Two till four.");
check("more than one chunk was delivered", chunks.length >= 2);

check("a local key routes direct to Anthropic", seenRequest.url.startsWith("https://api.anthropic.com"));
eq("the browser-access header is set", seenRequest.init.headers["anthropic-dangerous-direct-browser-access"], "true");
eq("the key is sent", seenRequest.init.headers["x-api-key"], "sk-ant-test");
const sent = JSON.parse(seenRequest.init.body);
eq("streaming was requested", sent.stream, true);
eq("the model id was resolved", sent.model, "claude-sonnet-5");
eq("tools were sent", sent.tools.length, 1);

/* ── no key routes to the proxy ────────────────────────────────────────────── */
globalThis.fetch = async (url, init) => { seenRequest = { url, init }; return sseResponse(SSE); };
await stream({ messages: [{ role: "user", content: "x" }], apiKey: "" });
eq("no key routes to the proxy", seenRequest.url, "/.netlify/functions/claude");
check("the proxy request carries no key header", !("x-api-key" in seenRequest.init.headers));

/* ── a buffering proxy that returns plain JSON still works ─────────────────── */
globalThis.fetch = async () =>
  new Response(JSON.stringify({ content: [{ type: "text", text: "buffered reply" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
const buffered = await stream({ messages: [{ role: "user", content: "x" }], apiKey: "k" });
eq("a non-streamed response is handled", buffered.content[0].text, "buffered reply");
eq("its stop reason is read", buffered.stopReason, "end_turn");

/* ── errors are typed, not swallowed ───────────────────────────────────────── */
globalThis.fetch = async () =>
  new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
let caught = null;
try { await stream({ messages: [], apiKey: "bad" }); } catch (e) { caught = e; }
eq("a 401 is classified as auth", caught?.kind, "auth");
eq("an auth error is not retryable", caught.retryable, false);
check("the auth explanation points at Settings", /Settings/.test(explain(caught)));

globalThis.fetch = async () => new Response("{}", { status: 429, headers: { "content-type": "application/json" } });
caught = null;
try { await stream({ messages: [], apiKey: "k" }); } catch (e) { caught = e; }
eq("a 429 is classified as rate", caught?.kind, "rate");
eq("a rate limit is retryable", caught.retryable, true);

// A missing proxy, when we chose the proxy because there was no key, is a
// "you need a key" problem — not a mysterious 404.
globalThis.fetch = async () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
caught = null;
try { await stream({ messages: [], apiKey: "" }); } catch (e) { caught = e; }
eq("a missing proxy with no key reads as nokey", caught?.kind, "nokey");

globalThis.fetch = async () => { throw new Error("boom"); };
caught = null;
try { await stream({ messages: [], apiKey: "k" }); } catch (e) { caught = e; }
eq("a dead connection is classified as network", caught?.kind, "network");

report("stream");
