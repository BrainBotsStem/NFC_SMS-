import { Notification } from './models.js';
import { config } from './config.js';
import { localDay } from './ids.js';
import { emit } from './realtime.js';

/*
 * Text messages to parents: "arrived" when a student taps in, "left" when they
 * tap out.
 *
 * Every message is first written to the Notification collection as pending,
 * and a small worker sends pending rows. So a message survives a server
 * restart, a failed send is retried, and the dashboard can list every message
 * with what happened to it.
 *
 * NOTIFY_MODE=daily (the default) keeps it to what a parent needs. A batch can
 * have several classes a day, and a message per class tap would be noise:
 *   - "arrived" goes on the first in tap, and again only if the parent was
 *     already told the child left.
 *   - "left" waits NOTIFY_OUT_DELAY_MINUTES. If the student taps in for the
 *     next class before then, it is cancelled; it was only a break.
 * NOTIFY_MODE=every sends one message for every in and every out tap.
 */

const n = config.notify;
const MAX_ATTEMPTS = 3;
const POLL_MS = 15_000;

// ------------------------------------------------------------------ phones --

/**
 * A parent's mobile as international digits, "94771234567".
 * Accepts 077 123 4567, 0771234567, 771234567, +94 77 123 4567, 0094...
 * Returns '' for an empty value and null for one that cannot be a phone number.
 */
export function normalisePhone(raw, countryCode = n.countryCode) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let d = text.replace(/\D/g, '');
  if (!text.startsWith('+')) {
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = countryCode + d.slice(1);
    else if (!(d.startsWith(countryCode) && d.length > countryCode.length + 8)) d = countryCode + d;
  }
  if (d.length < 8 || d.length > 15) return null;
  // Sri Lankan mobiles are 94 7X XXX XXXX. Landlines cannot receive a text.
  if (d.startsWith('94') && !/^947\d{8}$/.test(d)) return null;
  return d;
}

// ---------------------------------------------------------------- messages --

