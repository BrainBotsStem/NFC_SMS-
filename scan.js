import { Student, Attendance, Staff, StaffAttendance } from './models.js';
import { config } from './config.js';
import { localDay, normaliseUid } from './ids.js';
import { emit } from './realtime.js';
import { notifyIn, notifyOut } from './notify.js';

/**
 * Enrolment is a short-lived server-side state. While the window is open the
 * reader is told (see setEnrolListener), and sends every tap to the server live
 * instead of judging it from its own copy of the roster.
 */
const enrol = { active: false, expiresAt: 0, room: null }; // room: the side that asked
let enrolListener = () => {};

/** Called with { open, secs } whenever the enrolment window opens or closes. */
export function setEnrolListener(fn) {
  enrolListener = fn;
}

/** room: "admin" (adding a student) or "staffadmin" (adding staff), so only that side hears the card. */
export function startEnrol(room) {
  enrol.active = true;
  enrol.room = room;
  enrol.expiresAt = Date.now() + config.enrollWindowMs;
  enrolListener({ open: true, secs: Math.round(config.enrollWindowMs / 1000) });
  return { expiresAt: enrol.expiresAt };
}

export function cancelEnrol() {
  enrol.active = false;
  enrol.expiresAt = 0;
  enrolListener({ open: false });
}

function enrolIsOpen() {
  if (!enrol.active) return false;
  if (Date.now() > enrol.expiresAt) {
    cancelEnrol();
    emit('enrol:timeout', {}, enrol.room);
    return false;
  }
  return true;
}

/** One line per tap in the server log, so a tap that seems lost can be traced. */
function logTap(who, what, at) {
  const time = at.toLocaleTimeString('en-GB', { timeZone: config.timezone });
  // The reader sends every tap through its store; only a real delay is worth noting.
  const late = Math.round((Date.now() - at) / 1000);
  console.log(`[tap] ${time} ${who}: ${what}${late > 30 ? ` (arrived ${late}s late, the reader was offline)` : ''}`);
}

/**
 * Handle one card read.
 *
 * live = true  the tap just happened: it may be an enrolment, and an unknown
 *              card is reported to the dashboard.
 * live = false the tap was stored on the reader while it was offline and is
 *              being replayed. `at` is when the card was really tapped, so the
 *              in and out times come out the same as if the network had been up.
 *
 * Returns 'ok'   -> green LED + one beep
 *         'deny' -> red LED + three beeps
 */
export async function handleScan({ uid, deviceId, at, live = true }) {
  const cardUid = normaliseUid(uid);
  if (!cardUid) return 'deny';

  const student = await Student.findOne({ uid: cardUid }).populate('batch');
  const staff = student ? null : await Staff.findOne({ uid: cardUid }).populate('department');

  if (live && enrolIsOpen()) {
    const owner = student || staff;
    if (owner) {
      // Admin is trying to enrol a card that already belongs to someone.
      emit(
        'enrol:taken',
        { uid: cardUid, code: owner.studentId || owner.staffId, name: owner.name, kind: student ? 'student' : 'staff' },
        enrol.room
      );
      return 'deny';
    }
    const room = enrol.room;
    cancelEnrol();
    emit('enrol:card', { uid: cardUid }, room);
    return 'ok';
  }

  if (staff) return handleStaffTap(staff, at || new Date());

  if (!student) {
    logTap(`unknown card ${cardUid}`, 'refused', at || new Date());
    if (live) emit('scan:unknown', { uid: cardUid, deviceId, time: new Date() });
    return 'deny';
  }

  const now = at || new Date();
  const last = await Attendance.findOne({ student: student._id }).sort({ time: -1 });

  const log = (what) => logTap(student.name, what, now);

  // A replayed tap older than what is already recorded adds nothing.
  if (last && (last.outTime || last.time) > now) {
    log('ignored, older than the last recorded tap');
    return 'ok';
  }

  const age = last ? now - last.time : Infinity;

  // A batch has several classes a day, each an in tap then an out tap. A tap
  // soon after the out time is a double tap; a later one starts the next class.
  if (last?.outTime && now - last.outTime < config.minRejoinGapMs) {
    log(`ignored, double tap (under ${config.minRejoinGapMs / 1000}s after the out time)`);
    emit('scan:repeat', { studentId: student.studentId, name: student.name, firstTime: last.time }, 'admin');
    return 'ok';
  }

  if (last && !last.outTime && age <= config.visitWindowMs) {
    // Class in progress. The next tap at least minOutGapMs after the in time is
    // the out time; anything sooner is a double tap and is ignored.
    // The card is valid, so the student always gets the green light.
    if (age >= config.minOutGapMs) {
      // The outTime: null filter stops two near-simultaneous taps both writing.
      const updated = await Attendance.findOneAndUpdate(
        { _id: last._id, outTime: null },
        { outTime: now },
        { new: true }
      );
      if (updated) {
        log('out');
        emit('attendance:out', {
          _id: updated._id,
          batch: String(updated.batch),
          day: updated.day,
          outTime: updated.outTime,
          studentId: student.studentId,
          name: student.name,
        }, 'admin');
        await tellParent(notifyOut, student, now);
        return 'ok';
      }
    }

    log(`ignored, double tap (under ${config.minOutGapMs / 60000} min after the in time)`);
    emit('scan:repeat', {
      studentId: student.studentId,
      name: student.name,
      firstTime: last.time,
    }, 'admin');
    return 'ok';
  }

  log('in (new class)');
  const record = await Attendance.create({
    student: student._id,
    batch: student.batch._id,
    day: localDay(now),
    time: now,
  });

  emit('attendance:new', {
    _id: record._id,
    batch: String(student.batch._id),
    batchName: student.batch.name,
    day: record.day,
    time: record.time,
    outTime: null,
    studentId: student.studentId,
    name: student.name,
  }, 'admin');
  await tellParent(notifyIn, student, now);

  return 'ok';
}

