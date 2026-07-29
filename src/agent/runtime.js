// ─── The turn ────────────────────────────────────────────────────────────────
// One user utterance in, one completed turn out. Between those two points the
// model may call tools as many times as it needs; each call runs against the
// real store, so by the time SYNC finishes speaking, the day has already
// changed. Nothing here is a simulation of doing the work.
//
// The loop, precisely:
//   1. append the utterance to history
//   2. stream a model response, reporting text as it arrives so speech can
//      start on the first sentence rather than the last
//   3. if it asked for tools, run them, append the results, go back to 2
//   4. stop on end_turn, on the step ceiling, or on abort

import { stream, estimateCost, TransportError, explain } from "./transport.js";
import { toolDefs, runTool, toolVerb, isServerTool, isReadonlyTool } from "./tools.js";
import { buildSystem } from "./system.js";
import {
  getState, addTurn, patchTurn, setHistory, addUsage,
} from "../data/store.js";
import { id } from "../lib/id.js";

// A turn that needs more than this many round trips has lost the plot; stop and
// say so rather than burning the user's money in a loop.
const MAX_STEPS = 8;

/** Text blocks only — what actually gets spoken and shown. */
const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

/**
 * Trim history to fit a rough token budget, oldest first, without ever
 * orphaning a tool_result from the tool_use it answers — the API rejects that
 * pairing, and it is the single easiest way to break a long session.
 */
function trimHistory(history, budgetChars = 48000) {
  let total = 0;
  const keep = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const size = JSON.stringify(history[i]).length;
    if (total + size > budgetChars && keep.length) break;
    total += size;
    keep.unshift(history[i]);
  }
  // A user message carrying tool_result blocks must be preceded by the
  // assistant turn that requested them. If the trim landed on one, drop it.
  while (keep.length && keep[0].role === "user" && Array.isArray(keep[0].content) && keep[0].content.some((b) => b.type === "tool_result")) {
    keep.shift();
  }
  return keep;
}

/**
 * Run a full turn.
 *
 * @param {object}   o
 * @param {string}   o.text        what the user said
 * @param {function} o.onDelta     (chunk, fullTextSoFar) => void
 * @param {function} o.onSpeakable (sentence) => void — emitted as soon as a
 *                                 sentence is complete, so TTS can start early
 * @param {function} o.onAct       (act) => void — an action started or finished
 * @param {AbortSignal} o.signal
 * @returns {Promise<{turnId: string, text: string, acts: Array, error?: string}>}
 */
