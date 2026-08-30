// The provider handler.
//
// One transport interface — `send({ from, to, subject, html, text })` — with
// the provider chosen by `EMAIL_PROVIDER`. Everything above this file is
// provider-agnostic, so switching transports touches this file alone.
//
// Resend is reached over its REST API with `fetch` rather than through its SDK.
// The project has held a dependency-free line where the platform already
// provides the primitive — no dotenv, no morgan, no cookie-parser, no test
// framework — and one POST with a bearer token does not need a package.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Email cannot be sent without it.`);
  }
  return value;
}

/// Transmits nothing. Selected with `EMAIL_PROVIDER=console`, so the whole
/// email path can be exercised locally without credentials and without
/// delivering to a real address. It is not a silent fallback: it has to be
/// asked for by name.
const consoleProvider = {
  name: 'console',
  async send(message) {
    console.log(
      `[email:console] to=${message.to} subject=${JSON.stringify(message.subject)}`,
    );
    return { id: `console-${Date.now()}` };
  },
};

const resendProvider = {
  name: 'resend',
  async send(message) {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireEnv('EMAIL_API_KEY')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    // Read the body once, whatever the status: Resend reports failures as JSON
    // with a name and a message, and swallowing that would leave a bounced
    // dunning reminder indistinguishable from a delivered one.
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = body?.message ?? `HTTP ${response.status}`;
      throw new Error(`Resend refused the message: ${detail}`);
    }

    return { id: body?.id ?? null };
  },
};

const providers = {
  console: consoleProvider,
  resend: resendProvider,
};

/**
 * Resolves the configured provider. Throws rather than defaulting: an unset
 * `EMAIL_PROVIDER` silently becoming a no-op would mean a production deploy
 * that logs every dunning reminder and sends none.
 */
export function getEmailProvider(name = process.env.EMAIL_PROVIDER) {
  const provider = providers[name];

  if (!provider) {
    throw new Error(
      `EMAIL_PROVIDER must be one of ${Object.keys(providers).join(', ')}; got ${name || 'nothing'}`,
    );
  }

  return provider;
}
