// Auth routes.
//
// Registration, the guardian claim, the session pair, and password reset.
// Rate limiting for this router is step 1.9.

import express from 'express';

import {
  claim,
  completeReset,
  login,
  logout,
  me,
  register,
  requestReset,
  resendInvitation,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/register', register);
router.post('/claim', claim);
router.post('/invitation/resend', resendInvitation);

router.post('/login', login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

router.post('/password-reset', requestReset);
router.post('/password-reset/complete', completeReset);

export default router;
