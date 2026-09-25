import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { dayLabel } from '../lib/format.js';

const LEVEL_ORDER = ['Elementary', 'Intermediate', 'Advanced Level'];

export default function Batches() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/batches').then(setData).catch((e) => setError(e.message));
  }, []);

  // A scan anywhere may change a batch's arrival count, so refresh the list.
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => api('/batches').then(setData).catch(() => {});
    socket.on('attendance:new', refresh);
    return () => socket.off('attendance:new', refresh);
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="note">Loading batches</div>;

  const groups = LEVEL_ORDER.map((levelName) => ({
    levelName,
    batches: data.batches.filter((b) => b.levelName === levelName),
  })).filter((g) => g.batches.length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Batches</h1>
          <p className="sub">Arrivals recorded for {dayLabel(data.day)}.</p>
        </div>
      </div>

      {groups.map((group) => (
        <section key={group.levelName}>
          <h2>{group.levelName}</h2>
          <div className="ledger">
            {group.batches.map((b) => (
              <Link key={b._id} to={`/batch/${b._id}`} className="ledger-row">
                <span className="ledger-name">{b.name}</span>
                <span className="ledger-meta num">
                  {b.students} {b.students === 1 ? 'student' : 'students'}
                </span>
                <span className={`tally num ${b.presentToday ? 'some' : 'none'}`}>
                  <strong>{b.presentToday}</strong>
                  <span>in</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
