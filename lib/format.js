const TZ = 'Asia/Colombo';

export function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** The local day (YYYY-MM-DD) n days before today. */
export function daysAgo(n) {
  const [y, m, d] = today().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** "2h 15m" between two timestamps. */
export function duration(fromIso, toIso) {
  const mins = Math.max(0, Math.round((new Date(toIso) - new Date(fromIso)) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "Nimal Perera" -> "NP". */
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

/** A stable hue (0-359) for a name, used to colour its avatar. */
export function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Each level gets its own colour family; batches within a level are shades apart.
const LEVEL_HUES = {
  Elementary: [150, 178],
  Intermediate: [208, 232, 258, 284],
  Advanced: [18, 44],
};

/** The colour (hue) for a batch, so it looks the same on every page. */
export function batchHue(name = '') {
  const level = Object.keys(LEVEL_HUES).find((l) => name.startsWith(l));
  if (!level) return hue(name);
  const n = parseInt(name.match(/(\d+)\s*$/)?.[1] ?? '1', 10);
  const list = LEVEL_HUES[level];
  return list[(Math.max(n, 1) - 1) % list.length];
}

/** "94771234567" -> "+94 77 123 4567". Other countries just get a +. */
export function formatPhone(digits) {
  if (!digits) return '';
  const m = String(digits).match(/^94(\d{2})(\d{3})(\d{4})$/);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : `+${digits}`;
}

/** The local day (YYYY-MM-DD) a timestamp falls on. */
export function dayOf(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
