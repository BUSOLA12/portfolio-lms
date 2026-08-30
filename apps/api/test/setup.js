// Test environment guard. Loaded via `--import` before any test file runs, so
// it applies to every suite, present and future.
//
// The hazard this closes: `registerLearner` sends email from step 1.6 onward,
// `.env` carries live Resend credentials, and a suite that simply forgot to
// pin a transport would post real mail to the fake addresses tests invent.
// Pinning it inside each suite only ever protected the suites that remembered.
//
// Two locks. The transport is forced to `console`, which transmits nothing; and
// the API key is replaced with a value that cannot authenticate, so even a
// suite that deliberately selects `resend` fails at Resend's door rather than
// delivering. A test that wants to observe messages injects its own recording
// provider, which neither lock affects.
//
// Both locks overwrite rather than delete, deliberately. Importing Prisma
// re-reads `.env` into `process.env` to find DATABASE_URL, which resurrects
// anything deleted here — but leaves alone anything already set, because that
// loader does not override existing variables. A deleted key came back; an
// overwritten one stays overwritten.

process.env.EMAIL_PROVIDER = 'console';
process.env.EMAIL_API_KEY = 'blocked-by-test-setup';

// Deterministic values for the fields templates and links read, so no suite
// depends on what happens to be in .env.
process.env.EMAIL_FROM = 'Tests <tests@example.invalid>';
process.env.WEB_ORIGIN = 'https://web.example.invalid';
