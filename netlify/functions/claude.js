// ─── The proxy ───────────────────────────────────────────────────────────────
// Optional. SYNC works with no backend at all — a key in the browser talks to
// Anthropic directly. Deploy this when you'd rather the key lived on a server
// than in localStorage: set ANTHROPIC_API_KEY in the site's environment, leave
// the key field in Settings empty, and the app routes here instead.
//
// Netlify Functions 2.0 handler: it returns a Response, which means the SSE
// body is piped straight through and SYNC still starts speaking on the first
// sentence rather than the last.

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-opus-5",
]);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return json(405, { error: { message: "POST only" } });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json(500, {
      error: { message: "ANTHROPIC_API_KEY is not set on this deployment. Add it in the site's environment variables, or put a key into SYNC's Settings instead." },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: { message: "Body was not JSON." } });
  }

  // Pin the model list here as well as in the client. A proxy that forwards
  // whatever it is handed is a proxy that bills you for whatever it is handed.
  if (!ALLOWED_MODELS.has(body?.model)) {
    return json(400, { error: { message: `Unsupported model "${body?.model}".` } });
  }

  // A runaway max_tokens is the other way this gets expensive.
  if (typeof body.max_tokens !== "number" || body.max_tokens > 8000) body.max_tokens = 3000;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  // Errors come back as JSON; successes come back as an event stream. Both are
  // forwarded verbatim so the client's own error handling stays meaningful.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
};

export const config = { path: "/.netlify/functions/claude" };
