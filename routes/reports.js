import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { Student, Batch, Attendance } from '../models.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { clock, dayLabel, duration } from '../lib/format.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const ROW_HEIGHT = 22;

export function newDoc(layout = 'portrait') {
  return new PDFDocument({ size: 'A4', margin: 40, layout });
}

export function periodLabel(from, to) {
  if (!from && !to) return 'All time';
  return `${from ? dayLabel(from) : 'the start'} to ${to ? dayLabel(to) : 'today'}`;
}

export function drawHeading(doc, title, lines) {
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0b1b3a').text('BrainBots STEM Academy');
  doc.font('Helvetica').fontSize(10).fillColor('#666').text('Attendance report');
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(title);
  doc.font('Helvetica').fontSize(10).fillColor('#444');
  lines.forEach((l) => doc.text(l));
  doc.moveDown(0.8);
}

/** Simple paginating table. columns: [{label, width, align}], rows: string[][]. */
export function drawTable(doc, columns, rows) {
  const startX = doc.page.margins.left;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  const cellOpts = (c) => ({
    width: c.width - 8,
    align: c.align || 'left',
    lineBreak: false,
    ellipsis: true,
  });

  function header(y) {
    doc.rect(startX, y, tableWidth, ROW_HEIGHT).fill('#1c2f5e');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
    let x = startX;
    columns.forEach((c) => {
      doc.text(c.label, x + 4, y + 7, cellOpts(c));
      x += c.width;
    });
    return y + ROW_HEIGHT;
  }

  let y = header(doc.y);

  rows.forEach((row, i) => {
    if (y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = header(doc.y);
    }
    if (i % 2 === 1) {
      doc.rect(startX, y, tableWidth, ROW_HEIGHT).fill('#f2f4f9');
    }
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    let x = startX;
    columns.forEach((c, ci) => {
      doc.text(String(row[ci] ?? ''), x + 4, y + 7, cellOpts(c));
      x += c.width;
    });
    y += ROW_HEIGHT;
  });

  // .text() with explicit x/y leaves the cursor at the last cell drawn, so
  // flowing text right after the table (the totals line) would otherwise
  // start from the last column's x and wrap in a sliver at the page edge.
  doc.x = startX;
  doc.y = y + 10;
}

export function dayFilter(from, to) {
  if (!from && !to) return {};
  const day = {};
  if (from) day.$gte = from;
  if (to) day.$lte = to;
  return { day };
}

/** One student's attendance for a period (or all time), as a PDF. */
router.get('/student/:id', async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id).populate('batch', 'name');
    if (!student) return res.status(404).json({ error: 'That student does not exist.' });

    const { from, to } = req.query;
    const rows = await Attendance.find({ student: student._id, ...dayFilter(from, to) }).sort({
      day: 1,
      time: 1,
    });

    const filename = `${student.studentId.replace(/[^a-z0-9]+/gi, '-')}-attendance.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = newDoc();
    doc.pipe(res);

    drawHeading(doc, `${student.name} — ${student.studentId}`, [
      `Batch: ${student.batch?.name || '—'}`,
      `Period: ${periodLabel(from, to)}`,
      `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`,
    ]);

    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#555').text('No attendance recorded for this period.');
    } else {
      drawTable(
        doc,
        [
          { label: 'Date', width: 155 },
          { label: 'In', width: 110 },
          { label: 'Out', width: 110 },
          { label: 'Duration', width: 110 },
        ],
        rows.map((r) => [
          dayLabel(r.day),
          clock(r.time),
          r.outTime ? clock(r.outTime) : '—',
          r.outTime ? duration(r.time, r.outTime) : '—',
        ])
      );
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(`Classes attended: ${rows.length}`);
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

/** A whole batch's attendance for a period (or all time), as a PDF. */
router.get('/batch/:id', async (req, res, next) => {
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: 'That batch does not exist.' });

    const { from, to } = req.query;
    const rows = await Attendance.find({ batch: batch._id, ...dayFilter(from, to) })
      .populate('student', 'studentId name')
      .sort({ day: 1, time: 1 });
    const known = rows.filter((r) => r.student);

    const filename = `${batch.name.replace(/[^a-z0-9]+/gi, '-')}-attendance.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = newDoc();
    doc.pipe(res);

    drawHeading(doc, batch.name, [
      `Period: ${periodLabel(from, to)}`,
      `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`,
    ]);

    if (known.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#555').text('No attendance recorded for this period.');
    } else {
      drawTable(
        doc,
        [
          { label: 'Date', width: 80 },
          { label: 'Student ID', width: 105 },
          { label: 'Name', width: 140 },
          { label: 'In', width: 65 },
          { label: 'Out', width: 65 },
          { label: 'Duration', width: 60 },
        ],
        known.map((r) => [
          dayLabel(r.day),
          r.student.studentId,
          r.student.name,
          clock(r.time),
          r.outTime ? clock(r.outTime) : '—',
          r.outTime ? duration(r.time, r.outTime) : '—',
        ])
      );
      const uniqueStudents = new Set(known.map((r) => String(r.student._id)));
      doc.moveDown(0.5);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111')
        .text(`Classes attended: ${known.length}  ·  Students who attended: ${uniqueStudents.size}`);
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

/** Every batch's attendance for a period (or all time), as one combined PDF. */
router.get('/all', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const rows = await Attendance.find(dayFilter(from, to))
      .populate('student', 'studentId name')
      .populate('batch', 'name')
      .sort({ day: 1, batch: 1, time: 1 });
    const known = rows.filter((r) => r.student && r.batch);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="all-batches-attendance.pdf"');

    // Landscape: this table has the most columns and the batch names are the
    // longest field ("Advanced Level Batch 01"), so portrait's narrower width
    // was truncating things.
    const doc = newDoc('landscape');
    doc.pipe(res);

    drawHeading(doc, 'All batches', [
      `Period: ${periodLabel(from, to)}`,
      `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`,
    ]);

    if (known.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#555').text('No attendance recorded for this period.');
    } else {
      drawTable(
        doc,
        [
          { label: 'Date', width: 90 },
          { label: 'Batch', width: 170 },
          { label: 'Student ID', width: 120 },
          { label: 'Name', width: 150 },
          { label: 'In', width: 75 },
          { label: 'Out', width: 75 },
          { label: 'Duration', width: 75 },
        ],
        known.map((r) => [
          dayLabel(r.day),
          r.batch.name,
          r.student.studentId,
          r.student.name,
          clock(r.time),
          r.outTime ? clock(r.outTime) : '—',
          r.outTime ? duration(r.time, r.outTime) : '—',
        ])
      );
      const uniqueStudents = new Set(known.map((r) => String(r.student._id)));
      const uniqueBatches = new Set(known.map((r) => String(r.batch._id)));
      doc.moveDown(0.5);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111')
        .text(
          `Classes attended: ${known.length}  ·  Students who attended: ${uniqueStudents.size}  ·  Batches: ${uniqueBatches.size}`
        );
    }

    doc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
