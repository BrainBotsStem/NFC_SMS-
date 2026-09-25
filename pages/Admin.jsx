import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import EnrolModal from '../components/EnrolModal.jsx';
import Modal from '../components/Modal.jsx';
import ReportModal from '../components/ReportModal.jsx';
import { Avatar, Empty } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';
import { batchHue, formatPhone } from '../lib/format.js';
import { usePageTitle } from '../lib/usePageTitle.js';

export default function Admin() {
  const [batches, setBatches] = useState([]);
  const [students, setStudents] = useState(null);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  usePageTitle('Students');

  useEffect(() => {
    api('/batches')
      .then((d) => setBatches(d.batches))
      .catch((e) => setError(e.message));
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (batchFilter) params.set('batch', batchFilter);
      api(`/students?${params}`)
        .then((d) => setStudents(d.students))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [search, batchFilter]);

  async function saveEdit() {
    setBusy(true);
    setError('');
    try {
      const { student } = await api(`/students/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editing.name,
          batch: editing.batch,
          parentPhone: editing.parentPhone,
          notifyParent: editing.notifyParent,
        }),
      });
      setStudents((list) => list.map((s) => (s._id === student._id ? student : s)));
      setEditing(null);
      toast(`Saved changes to ${student.name}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const student = deleting;
    setBusy(true);
    setError('');
    try {
      await api(`/students/${student._id}`, { method: 'DELETE' });
      setStudents((list) => list.filter((s) => s._id !== student._id));
      setDeleting(null);
      toast(`Deleted ${student.name}.`);
    } catch (e) {
      setError(e.message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="sub">
            {students ? `${students.length} on the roll` : 'Loading the roll…'}
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          Add student
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
          placeholder="Search by name or student ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {!students ? (
        <div className="note">Loading students…</div>
      ) : students.length === 0 ? (
        search || batchFilter ? (
          <Empty icon="search" title="No students match that search" hint="Try a different name, or clear the filters." />
        ) : (
          <Empty
            icon="card"
            title="No students yet"
            hint="Press Add student, then tap a new card on the reader to register it."
          >
            <button className="btn" onClick={() => setAdding(true)}>
              Add the first student
            </button>
          </Empty>
        )
      ) : (
        <div className="table-wrap">
          <table className="people-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Batch</th>
                <th className="hide-sm">Parent</th>
                <th className="hide-sm">Card</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s._id}>
                  <td className="code num">{s.studentId}</td>
                  <td className="name">
                    <Link to={`/student/${s._id}`} className="who" title="Full history">
                      <Avatar name={s.name} />
                      {s.name}
                    </Link>
                  </td>
                  <td>
                    <span className="batch-chip" style={{ '--h': batchHue(s.batch?.name) }}>
                      {s.batch?.name}
                    </span>
                  </td>
                  <td className="code num hide-sm">
                    {s.parentPhone ? (
                      <span title={s.notifyParent === false ? 'Texts to the parent are off' : 'Gets arrival and leaving texts'}>
                        {formatPhone(s.parentPhone)}
                        {s.notifyParent === false && <em className="muted-note"> · off</em>}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="code num hide-sm">{s.uid}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn quiet small" to={`/student/${s._id}`}>
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
                            batch: s.batch._id,
                            parentPhone: s.parentPhone ? formatPhone(s.parentPhone) : '',
                            notifyParent: s.notifyParent !== false,
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
          groups={batches}
          onClose={() => setAdding(false)}
          onSaved={(student) => {
            setStudents((list) => [student, ...(list || [])]);
            setAdding(false);
            toast(`Added ${student.name} as ${student.studentId}.`);
          }}
        />
      )}

      {editing && (
        <Modal title="Edit student" onClose={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && editing.name.trim()) saveEdit();
            }}
          >
            <p className="sub">The student ID stays the same, including after a batch change.</p>

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
              <span>Batch</span>
              <select
                value={editing.batch}
                onChange={(e) => setEditing({ ...editing, batch: e.target.value })}
                style={{ width: '100%' }}
              >
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Parent's mobile</span>
              <input
                type="tel"
                inputMode="tel"
                value={editing.parentPhone}
                placeholder="e.g. 077 123 4567"
                onChange={(e) => setEditing({ ...editing, parentPhone: e.target.value })}
              />
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={editing.notifyParent}
                disabled={!editing.parentPhone.trim()}
                onChange={(e) => setEditing({ ...editing, notifyParent: e.target.checked })}
              />
              Text the parent when {editing.name.trim() || 'the student'} arrives and leaves
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
        <Modal title="Delete this student?" onClose={() => setDeleting(null)}>
          <p className="sub">
            <strong>{deleting.name}</strong> ({deleting.studentId}) will be removed from the roll, and
            their attendance history is deleted too. This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="btn quiet" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button className="btn danger-solid" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete student'}
            </button>
          </div>
        </Modal>
      )}

      {reporting && (
        <ReportModal
          kind="student"
          id={reporting._id}
          label={reporting.name}
          onClose={() => setReporting(null)}
        />
      )}
    </>
  );
}
