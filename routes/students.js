import { Router } from 'express';
import { Student, Batch, Attendance, Staff } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { nextStudentId, normaliseUid } from '../ids.js';
import { publishRoster } from '../mqtt.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.batch) filter.batch = req.query.batch;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ name: rx }, { studentId: rx }];
    }
    const students = await Student.find(filter)
      .populate('batch', 'name level')
      .sort({ studentId: 1 })
      .limit(1000);
    res.json({ students });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { uid, name, batch: batchId } = req.body || {};
    const cardUid = normaliseUid(uid);

    if (!cardUid) return res.status(400).json({ error: 'Scan a card before saving.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Enter the student name.' });

    const batch = await Batch.findById(batchId);
    if (!batch) return res.status(400).json({ error: 'Choose a batch.' });

    if (await Student.findOne({ uid: cardUid })) {
      return res.status(409).json({ error: 'That card is already assigned to a student.' });
    }
    if (await Staff.findOne({ uid: cardUid })) {
      return res.status(409).json({ error: 'That card is already assigned to a staff member.' });
    }

    const studentId = await nextStudentId(batch.level);
    const student = await Student.create({
      studentId,
      name: name.trim(),
      uid: cardUid,
      batch: batch._id,
    });
    publishRoster().catch((err) => console.error('[mqtt] roster failed:', err.message));
    res.status(201).json({ student: await student.populate('batch', 'name level') });
  })
);

/**
 * One student's full history: every class they attended, with the batch it
 * was recorded under. ?from=YYYY-MM-DD&to=YYYY-MM-DD, both optional (all time).
 */
router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const student = await Student.findById(req.params.id).populate('batch', 'name level');
    if (!student) return res.status(404).json({ error: 'That student does not exist.' });

    const day = {};
    if (req.query.from) day.$gte = req.query.from;
    if (req.query.to) day.$lte = req.query.to;
    const [rows, first] = await Promise.all([
      Attendance.find({ student: student._id, ...(req.query.from || req.query.to ? { day } : {}) })
        .populate('batch', 'name')
        .sort({ time: -1 })
        .limit(5000),
      Attendance.findOne({ student: student._id }).sort({ time: 1 }),
    ]);

    res.json({
      student: {
        _id: student._id,
        studentId: student.studentId,
        name: student.name,
        uid: student.uid,
        batch: student.batch,
        createdAt: student.createdAt,
        firstSeen: first?.time || null,
      },
      rows: rows.map((r) => ({
        _id: r._id,
        day: r.day,
        time: r.time,
        outTime: r.outTime || null,
        batch: r.batch?.name || '—',
      })),
    });
  })
);

/** The student ID never changes, including when a student moves batch. */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const update = {};
    if (typeof req.body?.name === 'string') {
      if (!req.body.name.trim()) return res.status(400).json({ error: 'Enter the student name.' });
      update.name = req.body.name.trim();
    }
    if (req.body?.batch) {
      const batch = await Batch.findById(req.body.batch);
      if (!batch) return res.status(400).json({ error: 'Choose a batch.' });
      update.batch = batch._id;
    }

    const student = await Student.findByIdAndUpdate(req.params.id, update, { new: true }).populate(
      'batch',
      'name level'
    );
    if (!student) return res.status(404).json({ error: 'That student does not exist.' });
    res.json({ student });
  })
);

/** Removes the student with their attendance history. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ error: 'That student does not exist.' });
    await Attendance.deleteMany({ student: student._id });
    publishRoster().catch((err) => console.error('[mqtt] roster failed:', err.message));
    res.json({ ok: true });
  })
);

export default router;
