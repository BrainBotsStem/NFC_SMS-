import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import EnrolModal from '../components/EnrolModal.jsx';
import Modal from '../components/Modal.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { Avatar, Empty } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';
import { hue } from '../lib/format.js';
import { usePageTitle } from '../lib/usePageTitle.js';

/** Everyone on the staff side: add with a card tap, edit, delete, report. */
export default function StaffMembers() {
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  usePageTitle('Staff');

  useEffect(() => {
    api('/staff/departments')
      .then((d) => setDepartments(d.departments))
      .catch((e) => setError(e.message));
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (departmentFilter) params.set('department', departmentFilter);
      api(`/staff/members?${params}`)
        .then((d) => setStaff(d.staff))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, departmentFilter]);

  async function saveEdit() {
    setBusy(true);
    setError('');
    try {
      const { member } = await api(`/staff/members/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editing.name, designation: editing.designation, department: editing.department }),
      });
      setStaff((list) => list.map((s) => (s._id === member._id ? member : s)));
      setEditing(null);
      toast(`Saved changes to ${member.name}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const member = deleting;
    setBusy(true);
    setError('');
    try {
      await api(`/staff/members/${member._id}`, { method: 'DELETE' });
      setStaff((list) => list.filter((s) => s._id !== member._id));
      setDeleting(null);
      toast(`Deleted ${member.name}.`);
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const noDepartments = departments.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="sub">{staff ? `${staff.length} on the roll` : 'Loading the roll…'}</p>
        </div>
        <button
          className="btn"
          onClick={() => setAdding(true)}
          disabled={noDepartments}
          title={noDepartments ? 'Add a department first' : undefined}
        >
          Add staff
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="controls">
        <input
          className="search"
          type="text"
          placeholder="Search by name, staff ID or designation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {!staff ? (
        <div className="note">Loading staff…</div>
      ) : staff.length === 0 ? (
        search || departmentFilter ? (
          <Empty icon="search" title="No staff match that search" hint="Try a different name, or clear the filters." />
        ) : (
          <Empty
            icon="card"
            title="No staff yet"
            hint={
              noDepartments
                ? 'Add a department on the Departments page first.'
                : 'Press Add staff, then tap a new card on the reader to register it.'
            }
          >
            {!noDepartments && (
              <button className="btn" onClick={() => setAdding(true)}>
                Add the first staff member
              </button>
            )}
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="people-table">
            <thead>
              <tr>
                <th>Staff ID</th>
                <th>Name</th>
                <th className="hide-sm">Designation</th>
                <th>Department</th>
                <th className="hide-sm">Card</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s._id}>
                  <td className="code num">{s.staffId}</td>
                  <td className="name">
                    <Link to={`/staff-member/${s._id}`} className="who" title="Full history">
                      <Avatar name={s.name} />
                      {s.name}
                    </Link>
                  </td>
                  <td className="hide-sm">{s.designation || '—'}</td>
                  <td>
                    <span className="batch-chip" style={{ '--h': hue(s.department?.name || '') }}>
                      {s.department?.name}
                    </span>
                  </td>
                  <td className="code num hide-sm">{s.uid}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn quiet small" to={`/staff-member/${s._id}`}>
                        History
                      </Link>
                      <button className="btn quiet small" onClick={() => setReporting(s)}>
                        Report
                      </button>
                      <button
                        className="btn quiet small"
                        onClick={() =>
                          setEditing({
                            _id: s._id,
                            name: s.name,
                            designation: s.designation || '',
                            department: s.department?._id,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button className="btn danger small" onClick={() => setDeleting(s)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <EnrolModal
          kind="staff"
          groups={departments}
          onClose={() => setAdding(false)}
          onSaved={(member) => {
            setStaff((list) => [member, ...(list || [])]);
            setAdding(false);
            toast(`Added ${member.name} as ${member.staffId}.`);
          }}
        />
      )}

      {editing && (
        <Modal title="Edit staff member" onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && editing.name.trim()) saveEdit();
            }}
          >
            <p className="sub">The staff ID stays the same, including after a department change.</p>

            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={editing.name}
                autoFocus
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Designation</span>
              <input
                type="text"
                value={editing.designation}
                placeholder="e.g. Robotics teacher"
                onChange={(e) => setEditing({ ...editing, designation: e.target.value })}
              />
            </label>

            <label className="field">
              <span>Department</span>
              <select
                value={editing.department}
                onChange={(e) => setEditing({ ...editing, department: e.target.value })}
                style={{ width: '100%' }}
              >
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="modal-actions">
              <button type="button" className="btn quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" disabled={busy || !editing.name.trim()}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete this staff member?" onClose={() => setDeleting(null)}>
          <p className="sub">
            <strong>{deleting.name}</strong> ({deleting.staffId}) will be removed, and their attendance
            register is deleted too. This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn quiet" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="btn danger-solid" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete staff member'}
            </button>
          </div>
        </Modal>
      )}

      {reporting && (
        <ReportModal
          side="staff"
          kind="student"
          id={reporting._id}
          label={reporting.name}
          onClose={() => setReporting(null)}
        />
      )}
    </>
  );
}
