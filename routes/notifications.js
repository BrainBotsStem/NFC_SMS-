import { Router } from 'express';
import mongoose from 'mongoose';
import { Notification } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';
import { localDay } from '../ids.js';
import { normalisePhone, notifySettings, retry, sendTest } from '../notify.js';

/* Text messages to parents: the settings, the log, a test send and a retry. */

const router = Router();
router.use(requireAuth, requireAdmin);

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped'];

/** The latest messages, newest first. ?status= narrows to one status. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    const today = localDay();
    const [rows, counts] = await Promise.all([
      Notification.find(filter).populate('student', 'name studentId').sort({ createdAt: -1 }).limit(300),
      Notification.aggregate([
        { $match: { $or: [{ day: today }, { kind: 'test', createdAt: { $gte: new Date(Date.now() - 864e5) } }] } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    res.json({
      settings: notifySettings(),
      today: Object.fromEntries(counts.map((c) => [c._id, c.count])),
      notifications: rows.map((r) => ({
        _id: r._id,
        kind: r.kind,
        status: r.status,
        phone: r.phone,
        message: r.message,
        error: r.error,
        attempts: r.attempts,
        tapTime: r.tapTime,
        sendAfter: r.sendAfter,
        sentAt: r.sentAt,
        createdAt: r.createdAt,
        student: r.student ? { _id: r.student._id, name: r.student.name, studentId: r.student.studentId } : null,
      })),
    });
  })
);

/** Sends one test text straight away, to check the SMS account works. */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a mobile number like 077 123 4567.' });
    const row = await sendTest(phone);
    if (row.status !== 'sent') return res.status(502).json({ error: row.error || 'The message was not sent.' });
    res.json({ ok: true });
  })
);

/** Sends a failed or skipped message again. */
router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'That message does not exist.' });
    const row = await retry(req.params.id);
    if (!row) return res.status(409).json({ error: 'Only a failed or skipped message can be sent again.' });
    res.json({ ok: true });
  })
);

export default router;
