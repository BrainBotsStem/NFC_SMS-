import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import EnrolModal from '../components/EnrolModal.jsx';

export default function Admin() {
  const [batches, setBatches] = useState([]);
  const [students, setStudents] = useState(null);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

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
    try {
      const { student } = await api(`/students/${editing._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editing.name, batch: editing.batch }),
      });
      setStudents((list) => list.map((s) => (s._id === student._id ? student : s)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(student) {
    const ok = window.confirm(
      `Delete ${student.name} (${student.studentId})? Their attendance history is deleted too.`
    );
    if (!ok) return;
    try {
      await api(`/students/${student._id}`, { method: 'DELETE' });
      setStudents((list) => list.filter((s) => s._id !== student._id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="sub">
            {students ? `${students.length} on the roll` : 'Loading the roll'}
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          Add student
        </button>
      </div>

      {error && <div className="error">{error}</div>}

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
        <div className="note">Loading students</div>
      ) : students.length === 0 ? (
        <div className="note">
          {search || batchFilter
            ? 'No students match that search.'
            : 'No students yet. Add the first one with a card.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Batch</th>
                <th>Card</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s._id}>
                  <td className="code num">{s.studentId}</td>
                  <td className="name">{s.name}</td>
                  <td className="code">{s.batch?.name}</td>
                  <td className="code num">{s.uid}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn quiet small"
                        onClick={() => setEditing({ _id: s._id, name: s.name, batch: s.batch._id })}
                      >
                        Edit
                      </button>
                      <button className="btn danger small" onClick={() => remove(s)}>
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
          batches={batches}
          onClose={() => setAdding(false)}
          onSaved={(student) => {
            setStudents((list) => [student, ...(list || [])]);
            setAdding(false);
          }}
        />
      )}

      {editing && (
        <div className="backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit student</h2>
            <p className="sub">The student ID stays the same, including after a batch change.</p>

            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={editing.name}
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

            <div className="modal-actions">
              <button className="btn quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn" onClick={saveEdit} disabled={!editing.name.trim()}>
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
