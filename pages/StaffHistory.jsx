import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { clock, dayLabel, daysAgo, duration, hue, today } from '../lib/format.js';
import { Avatar, Empty, Icon, SkeletonRows } from '../components/ui.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

const RANGES = [
  { key: 'all', label: 'All time', from: '', to: '' },
  { key: 'today', label: 'Today', from: () => today(), to: () => today() },
  { key: 'week', label: 'Last 7 days', from: () => daysAgo(6), to: () => today() },
  { key: 'month', label: 'Last 30 days', from: () => daysAgo(29), to: () => today() },
];

const val = (v) => (typeof v === 'function' ? v() : v);

/** "1h 12m" for a number of milliseconds. */
function spent(ms) {
  return duration(new Date(0).toISOString(), new Date(ms).toISOString());
}

/** Everything one staff member has signed in for: each day, and each sign-in within it. */
export default function StaffHistory() {
  const { id } = useParams();
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reload, setReload] = useState(0);
  usePageTitle(data?.member.name);

  const picked = RANGES.find((r) => r.key === range);
  const from = val(picked.from);
  const to = val(picked.to);

  useEffect(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    api(`/staff/members/${id}/history?${params}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, from, to, reload]);

  // A tap by this staff member refreshes the page, so an open history stays live.
  const staffId = data?.member.staffId;
  useEffect(() => {
    if (!staffId) return;
    const socket = getSocket();
    const onTap = (row) => row.staffId === staffId && setReload((n) => n + 1);
    socket.on('staff:in', onTap);
    socket.on('staff:out', onTap);
    return () => {
      socket.off('staff:in', onTap);
      socket.off('staff:out', onTap);
    };
  }, [staffId]);

  // Rows come newest first; each day lists its sign-ins in the order they happened.
  const days = useMemo(() => {
    if (!data) return [];
    const byDay = new Map();
    for (const r of data.rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, []);
      byDay.get(r.day).push(r);
    }
    return [...byDay].map(([day, rows]) => {
      const classes = [...rows].reverse();
      const ms = classes.reduce((sum, r) => sum + (r.outTime ? new Date(r.outTime) - new Date(r.time) : 0), 0);
      return { day, classes, ms, groups: [...new Set(classes.map((c) => c.department))] };
    });
  }, [data]);

  if (error) return <div className="error">{error}</div>;

  const member = data?.member;
  const todayStr = today();
  const totalMs = days.reduce((sum, d) => sum + d.ms, 0);
  const classCount = data ? data.rows.length : 0;
  const last = data?.rows[0];

  return (
    <>
      <Link to={member?.department ? `/department/${member.department._id}` : '/departments'} className="back">
        <Icon name="chev-left" /> Back to {member?.department?.name || 'departments'}
      </Link>

      <div className="hero" style={{ '--h': member?.department ? hue(member.department.name) : 220 }}>
        {member ? <Avatar name={member.name} /> : <span className="card-icon"><Icon name="users" /></span>}
        <div className="hero-title">
          <h1>{member ? member.name : 'Loading…'}</h1>
          {member && (
            <p className="sub history-meta">
              <span className="num">{member.staffId}</span>
              {member.designation && <span>{member.designation}</span>}
              <span className="batch-chip" style={{ '--h': hue(member.department?.name || '') }}>
                {member.department?.name || 'No department'}
              </span>
              <span className="num">Card {member.uid}</span>
              {member.firstSeen && <span>First session {dayLabel(todayStrOf(member.firstSeen))}</span>}
            </p>
          )}
        </div>
        {member && (
          <button type="button" className="btn quiet" onClick={() => setReporting(true)}>
            Staff report
          </button>
        )}
      </div>

      <div className="stat-tiles history-stats">
        <div className="stat-tile static">
          <span className="stat-top">
            <span className="stat-icon">
              <Icon name="check" />
            </span>
            <span className="stat-label">Days attended</span>
          </span>
          <span className="stat-value num">
            <strong>{data ? days.length : '–'}</strong>
          </span>
          <span className="stat-foot">{picked.label.toLowerCase()}</span>
        </div>
        <div className="stat-tile static in">
          <span className="stat-top">
            <span className="stat-icon">
              <Icon name="layers" />
            </span>
            <span className="stat-label">Sessions attended</span>
          </span>
          <span className="stat-value num">
            <strong>{data ? classCount : '–'}</strong>
          </span>
          <span className="stat-foot">
            {days.length ? `${(classCount / days.length).toFixed(1).replace(/\.0$/, '')} a day on average` : ' '}
          </span>
        </div>
        <div className="stat-tile static absent">
          <span className="stat-top">
            <span className="stat-icon">
              <Icon name="clock" />
            </span>
            <span className="stat-label">Time on site</span>
          </span>
          <span className="stat-value num">
            <strong>{data ? (totalMs ? spent(totalMs) : '0m') : '–'}</strong>
          </span>
          <span className="stat-foot">
            {last ? `Last seen ${last.day === todayStr ? 'today' : dayLabel(last.day)} ${clock(last.outTime || last.time)}` : ' '}
          </span>
        </div>
      </div>

      <div className="controls">
        <div className="chips" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`chip ${range === r.key ? 'on' : ''}`}
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <SkeletonRows rows={4} />
      ) : days.length === 0 ? (
        <Empty
          icon="inbox"
          title={range === 'all' ? 'No sessions recorded yet.' : 'No sessions in this period.'}
          hint={range === 'all' ? 'Sessions appear here as soon as the card is tapped.' : 'Try All time.'}
        />
      ) : (
        days.map((d) => (
          <section key={d.day} className="day-group">
            <div className="list-head">
              <h2>{d.day === todayStr ? `Today · ${dayLabel(d.day)}` : dayLabel(d.day)}</h2>
              <span className="list-count num">
                {d.classes.length} {d.classes.length === 1 ? 'session' : 'sessions'}
              </span>
              {d.ms > 0 && <span className="day-time num">{spent(d.ms)} on site</span>}
              {d.groups.some((g) => g !== member.department?.name) && (
                <span className="day-time">Recorded under {d.groups.join(', ')}</span>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>In</th>
                    <th>Out</th>
                    <th className="hide-sm">Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.classes.map((c, i) => (
                    <tr key={c._id}>
                      <td>
                        <span className="class-tag num">Session {i + 1}</span>
                      </td>
                      <td className="time num">{clock(c.time)}</td>
                      <td className="time num">{c.outTime ? clock(c.outTime) : '—'}</td>
                      <td className="code num hide-sm">{c.outTime ? duration(c.time, c.outTime) : '—'}</td>
                      <td>
                        {c.outTime ? (
                          <span className="pill left">Done</span>
                        ) : c.day === todayStr ? (
                          <span className="pill in">In now</span>
                        ) : (
                          <span className="pill none">No out tap</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {reporting && member && (
        <ReportModal side="staff" kind="student" id={member._id} label={member.name} onClose={() => setReporting(false)} />
      )}
    </>
  );
}

/** The local day (YYYY-MM-DD) of a timestamp, for dayLabel. */
function todayStrOf(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
