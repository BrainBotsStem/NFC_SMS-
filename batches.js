import { Router } from 'express';
import { Batch, Student, Attendance } from '../models.js';
import { requireAuth } from '../auth.js';
import { localDay } from '../ids.js';

const router = Router();
router.use(requireAuth);

const LEVEL_NAMES = { EL: 'Elementary', IL: 'Intermediate', AL: 'Advanced Level' };

/** All batches, each with its student count and how many have arrived today. */
router.get('/', async (_req, res) => {
  const today = localDay();
  const batches = await Batch.find().sort({ order: 1 });

  const [students, present] = await Promise.all([
    Student.aggregate([{ $group: { _id: '$batch', count: { $sum: 1 } } }]),
    Attendance.aggregate([
      { $match: { day: today } },
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
});

/**
 * Attendance rows for one batch.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD, both optional. Defaults to today.
 */
router.get('/:id/attendance', async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) return res.status(404).json({ error: 'That batch does not exist.' });

  const today = localDay();
  const from = req.query.from || today;
  const to = req.query.to || from;

  const rows = await Attendance.find({ batch: batch._id, day: { $gte: from, $lte: to } })
    .populate('student', 'studentId name')
    .sort({ time: -1 })
    .limit(2000);

  res.json({
    batch: { _id: batch._id, name: batch.name, level: batch.level },
    from,
    to,
    rows: rows
      .filter((r) => r.student) // skip rows whose student was deleted
      .map((r) => ({
        _id: r._id,
        studentId: r.student.studentId,
        name: r.student.name,
        day: r.day,
        time: r.time,
      })),
  });
});

export default router;
