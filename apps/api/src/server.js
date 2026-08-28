// Process lifecycle: start the HTTP server and shut it down cleanly.

import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;

const app = createApp();

const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

// Graceful shutdown. Railway sends SIGTERM on redeploy; Ctrl+C sends SIGINT.
// Stop accepting connections, let in-flight requests finish, then exit. A
// timeout guards against a connection that never closes.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);

  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(signal));
}
