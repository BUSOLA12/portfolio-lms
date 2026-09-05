// Auth routes.
//
// Registration, the guardian claim, the session pair, and password reset.
//
// Every route here is unauthenticated and most of them either check a
// credential or send an email, so the whole router carries a generous
// per-address limit and the sensitive routes carry a tighter targeted one on
// top. `/logout` and `/me` are deliberately left to the address layer alone:
// both are cheap, and throttling logout would leave someone unable to end a
// session they want ended.

import express from 'express';

import {
  claim,
  completeReset,
  login,
  logout,
  me,
  register,
  requestReset,
  verifyEmail,
  resendInvitation,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  authAddressLimiter,
  claimLimiter,
  emailDispatchLimiter,
  loginLimiter,
  registrationLimiter,
} from '../middleware/rateLimit.js';

const router = express.Router();

router.use(authAddressLimiter);

router.post('/register', registrationLimiter, register);
router.post('/claim', claimLimiter, claim);
router.post('/verify', claimLimiter, verifyEmail);
router.post('/invitation/resend', emailDispatchLimiter, resendInvitation);

router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

router.post('/password-reset', emailDispatchLimiter, requestReset);
router.post('/password-reset/complete', claimLimiter, completeReset);

export default router;