export async function runTurn({ text, onDelta, onSpeakable, onAct, signal }) {
  const utterance = String(text || "").trim();
  if (!utterance) return null;

  addTurn({ role: "user", text: utterance });
  const turn = addTurn({ role: "sync", text: "", acts: [], status: "streaming" });

  const s0 = getState();
  const settings = s0.settings;
  const messages = [...trimHistory(s0.history), { role: "user", content: utterance }];
  const tools = toolDefs({ webSearch: settings.webSearch });

  const acts = [];
  let spoken = 0;          // how much of the text has been handed to speech
  let assembled = "";      // everything the model has said this turn
  let allowWebSearch = settings.webSearch;

  const pushAct = (act) => {
    acts.push(act);
    patchTurn(turn.id, (t) => ({ acts: [...t.acts, act] }));
    onAct?.(act);
  };
  const settleAct = (actId, patch) => {
    const i = acts.findIndex((a) => a.id === actId);
    if (i < 0) return;
    acts[i] = { ...acts[i], ...patch };
    patchTurn(turn.id, (t) => ({ acts: t.acts.map((a) => (a.id === actId ? { ...a, ...patch } : a)) }));
    onAct?.(acts[i]);
  };

  // Sentence boundaries, cheaply: emit whenever the text so far ends a
  // sentence. Abbreviations occasionally split early — a half-beat of extra
  // pause is a far better failure than waiting for the whole paragraph.
  const flushSpeakable = (final = false) => {
    if (!onSpeakable) return;
    const pending = assembled.slice(spoken);
    if (!pending) return;
    if (final) { spoken = assembled.length; onSpeakable(pending); return; }
    const m = /^[\s\S]*?[.!?…](?:["')\]]+)?(?=\s)/.exec(pending);
    if (m && m[0].trim().length > 12) {
      spoken += m[0].length;
      onSpeakable(m[0]);
    }
  };

  const onText = (chunk, full) => {
    assembled = full;
    patchTurn(turn.id, { text: full });
    onDelta?.(chunk, full);
    flushSpeakable(false);
  };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      let res;
      try {
        res = await stream({
          system: buildSystem(getState()),
          messages,
          tools: allowWebSearch ? tools : tools.filter((t) => t.name !== "web_search"),
          modelKey: settings.model,
          maxTokens: 3000,
          apiKey: settings.apiKey,
          onText,
          onToolStart: () => {},
          signal,
        });
      } catch (e) {
        // A deployment where web search isn't available shouldn't take the whole
        // turn down: drop the tool and run the step again, once.
        if (allowWebSearch && e instanceof TransportError && e.kind === "badrequest" && /web.?search/i.test(e.message || "")) {
          allowWebSearch = false;
          step--;
          continue;
        }
        throw e;
      }

      const inTok = res.usage?.input_tokens || 0;
      const outTok = res.usage?.output_tokens || 0;
      addUsage({ inTok, outTok, cost: estimateCost(settings.model, inTok, outTok) });

      const calls = res.content.filter((b) => b.type === "tool_use");

      // The assistant's own turn goes into history exactly as it came back —
      // including server-tool blocks, which carry the citations for anything
      // the model found on the web.
      messages.push({ role: "assistant", content: res.content });

      if (res.stopReason !== "tool_use" || !calls.length) {
        // The model may finish a turn with a server-side search and no text at
        // all. Rather than a silent turn, nudge it once for the actual answer.
        if (!textOf(res.content) && res.content.some((b) => b.type === "web_search_tool_result") && step < MAX_STEPS - 1) {
          messages.push({ role: "user", content: "Now answer, out loud, in your own voice." });
          continue;
        }
        break;
      }

      const results = [];
      for (const call of calls) {
        if (isServerTool(call.name)) continue; // Anthropic already ran it
        const act = {
          id: id("a"),
          name: call.name,
          verb: toolVerb(call.name),
          title: toolVerb(call.name),
          detail: "",
          status: "pending",
        };
        pushAct(act);

        const out = await runTool(call.name, call.input);
        const readonly = isReadonlyTool(call.name);

        settleAct(act.id, {
          status: out.ok ? "ok" : "failed",
          title: out.summary,
          detail: out.detail || "",
          // A read files no ledger entry, so don't hand the console the id of
          // whatever unrelated action happened to be last.
          ledgerId: out.ok && !readonly ? getState().ledger[getState().ledger.length - 1]?.id : null,
          readonly,
        });

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: String(out.result),
          ...(out.ok ? {} : { is_error: true }),
        });
      }

      if (!results.length) break;
      messages.push({ role: "user", content: results });
    }

    flushSpeakable(true);
    const finalText = assembled.trim();
    patchTurn(turn.id, { text: finalText, status: "done" });
    setHistory(messages);
    return { turnId: turn.id, text: finalText, acts };
  } catch (e) {
    if (e?.name === "AbortError") {
      flushSpeakable(true);
      patchTurn(turn.id, { status: "stopped", text: assembled.trim() });
      setHistory(messages);
      return { turnId: turn.id, text: assembled.trim(), acts, stopped: true };
    }
    const msg = explain(e);
    patchTurn(turn.id, { status: "error", error: msg, errorKind: e instanceof TransportError ? e.kind : "unknown", retryable: e instanceof TransportError ? e.retryable : false });
    // Deliberately not persisted to history: a failed round trip should not
    // poison the next one with a half-finished assistant turn.
    return { turnId: turn.id, text: assembled.trim(), acts, error: msg };
  }
}
