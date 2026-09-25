import { Router } from 'express';
import { Department, Staff, StaffAttendance, Student } from '../models.js';
import { requireAuth, requireStaffAdmin } from '../auth.js';
import { localDay, nextStaffId, normaliseUid } from '../ids.js';
import { publishRoster } from '../mqtt.js';
import { asyncHandler } from '../asyncHandler.js';
import { clock, dayLabel, duration } from '../lib/format.js';
import { newDoc, drawHeading, drawTable, periodLabel, dayFilter } from './reports.js';

/*
 * The staff side: departments (like batches), staff members (like students)
 * and a daily register filled in by card taps. Only the staff sign-in sees it.
 */

const router = Router();
router.use(requireAuth, requireStaffAdmin);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const refreshRoster = () => publishRoster().catch((err) => console.error('[mqtt] roster failed:', err.message));

// ------------------------------------------------------------ departments --

/** Every department with its staff count and how many are signed in right now, like batches. */
router.get(
  '/departments',
  asyncHandler(async (_req, res) => {
    const today = localDay();
    const [departments, counts, came] = await Promise.all([
      Department.find().sort({ order: 1 }),
      Staff.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }]),
      // Someone can sign in several times a day, so each person is counted once.
      StaffAttendance.aggregate([
        { $match: { day: today } },
        {
          $group: {
            _id: { department: '$department', staff: '$staff' },
            open: { $max: { $cond: [{ $eq: ['$outTime', null] }, 1, 0] } },
          },
        },
        { $group: { _id: '$_id.department', count: { $sum: 1 }, inNow: { $sum: '$open' } } },
      ]),
    ]);
    const staffCount = new Map(counts.map((c) => [String(c._id), c.count]));
    const cameCount = new Map(came.map((c) => [String(c._id), c]));
    res.json({
      day: today,
      departments: departments.map((d) => ({
        _id: d._id,
        name: d.name,
        staff: staffCount.get(String(d._id)) || 0,
        cameToday: cameCount.get(String(d._id))?.count || 0,
        inNow: cameCount.get(String(d._id))?.inNow || 0,
      })),
    });
  })
);

router.post(
  '/departments',
  asyncHandler(async (req, res) => {
    const name = req.body?.name?.trim();
    if (!name) return res.status(400).json({ error: 'Enter a department name.' });
    if (await Department.findOne({ name })) {
      return res.status(409).json({ error: 'A department with that name already exists.' });
    }
    const last = await Department.findOne().sort({ order: -1 });
    const d = await Department.create({ name, order: (last?.order || 0) + 1 });
    res.status(201).json({ department: { _id: d._id, name: d.name, staff: 0, cameToday: 0, inNow: 0 } });
  })
);

router.patch(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    const name = req.body?.name?.trim();
    if (!name) return res.status(400).json({ error: 'Enter a department name.' });
    if (await Department.findOne({ name, _id: { $ne: req.params.id } })) {
      return res.status(409).json({ error: 'A department with that name already exists.' });
    }
    const d = await Department.findByIdAndUpdate(req.params.id, { name }, { new: true });
    if (!d) return res.status(404).json({ error: 'That department does not exist.' });
    res.json({ department: { _id: d._id, name: d.name } });
  })
);

/** Refuses while the department still has staff, so no one is silently orphaned. */
router.delete(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    const d = await Department.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'That department does not exist.' });
    const count = await Staff.countDocuments({ department: d._id });
    if (count > 0) {
      return res
        .status(409)
        .json({ error: `Move or delete the ${count} staff member${count === 1 ? '' : 's'} in this department first.` });
    }
    await d.deleteOne();
    res.json({ ok: true });
  })
);

/** One department's staff and register rows. ?from=YYYY-MM-DD&to=YYYY-MM-DD, default today. */
router.get(
  '/departments/:id/attendance',
  asyncHandler(async (req, res) => {
    const d = await Department.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'That department does not exist.' });
    const from = req.query.from || localDay();
    const to = req.query.to || from;

    const [staff, rows] = await Promise.all([
      Staff.find({ department: d._id }).sort({ staffId: 1 }),
      StaffAttendance.find({ department: d._id, day: { $gte: from, $lte: to } })
        .populate('staff', 'staffId name')
        .sort({ day: -1, time: -1 })
        .limit(5000),
    ]);

    res.json({
      department: { _id: d._id, name: d.name },
      from,
      to,
      staff: staff.map((s) => ({ _id: s._id, staffId: s.staffId, name: s.name, designation: s.designation })),
      rows: rows
        .filter((r) => r.staff)
        .map((r) => ({
          _id: r._id,
          staffId: r.staff.staffId,
          name: r.staff.name,
          day: r.day,
          time: r.time,
          outTime: r.outTime || null,
        })),
    });
  })
);

