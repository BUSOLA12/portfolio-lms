// Express application assembly.
//
// This module wires middleware and routes and returns the app. It does not
// listen on a port — server.js owns the process lifecycle — so the app stays
// importable by tests.

import express from 'express';

import { cors } from './middleware/cors.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import router from './routes/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Rate limiting keys on the client address, and behind Railway's edge that
  // address only reaches the app through X-Forwarded-For. Untrusted, every
  // request would appear to come from the proxy and the first limiter to fire
  // would lock out every learner at once.
  //
  // A hop count rather than `true`: trusting the whole chain lets a caller
  // prepend any address they like to the header and sidestep the limit
  // entirely. Unset locally, where there is no proxy in front.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const hops = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
  }

  // Before the body parser and the routes: a preflight carries no body and
  // must be answered without reaching either.
  app.use(cors);

  app.use(express.json());
  app.use(requestLogger);

  app.use('/', router);

  // Order matters: the 404 handler runs when no route matched, then the
  // error handler catches anything the routes threw.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
