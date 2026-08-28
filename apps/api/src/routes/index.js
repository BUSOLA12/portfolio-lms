// Root router.
//
// Feature routers mount here as later steps add them, following the
// routes -> controllers -> services -> repositories layering. For now it
// carries only the health check, which needs no controller.

import express from 'express';

const router = express.Router();

// Liveness probe. No auth, no database — it only confirms the process is up
// and serving. Railway and uptime checks hit this.
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
