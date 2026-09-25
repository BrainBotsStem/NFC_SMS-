import { Router } from 'express';
import { Student, Attendance } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { localDay } from '../ids.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * Every student's status right now: on site (with the time they tapped in),
 * or not in yet - either they have not tapped in today, or they tapped out
 * already (their last out time is included so the dashboard can show it).
 */
router.get('/today', asyncHandler(async (_req, res) => {
  const today = localDay();

  const [students, rows] = await Promise.all([
    Student.find().populate('batch', 'name').sort({ studentId: 1 }),
    Attendance.find({ day: today }).sort({ time: 1 }),
  ]);

  // A student could tap in more than once today only after a 12h gap, so the
  // latest row is the one that reflects where they are right now.
  const latestByStudent = new Map();
  for (const row of rows) latestByStudent.set(String(row.student), row);

  const inList = [];
  const notInList = [];

  for (const s of students) {
    const row = latestByStudent.get(String(s._id));
    const entry = { studentId: s.studentId, name: s.name, batch: s.batch?.name || '—' };
    if (row && !row.outTime) {
      inList.push({ ...entry, time: row.time });
    } else {
      notInList.push({ ...entry, lastOut: row?.outTime || null });
    }
  }

  res.json({
    day: today,
    in: inList,
    notIn: notInList,
    students: students.map((s) => ({
      studentId: s.studentId,
      name: s.name,
      batch: s.batch?.name || '—',
    })),
  });
}));

export default router;