function timeOf(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** "24 Sep". Built from parts: en-GB spells September "Sept". */
function dateOf(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, day: 'numeric', month: 'short' })
    .formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('day')} ${part('month')}`;
}

/** Fills {centre} {name} {id} {batch} {time} {date} in a template. Unknown names are left as they are. */
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all));
}

export function messageFor(kind, student, at) {
  return fillTemplate(kind === 'in' ? n.templateIn : n.templateOut, {
    centre: n.centreName,
    name: student.name,
    id: student.studentId,
    batch: student.batch?.name || '',
    time: timeOf(at),
    date: dateOf(at),
  });
}

// --------------------------------------------------------------- providers --

const providers = {
  // Writes the message to the server log instead of sending it. For trying the
  // feature out without an SMS account or cost.
  async console(phone, message) {
    console.log(`[sms] (console, not sent) to +${phone}: ${message}`);
  },

  // Notify.lk, a Sri Lankan SMS gateway. https://developer.notify.lk
  async notifylk(phone, message) {
    const { userId, apiKey, senderId } = n.notifylk;
    const url = new URL('https://app.notify.lk/api/v1/send');
    url.search = new URLSearchParams({ user_id: userId, api_key: apiKey, sender_id: senderId, to: phone, message });
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'success') {
      const why = body.message || body.errors || body.data || `HTTP ${res.status}`;
      throw new Error(`Notify.lk: ${typeof why === 'string' ? why : JSON.stringify(why)}`);
    }
  },
};

/** Why messages cannot be sent right now, or '' when they can. */
export function notifyProblem() {
  if (n.provider === 'off') return 'Parent messages are turned off (NOTIFY_PROVIDER=off).';
  if (!providers[n.provider]) return `Unknown NOTIFY_PROVIDER "${n.provider}". Use off, console or notifylk.`;
  if (n.provider === 'notifylk' && (!n.notifylk.userId || !n.notifylk.apiKey)) {
    return 'Notify.lk needs NOTIFYLK_USER_ID and NOTIFYLK_API_KEY in .env.';
  }
  return '';
}

export function notifySettings() {
  return {
    provider: n.provider,
    mode: n.mode === 'every' ? 'every' : 'daily',
    outDelayMinutes: Math.round(n.outDelayMs / 60000),
    maxLateMinutes: Math.round(n.maxLateMs / 60000),
    problem: notifyProblem(),
  };
}

// ------------------------------------------------------------- the queue --

const wants = (student) => n.provider !== 'off' && student.notifyParent !== false && !!student.parentPhone;
const tooLate = (at, allowance = 0) => Date.now() - at > n.maxLateMs + allowance;

async function queue(student, kind, at, sendAfter) {
  const row = await Notification.create({
    student: student._id,
    kind,
    phone: student.parentPhone,
    message: messageFor(kind, student, at),
    day: localDay(at),
    tapTime: at,
    status: tooLate(at) ? 'skipped' : 'pending',
    error: tooLate(at) ? 'The tap reached the server too late (the reader was offline).' : '',
    sendAfter,
  });
  if (row.status === 'pending' && sendAfter <= new Date()) kick();
  announce(row, student);
  return row;
}

/**
 * Called for every in tap that was recorded. Awaited by the tap handler, so a
 * student's taps are dealt with strictly in order.
 */
export async function notifyIn(student, at) {
  if (!wants(student)) return;
  if (n.mode !== 'every') {
    // A "left" message still waiting means the parent was never told the
    // child left, so there is nothing to tell them now either.
    const cancelled = await Notification.updateMany(
      { student: student._id, kind: 'out', status: 'pending' },
      { status: 'cancelled', error: 'Came back for the next class before the message was due.' }
    );
    if (cancelled.modifiedCount) return;
    const last = await Notification.findOne({
      student: student._id,
      day: localDay(at),
      kind: { $in: ['in', 'out'] },
      status: { $in: ['pending', 'sending', 'sent'] },
    }).sort({ createdAt: -1 });
    if (last?.kind === 'in') return; // the parent already knows the child is here
  }
  await queue(student, 'in', at, new Date());
}

/** Called for every out tap that was recorded. */
export async function notifyOut(student, at) {
  if (!wants(student)) return;
  if (n.mode === 'every') return queue(student, 'out', at, new Date());
  // Wait, in case this is only a break between classes. At least 30 seconds,
  // so a reader replaying its offline backlog gets to the next in tap first.
  const sendAfter = new Date(Math.max(at.getTime() + n.outDelayMs, Date.now() + 30_000));
  await queue(student, 'out', at, sendAfter);
}

/** Tells the dashboards a message changed, so the Messages page stays current. */
function announce(row, student) {
  emit(
    'notify:update',
    {
      _id: row._id,
      kind: row.kind,
      status: row.status,
      error: row.error,
      name: student?.name || '',
    },
    'admin'
  );
}

async function deliver(row) {
  const problem = notifyProblem();
  // A test message is sent at once; a tap message that sat too long is stale.
  const allowance = row.kind === 'out' && n.mode !== 'every' ? n.outDelayMs : 0;
  if (row.kind !== 'test' && !row.manual && row.tapTime && tooLate(row.tapTime, allowance)) {
    row.status = 'skipped';
    row.error = 'Not sent in time (the server was down or the reader was offline).';
  } else {
    try {
      if (problem) throw new Error(problem);
      await providers[n.provider](row.phone, row.message);
      row.status = 'sent';
      row.sentAt = new Date();
      row.provider = n.provider;
      row.error = '';
    } catch (err) {
      row.error = err.name === 'TimeoutError' ? 'The SMS service did not answer in time.' : err.message;
      row.provider = n.provider;
      if (row.attempts < MAX_ATTEMPTS && row.kind !== 'test') {
        row.status = 'pending';
        row.sendAfter = new Date(Date.now() + row.attempts * 60_000); // 1, then 2 minutes
      } else {
        row.status = 'failed';
      }
    }
  }
  await row.save();
  if (row.status !== 'pending') {
    console.log(`[sms] ${row.kind} to +${row.phone}: ${row.status}${row.error ? ` (${row.error})` : ''}`);
  }
  const populated = row.student ? await row.populate('student', 'name') : row;
  announce(row, populated.student);
  return row;
}

let running = false;
let again = false;

async function runQueue() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      for (let i = 0; i < 50; i++) {
        // Claimed atomically, so a message is never sent twice.
        const row = await Notification.findOneAndUpdate(
          { status: 'pending', sendAfter: { $lte: new Date() } },
          { status: 'sending', $inc: { attempts: 1 } },
          { sort: { sendAfter: 1 }, new: true }
        );
        if (!row) break;
        await deliver(row);
      }
    } while (again);
  } catch (err) {
    console.error('[sms] queue failed:', err.message);
  } finally {
    running = false;
  }
}

function kick() {
  setImmediate(runQueue);
}

export async function startNotifier() {
  const problem = notifyProblem();
  if (n.provider === 'off') {
    console.log('[sms] parent messages are off');
    return;
  }
  if (problem) console.warn(`[sms] ${problem}`);
  else console.log(`[sms] parent messages on: ${n.provider}, ${n.mode === 'every' ? 'every tap' : 'daily'} mode`);
  // A message that was mid-send when the server stopped goes back in the queue.
  await Notification.updateMany({ status: 'sending' }, { status: 'pending' });
  setInterval(runQueue, POLL_MS).unref();
  kick();
}

/** Sends one test message straight away and returns the row with the result. */
export async function sendTest(phone) {
  const row = await Notification.create({
    kind: 'test',
    phone,
    message: `${n.centreName}: this is a test message from the attendance system.`,
    status: 'sending',
    attempts: 1,
  });
  return deliver(row);
}

/** Puts a failed or late message back in the queue, to be sent however old it is. */
export async function retry(id) {
  const row = await Notification.findOneAndUpdate(
    { _id: id, status: { $in: ['failed', 'skipped'] }, kind: { $ne: 'test' } },
    { status: 'pending', attempts: 0, sendAfter: new Date(), error: '', manual: true },
    { new: true }
  );
  if (row) kick();
  return row;
}