/**
 * Every staff member's status right now, like the students' overview: signed
 * in (with the time), or not in, either not come yet or signed out already.
 */
router.get(
  '/today',
  asyncHandler(async (_req, res) => {
    const today = localDay();
    const [staff, rows] = await Promise.all([
      Staff.find().populate('department', 'name').sort({ staffId: 1 }),
      StaffAttendance.find({ day: today }).sort({ time: 1 }),
    ]);
    // The latest sign-in of the day says where someone is now.
    const latest = new Map();
    for (const r of rows) latest.set(String(r.staff), r);
    const inList = [];
    const notIn = [];
    for (const s of staff) {
      const row = latest.get(String(s._id));
      const entry = { staffId: s.staffId, name: s.name, department: s.department?.name || '—' };
      if (row && !row.outTime) inList.push({ ...entry, time: row.time });
      else notIn.push({ ...entry, lastOut: row?.outTime || null });
    }
    res.json({
      day: today,
      in: inList,
      notIn,
      staff: staff.map((s) => ({ staffId: s.staffId, name: s.name, department: s.department?.name || '—' })),
    });
  })
);

// ---------------------------------------------------------------- members --

router.get(
  '/members',
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ name: rx }, { staffId: rx }, { designation: rx }];
    }
    const staff = await Staff.find(filter).populate('department', 'name').sort({ staffId: 1 }).limit(1000);
    res.json({ staff });
  })
);

router.post(
  '/members',
  asyncHandler(async (req, res) => {
    const { uid, name, designation, department: departmentId } = req.body || {};
    const cardUid = normaliseUid(uid);
    if (!cardUid) return res.status(400).json({ error: 'Scan a card before saving.' });
    if (!name?.trim()) return res.status(400).json({ error: 'Enter the staff member’s name.' });

    const department = await Department.findById(departmentId);
    if (!department) return res.status(400).json({ error: 'Choose a department.' });

    if (await Staff.findOne({ uid: cardUid })) {
      return res.status(409).json({ error: 'That card is already assigned to a staff member.' });
    }
    if (await Student.findOne({ uid: cardUid })) {
      return res.status(409).json({ error: 'That card is already assigned to a student.' });
    }

    const member = await Staff.create({
      staffId: await nextStaffId(),
      name: name.trim(),
      designation: String(designation || '').trim(),
      uid: cardUid,
      department: department._id,
    });
    refreshRoster();
    res.status(201).json({ member: await member.populate('department', 'name') });
  })
);

/**
 * One staff member's full history: every sign-in and sign-out, with the
 * department it was recorded under. ?from&to, both optional (all time).
 */
router.get(
  '/members/:id/history',
  asyncHandler(async (req, res) => {
    const member = await Staff.findById(req.params.id).populate('department', 'name');
    if (!member) return res.status(404).json({ error: 'That staff member does not exist.' });
    const day = {};
    if (req.query.from) day.$gte = req.query.from;
    if (req.query.to) day.$lte = req.query.to;
    const [rows, first] = await Promise.all([
      StaffAttendance.find({ staff: member._id, ...(req.query.from || req.query.to ? { day } : {}) })
        .populate('department', 'name')
        .sort({ time: -1 })
        .limit(5000),
      StaffAttendance.findOne({ staff: member._id }).sort({ time: 1 }),
    ]);
    res.json({
      member: {
        _id: member._id,
        staffId: member.staffId,
        name: member.name,
        designation: member.designation,
        uid: member.uid,
        department: member.department,
        firstSeen: first?.time || null,
      },
      rows: rows.map((r) => ({
        _id: r._id,
        day: r.day,
        time: r.time,
        outTime: r.outTime || null,
        department: r.department?.name || '—',
      })),
    });
  })
);

/** The staff ID never changes, including when someone moves department. */
router.patch(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const update = {};
    if (typeof req.body?.name === 'string') {
      if (!req.body.name.trim()) return res.status(400).json({ error: 'Enter the staff member’s name.' });
      update.name = req.body.name.trim();
    }
    if (typeof req.body?.designation === 'string') update.designation = req.body.designation.trim();
    if (req.body?.department) {
      const department = await Department.findById(req.body.department);
      if (!department) return res.status(400).json({ error: 'Choose a department.' });
      update.department = department._id;
    }
    const member = await Staff.findByIdAndUpdate(req.params.id, update, { new: true }).populate('department', 'name');
    if (!member) return res.status(404).json({ error: 'That staff member does not exist.' });
    res.json({ member });
  })
);

