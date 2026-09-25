import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { startEnrol, cancelEnrol } from '../scan.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * Opens the window in which the next card read is treated as a new card
 * instead of an attendance tap. The captured UID arrives over Socket.IO
 * as "enrol:card".
 */
router.post('/start', (_req, res) => res.json(startEnrol()));

router.post('/cancel', (_req, res) => {
  cancelEnrol();
  res.json({ ok: true });
});

export default router;
