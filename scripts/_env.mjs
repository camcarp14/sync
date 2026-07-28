// Minimal browser shims so the app's own modules can be exercised under plain
// `node`. Only what the modules under test actually touch — anything more and
// the tests start passing against a fiction instead of the real code.

class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}

export function installBrowserEnv() {
  if (!globalThis.localStorage) globalThis.localStorage = new MemoryStorage();
  if (!globalThis.window) {
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
  }
  if (!globalThis.document) {
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  }
}

/* ── the tiniest test harness that still reports usefully ──────────────────── */
let passed = 0;
const failures = [];

export function check(name, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

export function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  return check(name, a === b, `got ${a}, wanted ${b}`);
}

export function report(suite) {
  if (failures.length) {
    console.error(`\n✗ ${suite}: ${failures.length} failed, ${passed} passed`);
    for (const f of failures) console.error(`  · ${f}`);
    process.exit(1);
  }
  console.log(`✓ ${suite}: ${passed} checks passed`);
}
