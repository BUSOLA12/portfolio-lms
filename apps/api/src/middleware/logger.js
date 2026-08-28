// Request logging.
//
// Emits one line per request when the response finishes, carrying method,
// path, status code, and wall-clock duration. Deliberately dependency-free
// and minimal — a structured logger can replace this later without changing
// any call site, since the only entry point is the exported middleware.

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
    );
  });

  next();
}
