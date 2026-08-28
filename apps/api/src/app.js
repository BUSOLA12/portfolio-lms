// Express application assembly.
//
// This module wires middleware and routes and returns the app. It does not
// listen on a port — server.js owns the process lifecycle — so the app stays
// importable by tests.

import express from 'express';

import { requestLogger } from './middleware/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import router from './routes/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json());
  app.use(requestLogger);

  app.use('/', router);

  // Order matters: the 404 handler runs when no route matched, then the
  // error handler catches anything the routes threw.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
