// Fixed-window rate limiting.
//
// Written rather than installed. `express-rate-limit` is the obvious reach, but
// a fixed window is a counter and an expiry, and this codebase has held a
// dependency-free line wherever the platform already provides the primitive —
// no dotenv, no morgan, no cookie-parser, no test framework, no Resend SDK.
//
// **The store is in memory.** Two consequences worth knowing rather than
// discovering: the counters reset on every deploy, and they are per-process, so
// if the API is ever scaled past one replica each instance enforces its own
// share of the limit. Railway currently runs one. Moving the store to Postgres
// or Redis is a change to this file alone — nothing above it knows where the
// counters live.
//
// **Keying is the part that matters.** Two different risks share the auth
// router. Login and the claim are guessing attacks, where the limit protects one
// account. Password reset, the invitation resend and registration send email to
// an address the caller supplies, where the limit protects the recipient and the
// sending reputation. A single limiter tuned for one is wrong for the other, so
// endpoints carry both a generous per-address layer and a tight per-target one.

const SWEEP_EVERY = 500;

/**
 * Reads a positive integer from the environment at request time rather than at
 * construction, so a test can lower a limit without re-importing the module.
 */
function envInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The client's address.
 *
 * Express derives `req.ip` from `X-Forwarded-For` only when the app trusts a
 * proxy, which `app.js` configures from `TRUST_PROXY`. Untrusted and behind
 * Railway's edge, every request would share the proxy's address and the first
 * limiter to fire would lock out everyone at once.
 */
function addressOf(req) {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Builds a limiter.
 *
 * `key` maps a request to the bucket it counts against. Returning null skips
 * the request entirely, which is how a per-target limiter ignores a request
 * that carries no target to key on.
 *
 * The returned middleware carries `reset()`, used by tests to clear state
 * between cases. Nothing in the application calls it.
 */
export function createRateLimiter({ name, windowMs, max, key }) {
  const buckets = new Map();
  let sinceSweep = 0;

  function sweep(now) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  function middleware(req, res, next) {
    const bucketKey = key(req);
    if (bucketKey === null || bucketKey === undefined) {
      next();
      return;
    }

    const now = Date.now();

    // Expired buckets are dropped on read, so a quiet key costs nothing. The
    // periodic sweep is only for keys that are never revisited, which would
    // otherwise accumulate for the life of the process.
    sinceSweep += 1;
    if (sinceSweep >= SWEEP_EVERY) {
      sinceSweep = 0;
      sweep(now);
    }

    const limit = max();
    const existing = buckets.get(bucketKey);
    const bucket =
      existing === undefined || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs() }
        : existing;

    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));

      // The same envelope every other failure uses, so a client parses one
      // shape. `retryAfter` is repeated in the body because a browser fetch
      // cannot always read the header cross-origin.
      res.status(429).json({
        error: {
          status: 429,
          message: 'Too many requests. Try again shortly.',
          retryAfter,
        },
      });
      return;
    }

    next();
  }

  middleware.limiterName = name;
  middleware.reset = () => {
    buckets.clear();
    sinceSweep = 0;
  };

  return middleware;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Deliberately generous. Nigerian mobile networks put whole cohorts behind one
// carrier-grade NAT address, so a tight per-address limit would read as an
// outage to real learners. This layer is here to stop bulk abuse, not to
// protect an individual account — that is the per-target layer's job.
export const authAddressLimiter = createRateLimiter({
  name: 'auth:address',
  windowMs: () => envInt('RATE_LIMIT_AUTH_WINDOW_MS', 15 * MINUTE),
  max: () => envInt('RATE_LIMIT_AUTH_MAX', 300),
  key: (req) => `auth:${addressOf(req)}`,
});

// Per account, so one person's failed attempts cannot lock out anyone else
// sharing their address. This is the layer that actually stops password
// guessing.
export const loginLimiter = createRateLimiter({
  name: 'login',
  windowMs: () => envInt('RATE_LIMIT_LOGIN_WINDOW_MS', 15 * MINUTE),
  max: () => envInt('RATE_LIMIT_LOGIN_MAX', 10),
  key: (req) => {
    const email = normalisedEmail(req);
    return email === null ? null : `login:${addressOf(req)}:${email}`;
  },
});

// Guessing a 256-bit token is not the risk; this bounds the cost of somebody
// hammering the endpoint. Keyed on address alone, since a claim carries a token
// rather than an address.
export const claimLimiter = createRateLimiter({
  name: 'claim',
  windowMs: () => envInt('RATE_LIMIT_CLAIM_WINDOW_MS', 15 * MINUTE),
  max: () => envInt('RATE_LIMIT_CLAIM_MAX', 20),
  key: (req) => `claim:${addressOf(req)}`,
});

// Registration creates an account and sends mail. Tighter than the address
// layer, looser than the mail-sending endpoints, and keyed on address because
// the email in the body is chosen by the caller and is different every time.
export const registrationLimiter = createRateLimiter({
  name: 'registration',
  windowMs: () => envInt('RATE_LIMIT_REGISTRATION_WINDOW_MS', HOUR),
  max: () => envInt('RATE_LIMIT_REGISTRATION_MAX', 10),
  key: (req) => `registration:${addressOf(req)}`,
});

/**
 * Password reset and the invitation resend both post mail to an address the
 * caller names. The limit protects the person receiving it and the sending
 * reputation, so it is keyed on the target address as well as the source: one
 * caller cannot mail one victim repeatedly, and rotating the source does not
 * lift the per-recipient bound.
 */
export const emailDispatchLimiter = createRateLimiter({
  name: 'email-dispatch',
  windowMs: () => envInt('RATE_LIMIT_EMAIL_WINDOW_MS', HOUR),
  max: () => envInt('RATE_LIMIT_EMAIL_MAX', 5),
  key: (req) => {
    const email = normalisedEmail(req);
    return email === null ? `email:${addressOf(req)}` : `email:${email}`;
  },
});

function normalisedEmail(req) {
  const email = req.body?.email;
  if (typeof email !== 'string' || email.trim() === '') return null;
  return email.trim().toLowerCase();
}

/** Every limiter, so tests can clear state between cases. */
export const allLimiters = [
  authAddressLimiter,
  loginLimiter,
  claimLimiter,
  registrationLimiter,
  emailDispatchLimiter,
];
