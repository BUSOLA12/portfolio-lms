// Cross-origin access, with credentials.
//
// Per D21 the API set no CORS headers at all, which meant every screen in 1.11
// would fail at its first request. The web app and the API are different
// origins in both environments — `greenatetech.com` calling
// `api.greenatetech.com`, and `localhost:3000` calling `localhost:4000`.
//
// The cookie itself was never the problem: those pairs share a registrable
// domain, so `SameSite=lax` already permits the session cookie to be sent. CORS
// is a separate gate. Without it the browser refuses to attach credentials to
// the request and refuses to let script read the response.
//
// Written rather than installed, on the same line the rate limiter took: the
// `cors` package is convenient, but this is a header allowlist and a preflight
// reply.

// Per D20, a security boundary defaults closed. An unset WEB_ORIGIN refuses
// every cross-origin request rather than permitting all of them — forgetting
// the variable must fail shut, not open.
function allowedOrigins() {
  const configured = process.env.WEB_ORIGIN;
  if (!configured) return [];

  // Comma-separated, so one deployment can serve a second origin — a preview
  // domain, say — without loosening anything: each is still named in full.
  return configured
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Only what the API actually exposes. Widening this later is deliberate work.
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type';

// Headers the browser may let script read. The rate limiter's budget is
// useless to a client that cannot see it — 1.9 duplicated `retryAfter` into the
// response body precisely because these were unreadable cross-origin, and this
// is what makes the headers themselves usable.
const EXPOSED_HEADERS = [
  'Retry-After',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
].join(', ');

const PREFLIGHT_MAX_AGE = '600';

export function cors(req, res, next) {
  const origin = req.get('origin');

  // No Origin header means this is not a browser cross-origin request at all —
  // a health check, a webhook, curl. Nothing to negotiate.
  if (!origin) {
    next();
    return;
  }

  const permitted = allowedOrigins().includes(origin.replace(/\/+$/, ''));

  // Always, even when refusing: the answer depends on the Origin header, so a
  // cache that ignored it could serve one origin's response to another.
  res.setHeader('Vary', 'Origin');

  if (permitted) {
    // The origin by name, never `*`. A wildcard is invalid alongside
    // credentials, and the browser would reject the response rather than
    // fall back to something permissive.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  }

  if (req.method === 'OPTIONS') {
    if (!permitted) {
      // A refused preflight is answered plainly rather than left to fall
      // through to the router, which would report 404 for a route that exists
      // and send whoever is debugging it in the wrong direction.
      res.status(403).json({
        error: { status: 403, message: 'Origin not allowed' },
      });
      return;
    }

    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
    res.status(204).end();
    return;
  }

  // A simple request from a disallowed origin is not blocked here. The server
  // has no way to know the browser will discard it, and refusing outright would
  // also refuse the non-browser callers that send an Origin header by accident.
  // Omitting the headers is what stops script reading the response.
  next();
}