/** A message to a parent must never stop a tap from being recorded or answered. */
async function tellParent(fn, student, at) {
  try {
    await fn(student, at);
  } catch (err) {
    console.error('[sms] could not queue a parent message:', err.message);
  }
}

/** What the staff dashboards are told about one day's row. */
function staffRow(row, staff) {
  return {
    _id: row._id,
    department: String(staff.department._id),
    departmentName: staff.department.name,
    day: row.day,
    time: row.time,
    outTime: row.outTime,
    staffId: staff.staffId,
    name: staff.name,
  };
}

/**
 * Staff taps follow the same rule as students: a tap signs in, the next tap at
 * least minOutGapMs later signs out, and a tap after that signs in again.
 */
async function handleStaffTap(staff, now) {
  const log = (what) => logTap(`${staff.name} (staff)`, what, now);
  const last = await StaffAttendance.findOne({ staff: staff._id }).sort({ time: -1 });

  // A replayed tap older than what is already recorded adds nothing.
  if (last && (last.outTime || last.time) > now) {
    log('ignored, older than the last recorded tap');
    return 'ok';
  }

  // Just after signing out: a double tap, not a new sign-in.
  if (last?.outTime && now - last.outTime < config.minRejoinGapMs) {
    log(`ignored, double tap (under ${config.minRejoinGapMs / 1000}s after the out time)`);
    emit('staff:repeat', { name: staff.name, firstTime: last.time }, 'staffadmin');
    return 'ok';
  }

  const age = last ? now - last.time : Infinity;
  if (last && !last.outTime && age <= config.visitWindowMs) {
    if (age >= config.minOutGapMs) {
      // The outTime: null filter stops two near-simultaneous taps both writing.
      const updated = await StaffAttendance.findOneAndUpdate(
        { _id: last._id, outTime: null },
        { outTime: now },
        { new: true }
      );
      if (updated) {
        log('out');
        emit('staff:out', staffRow(updated, staff), 'staffadmin');
        return 'ok';
      }
    }
    log(`ignored, double tap (under ${config.minOutGapMs / 60000} min after the in time)`);
    emit('staff:repeat', { name: staff.name, firstTime: last.time }, 'staffadmin');
    return 'ok';
  }

  const row = await StaffAttendance.create({
    staff: staff._id,
    department: staff.department._id,
    day: localDay(now),
    time: now,
  });
  log('in');
  emit('staff:in', staffRow(row, staff), 'staffadmin');
  return 'ok';
}
