import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // admin runs the student side, staffadmin the staff side, and each sees only
    // its own. superadmin runs both.
    role: { type: String, enum: ['admin', 'staffadmin', 'superadmin'], required: true },
  },
  { timestamps: true }
);

const batchSchema = new Schema({
  name: { type: String, required: true, unique: true }, // "Elementary 01"
  level: { type: String, enum: ['EL', 'IL', 'AL'], required: true },
  order: { type: Number, required: true }, // display order
});

const studentSchema = new Schema(
  {
    studentId: { type: String, required: true, unique: true }, // Bb/EL/26/0101
    name: { type: String, required: true, trim: true },
    uid: { type: String, required: true, unique: true }, // card UID, uppercase hex
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
  },
  { timestamps: true }
);

const attendanceSchema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  // Batch is copied in so a past record still shows the batch the student was in
  // at the time, even if they are moved later.
  batch: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
  day: { type: String, required: true, index: true }, // "YYYY-MM-DD" in local time
  time: { type: Date, required: true }, // in time
  outTime: { type: Date, default: null }, // set by a later tap, null until then
});

attendanceSchema.index({ student: 1, time: -1 });
attendanceSchema.index({ batch: 1, day: -1 });

// ------------------------------------------------------------------ staff --
// Staff tap the same reader as students. A department groups staff the way a
// batch groups students.

const departmentSchema = new Schema({
  name: { type: String, required: true, unique: true }, // "Teachers"
  order: { type: Number, required: true }, // display order
});

const staffSchema = new Schema(
  {
    staffId: { type: String, required: true, unique: true }, // Bb/ST/0101
    name: { type: String, required: true, trim: true },
    designation: { type: String, default: '', trim: true }, // "Robotics teacher"
    uid: { type: String, required: true, unique: true }, // card UID, uppercase hex
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  },
  { timestamps: true }
);

// One row per sign-in, exactly like students: a tap signs in, the next tap
// signs out, and a later tap signs in again the same day.
const staffAttendanceSchema = new Schema({
  staff: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
  department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
  day: { type: String, required: true, index: true }, // "YYYY-MM-DD" in local time
  time: { type: Date, required: true }, // in time
  outTime: { type: Date, default: null },
});

staffAttendanceSchema.index({ staff: 1, time: -1 });

// Taps stored on a reader are replayed until acknowledged. This remembers which
// ones the server already handled, so a replay never records a tap twice.
const processedTapSchema = new Schema({
  eventId: { type: String, required: true, unique: true }, // "reader1:1a2b3c4d-17"
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

// Atomic per-level sequence for student IDs.
const counterSchema = new Schema({
  _id: String, // "EL-26"
  seq: { type: Number, default: 100 },
});

export const User = model('User', userSchema);
export const Batch = model('Batch', batchSchema);
export const Student = model('Student', studentSchema);
export const Attendance = model('Attendance', attendanceSchema);
export const Counter = model('Counter', counterSchema);
export const ProcessedTap = model('ProcessedTap', processedTapSchema);
export const Department = model('Department', departmentSchema);
export const Staff = model('Staff', staffSchema);
export const StaffAttendance = model('StaffAttendance', staffAttendanceSchema);
