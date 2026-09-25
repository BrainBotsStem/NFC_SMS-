import { Router } from 'express';
import { Student, Batch, Attendance } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { nextStudentId, normaliseUid } from '../ids.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res) => {
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
});

router.post('/', async (req, res) => {
  const { uid, name, batch: batchId } = req.body || {};
  const cardUid = normaliseUid(uid);

  if (!cardUid) return res.status(400).json({ error: 'Scan a card before saving.' });
  if (!name?.trim()) return res.status(400).json({ error: 'Enter the student name.' });

  const batch = await Batch.findById(batchId);
  if (!batch) return res.status(400).json({ error: 'Choose a batch.' });

  if (await Student.findOne({ uid: cardUid })) {
    return res.status(409).json({ error: 'That card is already assigned to a student.' });
  }

  const studentId = await nextStudentId(batch.level);
  const student = await Student.create({
    studentId,
    name: name.trim(),
    uid: cardUid,
    batch: batch._id,
  });
  res.status(201).json({ student: await student.populate('batch', 'name level') });
});

/** The student ID never changes, including when a student moves batch. */
router.patch('/:id', async (req, res) => {
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
});

/** Removes the student and their attendance history together. */
router.delete('/:id', async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) return res.status(404).json({ error: 'That student does not exist.' });
  await Attendance.deleteMany({ student: student._id });
  res.json({ ok: true });
});

export default router;
