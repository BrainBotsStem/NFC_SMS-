import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { clock, dayLabel, today } from '../lib/format.js';

export default function BatchDetail() {
  const { id } = useParams();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState([]);

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
    socket.on('attendance:new', onNew);
    return () => socket.off('attendance:new', onNew);
  }, [id, from, to]);

  if (error) return <div className="error">{error}</div>;

  const oneDay = from === to;

  return (
    <>
      <Link to="/" className="back">
        Back to batches
      </Link>

      <div className="page-head">
        <div>
          <h1>{data ? data.batch.name : 'Loading'}</h1>
          <p className="sub">
            {oneDay ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`}
            {data && ` · ${data.rows.length} ${data.rows.length === 1 ? 'arrival' : 'arrivals'}`}
          </p>
        </div>
      </div>

      <div className="controls">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
        />
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
        />
        {!oneDay && (
          <button
            className="btn quiet"
            onClick={() => {
              setFrom(today());
              setTo(today());
            }}
          >
            Show today
          </button>
        )}
      </div>

      {!data ? (
        <div className="note">Loading attendance</div>
      ) : data.rows.length === 0 ? (
        <div className="note">No one from this batch has tapped in yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Date</th>
                <th>In time</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r._id} className={fresh.includes(r._id) ? 'fresh' : ''}>
                  <td className="code num">{r.studentId}</td>
                  <td className="name">{r.name}</td>
                  <td className="code num">{dayLabel(r.day)}</td>
                  <td className="time num">{clock(r.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
