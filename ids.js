import { Counter } from './models.js';
import { config } from './config.js';

/**
 * Next student ID for a level, e.g. Bb/EL/26/0101.
 *
 * The counter runs flat across the whole level, so Elementary 01 and
 * Elementary 02 draw from the same sequence. It starts at 101 (padded to
 * "0101"), so after 0199 the next ID is 0200.
 *
 * findOneAndUpdate with $inc is atomic, so two admins adding students at the
 * same moment cannot receive the same number.
 */
export async function nextStudentId(level) {
  const key = `${level}-${config.intakeYear}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const num = String(counter.seq).padStart(4, '0');
  return `Bb/${level}/${config.intakeYear}/${num}`;
}

/**
 * Next staff ID, e.g. Bb/ST/0101. One running number for all staff, with no
 * intake year: staff stay across years. Atomic, like the student IDs.
 */
export async function nextStaffId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'ST' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `Bb/ST/${String(counter.seq).padStart(4, '0')}`;
}

/** "YYYY-MM-DD" for a Date, in the centre's local timezone. */
export function localDay(date = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Card UIDs are compared as uppercase hex with no separators. */
export function normaliseUid(uid) {
  return String(uid || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
}
