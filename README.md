# SYNC

**A voice-first operating layer for the workday.** You say what needs to happen; it happens. Not a chatbot with a microphone bolted on — the thing that actually books the block, moves the meeting, takes the note, and chases what's gone quiet.

Everything it does lands in a ledger with an Undo next to it. Everything it knows lives in your browser and leaves only when you export it — or when you connect it to [the Pentagon](#the-pentagon), which is off until you say otherwise.

```
"Sync, book me two hours of deep work at two."

  ✓ Scheduled Deep work
    Today · 2:00 PM–3:30 PM                              Undo

  "Booked. Two till three-thirty, and I moved the standup
   to eleven-fifteen to make room."
```

---

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
```

On first launch it asks three questions, then wants an [Anthropic API key](https://console.anthropic.com/settings/keys). The key is stored in this browser's localStorage, is never included in an export, and is sent nowhere except `api.anthropic.com`.

Voice needs a secure context. `localhost` counts; testing from a phone on your LAN does not — deploy it, or use a tunnel.

## Deploy it

The build is host-agnostic — `base` is `"./"` and nothing is hardcoded to `/`, so the same `dist/` runs at a domain root, at a project subpath, or off a file share.

**It's live at [camcarp14.github.io/sync](https://camcarp14.github.io/sync/).** `.github/workflows/deploy.yml` runs the full check suite on every push to `main` and publishes to the `gh-pages` branch only if it passes — no repo settings to configure, no third-party action, and nothing reaches the URL that didn't pass `npm run verify`.

**Netlify** is the better home if you want the serverless proxy, since Pages is static-only. Point it at this repo; `netlify.toml` already sets the SPA redirect, immutable caching for hashed assets, and a `Permissions-Policy` granting the microphone and nothing else.

```bash
npm run build          # → dist/
```

**Optionally**, deploy `netlify/functions/claude.js` and set `ANTHROPIC_API_KEY` in the site environment. Then leave the key field in Settings empty and SYNC routes through the proxy instead of holding a key client-side. The function pins the allowed model list and caps `max_tokens` — a proxy that forwards whatever it's handed is a proxy that bills you for whatever it's handed.

---

## How it works

**Ear → model → mouth**, and a state machine that stops those three talking over each other.

- **`src/voice/recognizer.js`** — `SpeechRecognition`, made to behave. Auto-restarts (the browser ends sessions constantly), holds a silence window so a pause for breath doesn't cut a sentence in half, and drops anything that matches what SYNC just said as microphone echo. Wake-word listening and one-shot push-to-talk are separate states, so a hold never leaves the mic open afterwards.
- **`src/voice/speaker.js`** — `speechSynthesis`, made reliable. Chunks under Chrome's ~15-second utterance ceiling with a `resume()` heartbeat, and strips markdown, ids and bare URLs before anything reaches the speakers.
- **`src/agent/transport.js`** — streams the Messages API and reassembles the SSE deltas into the exact `content` array the next turn has to send back, server-tool blocks and all. Reports text as it arrives so speech starts on the first sentence, not the last.
- **`src/agent/runtime.js`** — one utterance in, one completed turn out; the model calls tools in a loop against the real store until it's done.
- **`src/agent/tools.js`** — the twenty things SYNC can actually do.
- **`src/data/store.js`** — one plain object, persisted to localStorage, replaced immutably on every change.

### Why every action is undoable

Nothing in this app mutates a collection directly. Every change goes through `commit()`, which captures a before-image of exactly the collections it touched and files it with the ledger entry:

```js
commit({
  action: "schedule_block",
  title: `Scheduled ${b.title}`,
  touches: ["blocks"],                              // ← before-image taken here
  apply: (s) => ({ blocks: [...s.blocks, b] }),
});
```

Undo restores that image. That's the whole mechanism — no hand-written inverse operations, no drift between what a tool does and what its undo undoes. Which is what makes it reasonable to let something run your day.

### What it can do

| | |
|---|---|
| **Read** | `read_state` · `search_memory` |
| **The day** | `plan_day` · `schedule_block` · `move_block` · `cancel_block` · `complete_block` |
| **The queue** | `add_tasks` (bulk) · `update_task` · `add_followup` · `resolve_followup` |
| **Knowledge** | `capture_note` · `remember` · `forget` · `log_decision` · `save_draft` · `write_brief` |
| **Focus** | `start_focus` · `end_focus` |
| **You** | `update_profile` |
| **Live** | `web_search` (server-side, toggleable) |
| **Pentagon** | `pentagon_read` · `pentagon_add_event` · `pentagon_capture` |

Two rules the whole tool layer obeys, because a wrong answer here becomes a wrong *day*:

1. **Never guess an identity.** "Move the Clarify thing" when two blocks match returns both and asks — it does not pick one.
2. **Never fail silently.** A tool that can't do the thing returns a reason the model can act on in the same turn, and the console shows it in red with a retry.

### What it remembers

Durable facts (`remember`) and standing directives (`update_profile`) are loaded into the system prompt on every turn, so SYNC arrives already knowing your world. Today's schedule is *not* memory — that's what the plan is for. All of it is visible and deletable on the **Memory** page, because an assistant that remembers things you can't see or delete is one you eventually stop telling things to.

---

## The surfaces

| | |
|---|---|
| **Console** | The orb, the transcript, and an execution ledger under every reply |
| **Day** | The timeline, the now-line, focus sessions, and your open gaps |
| **Queue** | Tasks and the "waiting on someone else" list that stops things quietly dying |
| **Brief** | Morning brief, evening debrief, and every draft SYNC has written for you |
| **Memory** | Facts, directives, areas, notes, decisions, and the full action log |

**Keyboard.** `⌘K` command palette — anything it can't match becomes an instruction. `Space` (held) to talk. `Esc` to cut SYNC off mid-sentence. `⌘,` for settings.

## The design

Two rooms: **OBSIDIAN** (true black, the default) and **QUARTZ** (cool paper), following the OS unless told otherwise. Inter, self-hosted and preloaded so the first paint is never in a fallback face.

One physics for the whole building — four durations and three easing curves in `src/design/tokens.css`, and nothing in the app uses a timing that isn't one of them. Cards have no borders; hairlines live only inside lists and on glass edges; the accent appears on the active destination, the primary action, live indicators and selection, and nowhere else. Every state is drawn — hover, active, focus, loading, empty, error. Error states always carry a retry; empty states always say what to do next.

All of it is gated behind `prefers-reduced-motion`.

## Verifying it

```bash
npm run verify         # 396 checks + a production build
npm run e2e            # the whole loop in a real browser, Anthropic stubbed
```

`verify` covers the pieces where a bug is silent: timezone handling and the model's own argument parsing (`time`), undo and persistence (`store`), tool identity-resolution and collision refusal (`tools`), SSE reassembly across hostile chunk boundaries (`stream`), speech chunking plus wake-word matching (`speech`), and the connector's contract (`pentagon`) — what leaves the device, that a signed-out call fails in words rather than a stack trace, and that remote undo dispatches.

`e2e` runs the built bundle in Chromium with the Anthropic endpoint stubbed, and asserts the thing that actually matters: an utterance goes in, a tool runs, the day changes, the ledger entry undoes it cleanly, and a rejected key produces a sentence a person can act on rather than a dead end. It needs Playwright available (`npm i -g playwright`); nothing else in the app does.

## The Pentagon

Optional, and off until you sign in. The Pentagon is the shared Supabase project the rest of the estate runs on — Board Room, Clarify, ZTS, Runway. Connecting under **Settings → Pentagon** does two things:

**Your SYNC state follows you.** The whole document goes into `sync.state` as one `jsonb` row, because the store is one plain object replaced immutably — sharding it into per-row tables would buy nothing but merge conflicts. The row carries a `rev`, and every push declares which revision it believed it was editing. A stale write is refused, not applied. When two devices genuinely diverge SYNC says so and offers the only two honest answers, because silently merging would resurrect things you deleted.

**SYNC can read what's real.** `pentagon_read` reaches twelve sources: the actual calendar, notes, birthdays, upkeep and groceries; and the pipeline, prospects, outreach, inbound leads, clients, findings, store numbers and ops. `pentagon_add_event` and `pentagon_capture` write back — and because the ledger entry carries a `remote` descriptor, **Undo reaches across the network too** and deletes the row it created.

### On the key, and why that's fine

The Supabase key in `src/lib/supabase.js` is the *publishable* one. It ships in the bundle of every Supabase browser app and grants nothing by itself; RLS is the boundary. But "any signed-in account" is a real boundary in a project where anyone can hold that key, so the two tiers are treated differently:

- **Personal tables** are keyed on `auth.uid()`. RLS alone scopes them correctly, so SYNC reads and writes them directly.
- **Business tables** are org-wide, with `auth.role() = 'authenticated'` policies. SYNC refuses to lean on that. Every business read goes through `sync.pentagon()`, which checks `sync.is_owner()` first — an allowlist, plus a self-bootstrapping clause so whoever already owns Board Room rows can never be locked out. `p_source` selects a fixed branch; there is no dynamic SQL, so a model choosing that argument cannot compose a query of its own.

Your Anthropic key is the one thing that never travels. It is stripped from the export and from the synced document, and `npm run smoke:pentagon` asserts both rather than trusting them.

Schema changes live in `supabase/migrations/`. They only add — nothing any other app depends on was modified.

## Your data

It's in `localStorage` under `sync.state.v1`. With the Pentagon connected there's a second copy in `sync.state` on the server; without it, there is no account and no server.

- **Export** writes one JSON file with your API key deliberately stripped out.
- **Import** replaces everything and keeps the local key.
- Clearing site data erases the local copy. Export before you do anything drastic.

---

Built with React 18 and Vite. No UI framework, no state library, no CSS framework — 33 kB of CSS and one design system.
