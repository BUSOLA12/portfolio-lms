// Auth routes.
//
// Registration only, for now. Login, logout, current user and password reset
// arrive at step 1.8; the guardian claim flow at 1.7. Rate limiting for this
// router is step 1.9.

import express from 'express';

import { register } from '../controllers/authController.js';

const router = express.Router();

router.post('/register', register);

export default router;
