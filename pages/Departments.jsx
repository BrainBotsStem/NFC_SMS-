import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { clock, dayLabel, hue } from '../lib/format.js';
import { Avatar, Empty, Icon, SkeletonRows } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';
import Modal from '../components/Modal.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

const PANELS = {
  in: { title: 'In today', empty: 'No staff are signed in right now.' },
  notIn: { title: 'Non-attendees', empty: 'Everyone is signed in.' },
  staff: { title: 'Staff', empty: 'No staff yet.' },
};

/** The staff side's home page, laid out like Batches: each department with who is in now. */
export default function Departments() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null); // { _id?, name }
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null); // a key of PANELS, or null
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [reporting, setReporting] = useState(false);
  const toast = useToast();
  usePageTitle('Departments');

  const load = () => api('/staff/departments').then(setData);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const refresh = () => load().catch(() => {});
    // Signing out changes who is in, so it refreshes the page as well.
    socket.on('staff:in', refresh);
    socket.on('staff:out', refresh);
    return () => {
      socket.off('staff:in', refresh);
      socket.off('staff:out', refresh);
    };
  }, []);

  function openPanel(kind) {
    setPanel(kind);
    setOverview(null);
    setOverviewError('');
    api('/staff/today')
      .then(setOverview)
      .catch((e) => setOverviewError(e.message));
  }

  async function saveDepartment(e) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      if (form._id) {
        const { department } = await api(`/staff/departments/${form._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: form.name }),
        });
        setData((d) => ({
          ...d,
          departments: d.departments.map((x) => (x._id === department._id ? { ...x, ...department } : x)),
        }));
        toast(`Saved changes to ${department.name}.`);
      } else {
        const { department } = await api('/staff/departments', {
          method: 'POST',
          body: JSON.stringify({ name: form.name }),
        });
        setData((d) => ({ ...d, departments: [...d.departments, department] }));
        toast(`Added ${department.name}.`);
      }
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDepartment() {
    setBusy(true);
    setDeleteError('');
    try {
      await api(`/staff/departments/${deleting._id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, departments: d.departments.filter((x) => x._id !== deleting._id) }));
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
          <h1>Departments</h1>
        </div>
        <SkeletonRows rows={5} />
      </>
    );

  const startAdd = () => setForm({ name: '' });
  const totalStaff = data.departments.reduce((sum, d) => sum + d.staff, 0);
  const totalIn = data.departments.reduce((sum, d) => sum + d.inNow, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Departments</h1>
          <p className="sub">Arrivals recorded for {dayLabel(data.day)}. Pick a department to see who tapped in and out.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn quiet" onClick={() => setReporting(true)}>
            Full report
          </button>
          <button className="btn" onClick={startAdd}>
            <Icon name="plus" /> Add department
          </button>
        </div>
      </div>

      <div className="summary">
        {[
          { key: 'in', label: 'In today', value: totalIn, h: 152 },
          { key: 'notIn', label: 'Non-attendees', value: Math.max(0, totalStaff - totalIn), h: 32 },
          { key: 'staff', label: 'Staff', value: totalStaff, h: 236 },
        ].map((t) => (
          <div
            key={t.key}
            style={{ '--h': t.h }}
            role="button"
            tabIndex={0}
            onClick={() => openPanel(t.key)}
            onKeyDown={(e) => e.key === 'Enter' && openPanel(t.key)}
          >
            <span>{t.label}</span>
            <strong className="num">{t.value}</strong>
          </div>
        ))}
      </div>

      {data.departments.length === 0 ? (
        <Empty icon="users" title="No departments yet" hint="Press Add department above to create the first one.">
          <button className="btn" onClick={startAdd}>
            Add the first department
          </button>
        </Empty>
      ) : (
        <section>
          <h2 className="level-head">
            All departments
            <span className="level-count num">
              <strong>{totalIn}</strong>
              <i aria-hidden="true">/</i>
              <strong>{totalStaff}</strong>
              <span>in today</span>
            </span>
          </h2>
          <div className="cards">
            {data.departments.map((d) => {
              const pct = d.staff ? Math.min(100, Math.round((d.inNow / d.staff) * 100)) : 0;
              return (
                <Link key={d._id} to={`/department/${d._id}`} className="card" style={{ '--h': hue(d.name) }}>
                  <span className="card-top">
                    <span className="card-icon">
                      <Icon name="users" />
                    </span>
                    <span className="card-name">{d.name}</span>
                    <button
                      type="button"
                      className="card-edit"
                      aria-label={`Edit ${d.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setForm({ _id: d._id, name: d.name });
                      }}
                    >
                      <Icon name="edit" />
                    </button>
                    <span className="chev" aria-hidden="true">›</span>
                  </span>
                  <span className="card-count num">
                    {d.staff ? (
                      <>
                        <span className="ratio">
                          <strong>{d.inNow}</strong>
                          <i aria-hidden="true">/</i>
                          <strong className="of">{d.staff}</strong>
                        </span>
                        <span className="ratio-label">in today</span>
                        <span className="ratio-pct">{pct}%</span>
                      </>
                    ) : (
                      <span>No staff yet</span>
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
      )}

      {form && (
        <Modal title={form._id ? 'Edit department' : 'Add department'} onClose={() => setForm(null)}>
          <form onSubmit={saveDepartment}>
            {formError && (
              <div className="error" role="alert" style={{ marginBottom: 16 }}>
                {formError}
              </div>
            )}
            <label className="field">
              <span>Department name</span>
              <input
                type="text"
                value={form.name}
                autoFocus
                placeholder="e.g. Teachers"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
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
                  Delete department
                </button>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn quiet" onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button className="btn" disabled={busy || !form.name.trim()}>
                  {busy ? 'Saving…' : form._id ? 'Save changes' : 'Add department'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete this department?" onClose={() => setDeleting(null)}>
          <p className="sub">
            <strong>{deleting.name}</strong> will be removed. This only works while it has no staff.
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
            <button className="btn danger-solid" onClick={removeDepartment} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete department'}
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
                  <div className="roster-row" key={s.staffId}>
                    <span className="who">
                      <Avatar name={s.name} small />
                      <span className="roster-name">{s.name}</span>
                    </span>
                    <span className="roster-meta">
                      <span className="batch-chip" style={{ '--h': hue(s.department) }}>
                        {s.department}
                      </span>
                      {panel === 'in' && <span className="time num">{clock(s.time)}</span>}
                      {panel === 'notIn' &&
                        (s.lastOut ? (
                          <span className="pill none">Left {clock(s.lastOut)}</span>
                        ) : (
                          <span className="pill none">Not arrived</span>
                        ))}
                      {panel === 'staff' && <span className="code num">{s.staffId}</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </Modal>
      )}

      {reporting && (
        <ReportModal side="staff" kind="all" label="All departments" onClose={() => setReporting(false)} />
      )}
    </>
  );
}