/** Removes the staff member and their register rows together. */
router.delete(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const member = await Staff.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ error: 'That staff member does not exist.' });
    await StaffAttendance.deleteMany({ staff: member._id });
    refreshRoster();
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- reports --

/**
 * Staff attendance as a PDF, in the same three layouts as the student reports:
 * one person (&member=id), one department (&department=id) or every department.
 * ?from&to, both optional: all time.
 */
router.get('/report', async (req, res, next) => {
  try {
    const { from, to, department, member } = req.query;
    const filter = { ...dayFilter(from, to) };
    const generated = `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`;
    const pdf = (filename, layout) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9.]+/gi, '-')}"`);
      const doc = newDoc(layout);
      doc.pipe(res);
      return doc;
    };
    const none = (doc) =>
      doc.font('Helvetica').fontSize(11).fillColor('#555').text('No attendance recorded for this period.');
    const total = (doc, text) => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(text);
    };
    const inOut = (r) => [clock(r.time), r.outTime ? clock(r.outTime) : '—', r.outTime ? duration(r.time, r.outTime) : '—'];

    // One staff member, like a student report.
    if (member) {
      const m = await Staff.findById(member).populate('department', 'name');
      if (!m) return res.status(404).json({ error: 'That staff member does not exist.' });
      const rows = await StaffAttendance.find({ staff: m._id, ...filter }).sort({ day: 1, time: 1 });
      const doc = pdf(`${m.staffId}-attendance.pdf`);
      drawHeading(doc, `${m.name} — ${m.staffId}`, [
        `Department: ${m.department?.name || '—'}${m.designation ? `  ·  ${m.designation}` : ''}`,
        `Period: ${periodLabel(from, to)}`,
        generated,
      ]);
      if (rows.length === 0) none(doc);
      else {
        drawTable(
          doc,
          [
            { label: 'Date', width: 155 },
            { label: 'In', width: 110 },
            { label: 'Out', width: 110 },
            { label: 'Duration', width: 110 },
          ],
          rows.map((r) => [dayLabel(r.day), ...inOut(r)])
        );
        total(doc, `Sessions attended: ${rows.length}`);
      }
      return doc.end();
    }

    // One department, like a batch report.
    if (department) {
      const d = await Department.findById(department);
      if (!d) return res.status(404).json({ error: 'That department does not exist.' });
      const rows = (
        await StaffAttendance.find({ department: d._id, ...filter })
          .populate('staff', 'staffId name')
          .sort({ day: 1, time: 1 })
      ).filter((r) => r.staff);
      const doc = pdf(`${d.name}-attendance.pdf`);
      drawHeading(doc, d.name, [`Period: ${periodLabel(from, to)}`, generated]);
      if (rows.length === 0) none(doc);
      else {
        drawTable(
          doc,
          [
            { label: 'Date', width: 80 },
            { label: 'Staff ID', width: 105 },
            { label: 'Name', width: 140 },
            { label: 'In', width: 65 },
            { label: 'Out', width: 65 },
            { label: 'Duration', width: 60 },
          ],
          rows.map((r) => [dayLabel(r.day), r.staff.staffId, r.staff.name, ...inOut(r)])
        );
        const people = new Set(rows.map((r) => String(r.staff._id)));
        total(doc, `Sessions attended: ${rows.length}  ·  Staff who attended: ${people.size}`);
      }
      return doc.end();
    }

    // Every department, like the all-batches report.
    const rows = (
      await StaffAttendance.find(filter)
        .populate('staff', 'staffId name')
        .populate('department', 'name')
        .sort({ day: 1, department: 1, time: 1 })
    ).filter((r) => r.staff && r.department);
    const doc = pdf('all-departments-attendance.pdf', 'landscape');
    drawHeading(doc, 'All departments', [`Period: ${periodLabel(from, to)}`, generated]);
    if (rows.length === 0) none(doc);
    else {
      drawTable(
        doc,
        [
          { label: 'Date', width: 90 },
          { label: 'Department', width: 170 },
          { label: 'Staff ID', width: 120 },
          { label: 'Name', width: 150 },
          { label: 'In', width: 75 },
          { label: 'Out', width: 75 },
          { label: 'Duration', width: 75 },
        ],
        rows.map((r) => [dayLabel(r.day), r.department.name, r.staff.staffId, r.staff.name, ...inOut(r)])
      );
      const people = new Set(rows.map((r) => String(r.staff._id)));
      const deps = new Set(rows.map((r) => String(r.department._id)));
      total(
        doc,
        `Sessions attended: ${rows.length}  ·  Staff who attended: ${people.size}  ·  Departments: ${deps.size}`
      );
    }
    doc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
