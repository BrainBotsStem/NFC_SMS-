import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { batchHue, clock, dayLabel, daysAgo, duration, today } from '../lib/format.js';
import { Avatar, Empty, Icon, SkeletonRows } from '../components/ui.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

const RANGES = [
  { key: 'today', label: 'Today', from: () => today(), to: () => today() },
  { key: 'yesterday', label: 'Yesterday', from: () => daysAgo(1), to: () => daysAgo(1) },
  { key: 'week', label: 'Last 7 days', from: () => daysAgo(6), to: () => today() },
];

const VIEWS = [
  { key: 'total', label: 'Total students', icon: 'users' },
  { key: 'absent', label: 'Not came', icon: 'x' },
  { key: 'in', label: 'In class', icon: 'clock' },
];

export default function BatchDetail() {
  const { id } = useParams();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState([]);
  const [reporting, setReporting] = useState(false);
  const [view, setView] = useState('total');
  const navigate = useNavigate();
  usePageTitle(data?.batch.name);

  useEffect(() => {
    setData(null);
    api(`/batches/${id}/attendance?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, from, to]);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (row) => {
      if (row.batch !== id) return;
      if (row.day < from || row.day > to) return;
      setData((d) => (d ? { ...d, rows: [row, ...d.rows] } : d));
      setFresh((f) => [...f, row._id]);
    };
    const onOut = (row) => {
      if (row.batch !== id) return;
      setData((d) =>
        d
          ? { ...d, rows: d.rows.map((r) => (r._id === row._id ? { ...r, outTime: row.outTime } : r)) }
          : d
      );
      setFresh((f) => [...f, row._id]);
    };
    socket.on('attendance:new', onNew);
    socket.on('attendance:out', onOut);
    return () => {
      socket.off('attendance:new', onNew);
      socket.off('attendance:out', onOut);
    };
  }, [id, from, to]);

  const todayStr = today();
  const oneDay = from === to;
  const isToday = oneDay && from === todayStr;

  // Splits the batch into who did not come and who is on site now, from
  // the batch's student list and the arrival rows for the chosen dates.
  const groups = useMemo(() => {
    if (!data) return null;
    const latest = new Map(); // rows arrive newest first
    const first = new Map();
    const days = new Map();
    const classes = new Map();
    const sessions = new Map(); // studentId -> that student's classes, oldest first
    for (const r of data.rows) {
      if (!sessions.has(r.studentId)) sessions.set(r.studentId, []);
      sessions.get(r.studentId).unshift(r);
      if (!latest.has(r.studentId)) latest.set(r.studentId, r);
      first.set(r.studentId, r);
      if (!days.has(r.studentId)) days.set(r.studentId, new Set());
      days.get(r.studentId).add(r.day);
      classes.set(r.studentId, (classes.get(r.studentId) || 0) + 1);
    }
    // A batch meets several times a day, so number each student's classes
    // within the day in the order they happened: Class 1, Class 2, ...
    const classNo = new Map();
    const seen = new Map();
    for (const r of [...data.rows].reverse()) {
      const key = `${r.studentId}|${r.day}`;
      seen.set(key, (seen.get(key) || 0) + 1);
      classNo.set(r._id, seen.get(key));
    }
    const everyone = (data.students || []).map((s) => ({
      ...s,
      first: first.get(s.studentId) || null,
      last: latest.get(s.studentId) || null,
      days: days.get(s.studentId)?.size || 0,
      classes: classes.get(s.studentId) || 0,
      sessions: sessions.get(s.studentId) || [],
    }));
    return {
      total: everyone,
      absent: everyone.filter((s) => !s.last),
      // On a past day "in" means the student never tapped out.
      in: [...latest.values()].filter((r) => !r.outTime && (!isToday || r.day === todayStr)),
      classNo,
    };
  }, [data, isToday, todayStr]);

  if (error) return <div className="error">{error}</div>;

  // Any row opens that student's full history.
  const idOf = new Map((data?.students || []).map((s) => [s.studentId, s._id]));
  const openHistory = (studentId) => idOf.get(studentId) && navigate(`/student/${idOf.get(studentId)}`);

  const activeRange = RANGES.find((r) => r.from() === from && r.to() === to)?.key;
  const total = groups ? groups.total.length : 0;
  const counts = groups && {
    total,
    absent: groups.absent.length,
    in: groups.in.length,
  };
  const pctOf = (n) => (total ? Math.round((n / total) * 100) : 0);
  const labelOf = (v) => (v.key === 'in' && !isToday ? 'No out tap' : v.label);

  const query = search.trim().toLowerCase();
  const matches = (r) =>
    !query || r.name.toLowerCase().includes(query) || r.studentId.toLowerCase().includes(query);
  const list = groups ? groups[view].filter(matches) : [];
  const searching = groups && groups[view].length > 0 && list.length === 0;

  const EMPTY = {
    total: 'No students in this batch yet.',
    absent: 'Everyone in this batch came.',
    in: isToday ? 'No one from this batch is in class right now.' : 'Everyone who came tapped out.',
  };

  function pick(range) {
    setFrom(range.from());
    setTo(range.to());
  }

  return (
    <>
      <Link to="/" className="back">
        <Icon name="chev-left" /> Back to batches
      </Link>

      <div className="hero" style={{ '--h': data ? batchHue(data.batch.name) : 220 }}>
        <span className="card-icon">
          <Icon name="users" />
        </span>
        <div className="hero-title">
          <h1>{data ? data.batch.name : 'Loading…'}</h1>
          <p className="sub">{oneDay ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`}</p>
        </div>
        {data && (
          <button type="button" className="btn quiet" onClick={() => setReporting(true)}>
            Batch report
          </button>
        )}
      </div>

      <div className="stat-tiles" role="tablist" aria-label="Students in this batch">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`stat-tile ${v.key} ${view === v.key ? 'on' : ''}`}
            onClick={() => setView(v.key)}
          >
            <span className="stat-top">
              <span className="stat-icon">
                <Icon name={v.icon} />
              </span>
              <span className="stat-label">{labelOf(v)}</span>
            </span>
            <span className="stat-value num">
              {!counts ? (
                <strong>–</strong>
              ) : v.key === 'total' ? (
                <strong>{counts.total}</strong>
              ) : (
                <>
                  <strong>{counts[v.key]}</strong>
                  <i aria-hidden="true">/</i>
                  <strong className="of">{total}</strong>
                </>
              )}
            </span>
            <span className="stat-foot">
              {!counts
                ? ' '
                : v.key === 'total'
                  ? 'in this batch'
                  : `${pctOf(counts[v.key])}% of the batch`}
            </span>
          </button>
        ))}
      </div>

      <div className="controls">
        <div className="chips" role="group" aria-label="Quick date range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`chip ${activeRange === r.key ? 'on' : ''}`}
              aria-pressed={activeRange === r.key}
              onClick={() => pick(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          aria-label="From date"
        />
        <span className="to">to</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && setTo(e.target.value)}
          aria-label="To date"
        />
        <input
          className="search"
          type="text"
          placeholder="Search by name or student ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="list-head">
        <h2>{labelOf(VIEWS.find((v) => v.key === view))}</h2>
        {groups && <span className="list-count num">{list.length}</span>}
      </div>

      {!data ? (
        <SkeletonRows rows={4} />
      ) : list.length === 0 ? (
        <Empty
          icon={searching ? 'search' : 'inbox'}
          title={searching ? 'No one matches that search.' : EMPTY[view]}
          hint={searching ? 'Try a different name or clear the search box.' : undefined}
        />
      ) : view === 'total' || view === 'absent' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="hide-sm">Student ID</th>
                <th>Name</th>
                {view === 'total' && <th className="col-center">Classes</th>}
                {view === 'total' && oneDay && <th className="col-grow">Class history</th>}
                {view === 'total' && !oneDay && <th className="col-center hide-sm">Days came</th>}
                {view === 'total' && !oneDay && <th className="col-grow hide-sm">Last came</th>}
                <th className="col-fit">Status</th>
                <th className="col-fit hide-sm" aria-label="History" />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.studentId} className="clickable" onClick={() => openHistory(s.studentId)}>
                  <td className="code num hide-sm">{s.studentId}</td>
                  <td className="name">
                    <Link to={`/student/${s._id}`} className="who" onClick={(e) => e.stopPropagation()}>
                      <Avatar name={s.name} />
                      {s.name}
                    </Link>
                  </td>
                  {view === 'total' && (
                    <td className="col-center">
                      <span className={`class-count num ${s.classes ? '' : 'zero'}`}>{s.classes}</span>
                    </td>
                  )}
                  {view === 'total' &&
                    (oneDay ? (
                      <td className="col-grow">
                        {s.sessions.length ? (
                          <span className="sessions">
                            {s.sessions.map((c, i) => (
                              <span key={c._id} className={`session num ${c.outTime ? '' : 'open'}`}>
                                <b>{i + 1}</b>
                                {clock(c.time)} – {c.outTime ? clock(c.outTime) : c.day === todayStr ? 'now' : '?'}
                              </span>
                            ))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : (
                      <>
                        <td className="col-center time num hide-sm">{s.days}</td>
                        <td className="col-grow code num hide-sm">{s.last ? dayLabel(s.last.day) : '—'}</td>
                      </>
                    ))}
                  <td className="col-fit">
                    <StatusPill last={s.last} oneDay={oneDay} todayStr={todayStr} />
                  </td>
                  <td className="col-fit col-end hide-sm">
                    <Link to={`/student/${s._id}`} className="history-link" onClick={(e) => e.stopPropagation()}>
                      Full history ›
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="hide-sm">Student ID</th>
                <th>Name</th>
                {!oneDay && <th>Date</th>}
                <th>Class</th>
                <th>In</th>
                <th>Out</th>
                <th className="hide-sm">Time on site</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr
                  key={r._id}
                  className={`clickable ${fresh.includes(r._id) ? 'fresh' : ''}`}
                  onClick={() => openHistory(r.studentId)}
                >
                  <td className="code num hide-sm">{r.studentId}</td>
                  <td className="name">
                    <span className="who">
                      <Avatar name={r.name} />
                      {r.name}
                    </span>
                  </td>
                  {!oneDay && <td className="code num">{dayLabel(r.day)}</td>}
                  <td>
                    <span className="class-tag num">Class {groups.classNo.get(r._id) || 1}</span>
                  </td>
                  <td className="time num">{clock(r.time)}</td>
                  <td className="time num">
                    {r.outTime ? (
                      clock(r.outTime)
                    ) : r.day === todayStr ? (
                      <span className="pill in">In class</span>
                    ) : (
                      <span className="pill none">No out tap</span>
                    )}
                  </td>
                  <td className="code num hide-sm">{r.outTime ? duration(r.time, r.outTime) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reporting && data && (
        <ReportModal
          kind="batch"
          id={data.batch._id}
          label={data.batch.name}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}

function StatusPill({ last, oneDay, todayStr }) {
  if (!last) return <span className="pill absent">Not came</span>;
  if (!last.outTime && last.day === todayStr) return <span className="pill in">In class</span>;
  if (last.outTime && oneDay) return <span className="pill left">Left {clock(last.outTime)}</span>;
  return <span className="pill came">Came</span>;
}
