// Two things have to be right before a word reaches the speakers: the text has
// to be stripped of everything that reads badly out loud, and it has to be cut
// into pieces short enough that Chrome doesn't kill the utterance mid-sentence.
// Both are pure functions, so both are testable without a browser.
//
// The wake-word matcher is here too — it is the single most-exercised piece of
// string handling in the app, and getting it wrong means either a deaf
// assistant or one that talks to itself.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const { speakable, chunk, supported } = await import("../src/voice/speaker.js");
const { afterWake } = await import("../src/voice/recognizer.js");

/* ── with no speechSynthesis, the module still imports and reports honestly ── */
eq("speech support is reported, not assumed", supported, false);

/* ── text that reads badly out loud ────────────────────────────────────────── */
eq("bold markers are stripped", speakable("That's **booked**."), "That's booked.");
eq("italic markers are stripped", speakable("That's *booked*."), "That's booked.");
eq("inline code is unwrapped", speakable("Run `npm run dev` first."), "Run npm run dev first.");
eq("headers are stripped", speakable("## Today\nTwo blocks."), "Today\nTwo blocks.");
eq("list bullets are stripped", speakable("- one\n- two"), "one\ntwo");
eq("bullet dots are stripped", speakable("• one"), "one");
eq("links keep their label", speakable("See [the docs](https://example.com/a/b)."), "See the docs.");
eq("bare urls become a hostname", speakable("It's at https://www.example.com/a/b?c=d now."), "It's at example.com now.");
eq("ampersands are spoken", speakable("Ops & Finance"), "Ops and Finance");
check("code fences are not read aloud", speakable("Here:\n```js\nconst x = 1;\n```").includes("code block"));
check("internal ids are removed", !speakable("Moved block k9x2mf1q3ab to two.").includes("k9x2mf1q3ab"));
eq("whitespace is collapsed", speakable("Two   spaces"), "Two spaces");
eq("empty in, empty out", speakable(""), "");
eq("null is survivable", speakable(null), "");

/* ── chunking ──────────────────────────────────────────────────────────────── */
const short = chunk("Booked. Two till four.");
eq("a short reply stays in one piece", short.length, 1);

const long = "This is a sentence that runs on for a while. " .repeat(14);
const pieces = chunk(long, 190);
check("a long reply is split", pieces.length > 1);
check("no piece exceeds the ceiling", pieces.every((p) => p.length <= 190));
eq("nothing is lost in the split", pieces.join(" ").replace(/\s+/g, " ").trim(), long.replace(/\s+/g, " ").trim());

// A single sentence longer than the ceiling has to break on a comma or a
// space — never mid-word, which is what makes synthesis stutter.
const runOn = "I moved the creator call to Thursday afternoon, cleared the Wednesday block that was sitting on your only clear stretch of the week, and pushed the supplier reply to tomorrow morning so today has room for the proposal.";
const hard = chunk(runOn, 90);
check("an over-long sentence is broken up", hard.length > 1);
check("no piece exceeds the ceiling", hard.every((p) => p.length <= 90));
check("no word is cut in half", hard.every((p) => !/\w$/.test(p) || runOn.includes(p)));
eq("no empty pieces", hard.filter((p) => !p.trim()).length, 0);

/* ── the wake word ─────────────────────────────────────────────────────────── */
eq("plain wake word", afterWake("sync move my two o'clock", "sync"), { hit: true, rest: "move my two o clock" });
eq("wake word mid-sentence", afterWake("hey sync what's next", "sync"), { hit: true, rest: "what s next" });
eq("wake word with punctuation", afterWake("Sync, plan my day.", "sync"), { hit: true, rest: "plan my day" });
eq("capitalised", afterWake("SYNC start a timer", "sync"), { hit: true, rest: "start a timer" });
eq("wake word alone", afterWake("sync", "sync"), { hit: true, rest: "" });

// The mishearings this particular name actually produces.
eq("misheard as sink", afterWake("sink what's on my plate", "sync").hit, true);
eq("misheard as think", afterWake("think plan my day", "sync").hit, true);

eq("no wake word means no command", afterWake("just talking to someone else", "sync"), { hit: false, rest: "" });
eq("a word containing the name does not count", afterWake("synchronise the files", "sync").hit, false);
eq("empty input", afterWake("", "sync"), { hit: false, rest: "" });

// A custom wake word works even though it has no alias list.
eq("a custom wake word", afterWake("atlas what's next", "atlas"), { hit: true, rest: "what s next" });
eq("the custom word is required", afterWake("sync what's next", "atlas").hit, false);

report("speech");
