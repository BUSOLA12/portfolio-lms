// Root router.
//
// Feature routers mount here as later steps add them, following the
// routes -> controllers -> services -> repositories layering. For now it
// carries the health check, which needs no controller, and the auth router.

import express from 'express';

import authRouter from './auth.js';

const router = express.Router();

// Liveness probe. No auth, no database — it only confirms the process is up
// and serving. Railway and uptime checks hit this.
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.use('/auth', authRouter);

export default router;
