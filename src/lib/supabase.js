// ─── The Pentagon ────────────────────────────────────────────────────────────
// One Supabase project shared by Board Room, Clarify, ZTS and Runway. SYNC's own
// rows live in the `sync` schema; everything it reads from the other apps is
// reached through their existing row-level security, never around it.
//
// On the key: this is the *publishable* key. It is designed to be public — it
// ships inside the JavaScript bundle of every Supabase browser app, and SYNC is
// a static site, so there is nowhere to hide it even if that helped. It grants
// nothing on its own. RLS is the boundary, and every table SYNC touches is
// either scoped to auth.uid() or behind sync.pentagon(), which checks ownership
// before it returns a byte. An env var overrides both values so a fork can point
// somewhere else without editing source.

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || "https://nrzpinvyxxorxufadvyc.supabase.co").replace(/\/+$/, "");
export const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_KEY || "sb_publishable_zDV3HpSChf0bZJ5nY09s3w_rNI3sZ1m";

export const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      // Default profile is SYNC's own schema; `.schema("boardroom")` reaches the
      // shared personal tables per query.
      db: { schema: "sync" },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // A distinct storage key so SYNC's session can't collide with another
        // Pentagon app open in the same browser.
        storageKey: "sync.auth",
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

/**
 * Turn a Supabase error into something worth saying out loud. PostgREST codes
 * are precise but unreadable, and the two that actually happen in practice —
 * a schema that isn't exposed yet, and the ownership gate refusing — deserve
 * an answer that tells you what to do rather than what went wrong.
 */
export function readableError(error) {
  if (!error) return "";
  const code = error.code || "";
  if (code === "PGRST106") return "The `sync` schema isn't exposed over the API yet — add it under Settings → API → Exposed schemas in Supabase.";
  if (code === "42501") return "That account isn't the Pentagon owner, so business data stays hidden.";
  if (code === "28000" || error.status === 401) return "Signed out — sign in again.";
  if (code === "PGRST301") return "The session expired. Sign in again.";
  if (/Failed to fetch|NetworkError/i.test(error.message || "")) return "Couldn't reach the Pentagon — check the connection.";
  return error.message || "Something went wrong talking to the Pentagon.";
}
