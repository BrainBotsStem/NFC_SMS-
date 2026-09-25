import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { batchHue, clock, dayLabel } from '../lib/format.js';
import { Avatar, Empty, Icon, SkeletonRows } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';
import Modal from '../components/Modal.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

const PANELS = {
  in: { title: 'In today', empty: 'No one is on site right now.' },
  notIn: { title: 'Non-attendees', empty: 'Everyone has tapped in.' },
  students: { title: 'Students', empty: 'No students yet.' },
};

const LEVEL_ORDER = ['Elementary', 'Intermediate', 'Advanced Level'];
const LEVELS = [
  { code: 'EL', name: 'Elementary' },
  { code: 'IL', name: 'Intermediate' },
  { code: 'AL', name: 'Advanced Level' },
];

export default function Batches() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { _id?, name, level }
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null); // 'in' | 'notIn' | 'students' | null
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  usePageTitle('Batches');

  function openPanel(kind) {
    setPanel(kind);
    setOverview(null);
    setOverviewError('');
    api('/attendance/today')
      .then(setOverview)
      .catch((e) => setOverviewError(e.message));
  }

  useEffect(() => {
    api('/batches').then(setData).catch((e) => setError(e.message));
  }, []);

  // A scan anywhere may change who is on site, so refresh the list. This
  // includes tap-outs replayed later from a reader that was offline at the
  // moment of the tap.
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => api('/batches').then(setData).catch(() => {});
    socket.on('attendance:new', refresh);
    socket.on('attendance:out', refresh);
    return () => {
      socket.off('attendance:new', refresh);
      socket.off('attendance:out', refresh);
    };
  }, []);

  async function saveBatch(e) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      if (form._id) {
        const { batch } = await api(`/batches/${form._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: form.name, level: form.level }),
        });
        setData((d) => ({
          ...d,
          batches: d.batches.map((b) => (b._id === batch._id ? { ...b, ...batch } : b)),
        }));
        toast(`Saved changes to ${batch.name}.`);
      } else {
        const { batch } = await api('/batches', {
          method: 'POST',
          body: JSON.stringify({ name: form.name, level: form.level }),
        });
        setData((d) => ({ ...d, batches: [...d.batches, batch] }));
        toast(`Added ${batch.name}.`);
      }
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeBatch() {
    setBusy(true);
    setDeleteError('');
    try {
      await api(`/batches/${deleting._id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, batches: d.batches.filter((b) => b._id !== deleting._id) }));
      toast(`Deleted ${deleting.name}.`);
      setDeleting(null);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data)
    return (
      <>
        <div className="page-head">
          <h1>Batches</h1>
        </div>
        <SkeletonRows rows={5} />
      </>
    );

  const startAdd = () => setForm({ name: '', level: 'EL' });
  const startEdit = (b) => setForm({ _id: b._id, name: b.name, level: b.level });

  const groups = LEVEL_ORDER.map((levelName) => ({
    levelName,
    batches: data.batches.filter((b) => b.levelName === levelName),
  }))
    .filter((g) => g.batches.length)
    .map((g) => ({
      ...g,
      students: g.batches.reduce((sum, b) => sum + b.students, 0),
      presentToday: g.batches.reduce((sum, b) => sum + b.presentToday, 0),
    }));

  const totalStudents = data.batches.reduce((sum, b) => sum + b.students, 0);
  const totalIn = data.batches.reduce((sum, b) => sum + b.presentToday, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Batches</h1>
          <p className="sub">Arrivals recorded for {dayLabel(data.day)}. Pick a batch to see who tapped in and out.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn quiet" onClick={() => setReporting(true)}>
            Full report
          </button>
          <button className="btn" onClick={startAdd}>
            <Icon name="plus" /> Add batch
          </button>
        </div>
      </div>

      <div className="summary">
        <div
          style={{ '--h': 152 }}
          role="button"
          tabIndex={0}
          onClick={() => openPanel('in')}
          onKeyDown={(e) => e.key === 'Enter' && openPanel('in')}
        >
          <span>In today</span>
          <strong className="num">{totalIn}</strong>
        </div>
        <div
          style={{ '--h': 32 }}
          role="button"
          tabIndex={0}
          onClick={() => openPanel('notIn')}
          onKeyDown={(e) => e.key === 'Enter' && openPanel('notIn')}
        >
          <span>Non-attendees</span>
          <strong className="num">{Math.max(0, totalStudents - totalIn)}</strong>
        </div>
        <div
          style={{ '--h': 236 }}
          role="button"
          tabIndex={0}
          onClick={() => openPanel('students')}
          onKeyDown={(e) => e.key === 'Enter' && openPanel('students')}
        >
          <span>Students</span>
          <strong className="num">{totalStudents}</strong>
        </div>
      </div>

      {groups.length === 0 && (
        <Empty icon="users" title="No batches yet" hint="Press Add batch above to create the first one.">
          <button className="btn" onClick={startAdd}>
            Add the first batch
          </button>
        </Empty>
      )}

      {groups.map((group) => (
        <section key={group.levelName}>
          <h2 className="level-head">
            {group.levelName}
            <span className="level-count num">
              <strong>{group.presentToday}</strong>
              <i aria-hidden="true">/</i>
              <strong>{group.students}</strong>
              <span>in today</span>
            </span>
          </h2>
          <div className="cards">
            {group.batches.map((b) => {
              const pct = b.students ? Math.min(100, Math.round((b.presentToday / b.students) * 100)) : 0;
              return (
                <Link key={b._id} to={`/batch/${b._id}`} className="card" style={{ '--h': batchHue(b.name) }}>
                  <span className="card-top">
                    <span className="card-icon">
                      <Icon name="users" />
                    </span>
                    <span className="card-name">{b.name}</span>
                    <button
                      type="button"
                      className="card-edit"
                      aria-label={`Edit ${b.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startEdit(b);
                      }}
                    >
                      <Icon name="edit" />
                    </button>
                    <span className="chev" aria-hidden="true">›</span>
                  </span>
                  <span className="card-count num">
                    {b.students ? (
                      <>
                        <span className="ratio">
                          <strong>{b.presentToday}</strong>
                          <i aria-hidden="true">/</i>
                          <strong className="of">{b.students}</strong>
                        </span>
                        <span className="ratio-label">in today</span>
                        <span className="ratio-pct">{pct}%</span>
                      </>
                    ) : (
                      <span>No students yet</span>
                    )}
                  </span>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {form && (
        <Modal title={form._id ? 'Edit batch' : 'Add batch'} onClose={() => setForm(null)}>
          <form onSubmit={saveBatch}>
            {formError && (
              <div className="error" role="alert" style={{ marginBottom: 16 }}>
                {formError}
              </div>
            )}

            <label className="field">
              <span>Batch name</span>
              <input
                type="text"
                value={form.name}
                autoFocus
                placeholder="e.g. Elementary 03"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Level</span>
              <select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                style={{ width: '100%' }}
              >
                {LEVELS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="modal-actions" style={{ justifyContent: form._id ? 'space-between' : 'flex-end' }}>
              {form._id && (
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => {
                    setDeleting({ _id: form._id, name: form.name });
                    setForm(null);
                  }}
                >
                  Delete batch
                </button>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn quiet" onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button className="btn" disabled={busy || !form.name.trim()}>
                  {busy ? 'Saving…' : form._id ? 'Save changes' : 'Add batch'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete this batch?" onClose={() => setDeleting(null)}>
          <p className="sub">
            <strong>{deleting.name}</strong> will be removed. This only works while it has no students.
          </p>
          {deleteError && (
            <div className="error" role="alert" style={{ marginTop: 12 }}>
              {deleteError}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn quiet" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="btn danger-solid" onClick={removeBatch} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete batch'}
            </button>
          </div>
        </Modal>
      )}

      {panel && (
        <Modal title={PANELS[panel].title} onClose={() => setPanel(null)} wide>
          {overviewError && <div className="error" role="alert">{overviewError}</div>}

          {!overview && !overviewError && <SkeletonRows rows={4} />}

          {overview && (
            <div className="roster-list">
              {overview[panel].length === 0 ? (
                <Empty icon="users" title={PANELS[panel].empty} />
              ) : (
                overview[panel].map((s) => (
                  <div className="roster-row" key={s.studentId}>
                    <span className="who">
                      <Avatar name={s.name} small />
                      <span className="roster-name">{s.name}</span>
                    </span>
                    <span className="roster-meta">
                      <span className="batch-chip" style={{ '--h': batchHue(s.batch) }}>
                        {s.batch}
                      </span>
                      {panel === 'in' && <span className="time num">{clock(s.time)}</span>}
                      {panel === 'notIn' &&
                        (s.lastOut ? (
                          <span className="pill none">Left {clock(s.lastOut)}</span>
                        ) : (
                          <span className="pill none">Not arrived</span>
                        ))}
                      {panel === 'students' && <span className="code num">{s.studentId}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </Modal>
      )}

      {reporting && (
        <ReportModal kind="all" label="All batches" onClose={() => setReporting(false)} />
      )}
    </>
  );
}
