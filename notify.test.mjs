import { normalisePhone, fillTemplate, messageFor } from './notify.js';

let fail = 0;
const is = (got, want, label) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : `  (wanted ${want})`}`);
};

// Every way a parent's Sri Lankan mobile gets typed ends up the same.
is(normalisePhone('077 123 4567'), '94771234567', 'local with spaces');
is(normalisePhone('0771234567'), '94771234567', 'local');
is(normalisePhone('771234567'), '94771234567', 'without the leading 0');
is(normalisePhone('+94 77 123 4567'), '94771234567', 'international with +');
is(normalisePhone('94771234567'), '94771234567', 'international without +');
is(normalisePhone('0094771234567'), '94771234567', 'international with 00');
is(normalisePhone('077-123-4567'), '94771234567', 'dashes');
is(normalisePhone(''), '', 'empty stays empty');
is(normalisePhone(undefined), '', 'missing stays empty');
is(normalisePhone('0112345678'), null, 'landline refused (cannot get a text)');
is(normalisePhone('07712345'), null, 'too short');
is(normalisePhone('abc'), null, 'not a number');
is(normalisePhone('+44 7700 900123'), '447700900123', 'a foreign mobile with + is kept');

is(fillTemplate('{name} at {time}', { name: 'Priya', time: '9:05 AM' }), 'Priya at 9:05 AM', 'template fills');
is(fillTemplate('{name} {unknown}', { name: 'Priya' }), 'Priya {unknown}', 'unknown placeholder left alone');

// 03:35 UTC is 9:05 AM in Colombo.
const student = { name: 'Priya', studentId: 'Bb/EL/26/0101', batch: { name: 'Elementary Batch 01' } };
const at = new Date('2026-09-24T03:35:00Z');
is(
  messageFor('in', student, at),
  'BrainBots: Priya (Bb/EL/26/0101) arrived at 9:05 AM on 24 Sep. Elementary Batch 01.',
  'arrived message'
);
is(messageFor('out', student, at), 'BrainBots: Priya (Bb/EL/26/0101) left at 9:05 AM on 24 Sep.', 'left message');
is(messageFor('in', student, at).length <= 160, true, 'fits in one SMS');

console.log(fail ? `\n${fail} failing` : '\nall passing');
process.exit(fail ? 1 : 0);
