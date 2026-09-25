import { Router } from 'express';
import { Batch, Student, Attendance } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { localDay } from '../ids.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const LEVEL_NAMES = { EL: 'Elementary', IL: 'Intermediate', AL: 'Advanced Level' };

/** All batches, each with its student count and how many are on site right now. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const today = localDay();
    const batches = await Batch.find().sort({ order: 1 });

    const [students, present] = await Promise.all([
      Student.aggregate([{ $group: { _id: '$batch', count: { $sum: 1 } } }]),
      // Only rows with no out time yet count as "in" - a student who has tapped
      // out already (even offline, replayed later) belongs in "not in yet".
      Attendance.aggregate([
        { $match: { day: today, outTime: null } },
        { $group: { _id: { batch: '$batch', student: '$student' } } },
        { $group: { _id: '$_id.batch', count: { $sum: 1 } } },
      ]),
    ]);

    const studentCount = new Map(students.map((s) => [String(s._id), s.count]));
    const presentCount = new Map(present.map((p) => [String(p._id), p.count]));

    res.json({
      day: today,
      batches: batches.map((b) => ({
        _id: b._id,
        name: b.name,
        level: b.level,
        levelName: LEVEL_NAMES[b.level],
        students: studentCount.get(String(b._id)) || 0,
        presentToday: presentCount.get(String(b._id)) || 0,
      })),
    });
  })
);

/** Creates a batch. New batches are appended after every existing one. */
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, level } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Enter a batch name.' });
    if (!LEVEL_NAMES[level]) return res.status(400).json({ error: 'Choose a level.' });

    if (await Batch.findOne({ name: name.trim() })) {
      return res.status(409).json({ error: 'A batch with that name already exists.' });
    }

    const last = await Batch.findOne().sort({ order: -1 });
    const batch = await Batch.create({
      name: name.trim(),
      level,
      order: (last?.order || 0) + 1,
    });
    res.status(201).json({
      batch: {
        _id: batch._id,
        name: batch.name,
        level: batch.level,
        levelName: LEVEL_NAMES[batch.level],
        students: 0,
        presentToday: 0,
      },
    });
  })
);

/** Renames a batch or moves it to another level. Existing students keep their student ID. */
router.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const update = {};
    if (typeof req.body?.name === 'string') {
      if (!req.body.name.trim()) return res.status(400).json({ error: 'Enter a batch name.' });
      const dup = await Batch.findOne({ name: req.body.name.trim(), _id: { $ne: req.params.id } });
      if (dup) return res.status(409).json({ error: 'A batch with that name already exists.' });
      update.name = req.body.name.trim();
    }
    if (req.body?.level) {
      if (!LEVEL_NAMES[req.body.level]) return res.status(400).json({ error: 'Choose a level.' });
      update.level = req.body.level;
    }

    const batch = await Batch.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!batch) return res.status(404).json({ error: 'That batch does not exist.' });
    res.json({ batch: { _id: batch._id, name: batch.name, level: batch.level, levelName: LEVEL_NAMES[batch.level] } });
  })
);

/** Refuses to delete a batch that still has students, so no one is silently orphaned. */
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'That batch does not exist.' });

    const count = await Student.countDocuments({ batch: batch._id });
    if (count > 0) {
      return res
        .status(409)
        .json({ error: `Move or delete the ${count} student${count === 1 ? '' : 's'} in this batch first.` });
    }

    await batch.deleteOne();
    res.json({ ok: true });
  })
);

/**
 * Attendance rows for one batch.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD, both optional. Defaults to today.
 */
router.get(
  '/:id/attendance',
  asyncHandler(async (req, res) => {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'That batch does not exist.' });

    const today = localDay();
    const from = req.query.from || today;
    const to = req.query.to || from;

    const [rows, students] = await Promise.all([
      Attendance.find({ batch: batch._id, day: { $gte: from, $lte: to } })
        .populate('student', 'studentId name')
        .sort({ time: -1 })
        .limit(2000),
      // Everyone in the batch now, so the dashboard can list who has not come.
      Student.find({ batch: batch._id }, 'studentId name').sort({ studentId: 1 }),
    ]);

    res.json({
      batch: { _id: batch._id, name: batch.name, level: batch.level },
      from,
      to,
      students: students.map((s) => ({ _id: s._id, studentId: s.studentId, name: s.name })),
      rows: rows
        .filter((r) => r.student) // skip rows whose student was deleted
        .map((r) => ({
          _id: r._id,
          studentId: r.student.studentId,
          name: r.student.name,
          day: r.day,
          time: r.time,
          outTime: r.outTime || null,
        })),
    });
  })
);

export default router;
