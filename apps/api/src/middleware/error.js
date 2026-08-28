// Structured error handling.
//
// Every failure leaves the API as JSON with a stable shape — never an HTML
// page, never a stack trace in the response body. Handlers (sync or async)
// that throw or reject are routed here by Express 5.

// Unknown route. Kept alongside the error handler because it is the same
// concern: an API response that would otherwise be Express's default HTML.
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      status: 404,
      message: `Cannot ${req.method} ${req.originalUrl}`,
    },
  });
}

// Express recognises the error handler by its four-argument signature, so the
// trailing parameter must stay even though it is unused (name prefixed with
// `_` to satisfy the lint rule).
export function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err.status) ? err.status : 500;

  // Server-side faults are logged in full; client faults are not noise worth
  // recording here.
  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: {
      status,
      message: status >= 500 ? 'Internal Server Error' : err.message,
    },
  });
}
