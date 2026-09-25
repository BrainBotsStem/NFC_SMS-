import { Counter } from './models.js';
import { nextStudentId, localDay, normaliseUid } from './ids.js';

let fail = 0;
const is = (got, want, label) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : `  (wanted ${want})`}`);
};

// Stub the atomic counter so we can check ID formatting at boundaries.
let seq;
Counter.findOneAndUpdate = async () => ({ seq });

seq = 101; is(await nextStudentId('EL'), 'Bb/EL/26/0101', 'first Elementary');
seq = 102; is(await nextStudentId('EL'), 'Bb/EL/26/0102', 'second Elementary');
seq = 117; is(await nextStudentId('EL'), 'Bb/EL/26/0117', 'Elementary 02 continues the level run');
seq = 199; is(await nextStudentId('IL'), 'Bb/IL/26/0199', 'Intermediate at 199');
seq = 200; is(await nextStudentId('IL'), 'Bb/IL/26/0200', 'rolls past 199');
seq = 101; is(await nextStudentId('AL'), 'Bb/AL/26/0101', 'Advanced Level restarts');

// Colombo is UTC+5:30, so late-evening UTC is already the next local day.
is(localDay(new Date('2026-09-18T19:30:00Z')), '2026-09-19', 'evening UTC rolls to next Colombo day');
is(localDay(new Date('2026-09-18T18:29:00Z')), '2026-09-18', 'just before the rollover');
is(localDay(new Date('2026-09-18T02:15:00Z')), '2026-09-18', 'morning UTC, same Colombo day');

is(normaliseUid('a4:2b:9f:01'), 'A42B9F01', 'uid strips separators and uppercases');
is(normaliseUid(''), '', 'empty uid stays empty');

console.log(fail ? `\n${fail} failing` : '\nall passing');
process.exit(fail ? 1 : 0);
