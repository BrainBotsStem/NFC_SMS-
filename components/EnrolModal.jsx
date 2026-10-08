import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import Modal from './Modal.jsx';

/**
 * Two steps. First the server is told to treat the next card read as a new
 * card; when that UID arrives over the socket we move to the name and group
 * form. Closing the modal always cancels the window on the server.
 *
 * kind "student" puts the card in a batch; kind "staff" in a department, with
 * a designation. groups is the list of batches or departments.
 */
export default function EnrolModal({ kind = 'student', groups, onClose, onSaved }) {
  const staff = kind === 'staff';
  const [uid, setUid] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [batch, setBatch] = useState(groups[0]?._id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [broker, setBroker] = useState(null);
  const uidRef = useRef(null);
  const aliveRef = useRef(false);

  useEffect(() => {
    let timer;
    let stopped = false;
    aliveRef.current = true;
    const socket = getSocket();

    const onCard = (d) => {
      uidRef.current = d.uid;
      setUid(d.uid);
      setError('');
    };
    const onTaken = (d) =>
      setError(`That card already belongs to ${d.name} (${d.code}). Try another card.`);
    const onTimeout = () => setError('No card was tapped. Close this and start again.');

    socket.on('enrol:card', onCard);
    socket.on('enrol:taken', onTaken);
    socket.on('enrol:timeout', onTimeout);

    api('/enrol/start', { method: 'POST' })
      .then(({ expiresAt, broker }) => {
        if (stopped) return;
        setBroker(broker);
        timer = setInterval(() => {
          const left = Math.ceil((expiresAt - Date.now()) / 1000);
          setSecondsLeft(left > 0 ? left : 0);
          if (left <= 0) clearInterval(timer);
        }, 500);
      })
      .catch((e) => setError(e.message));

    return () => {
      stopped = true;
      aliveRef.current = false;
      clearInterval(timer);
      socket.off('enrol:card', onCard);
      socket.off('enrol:taken', onTaken);
      socket.off('enrol:timeout', onTimeout);
      // Only cancel if no card was captured (capturing already closed the window),
      // and only if the dialog really closed. React dev mode unmounts and remounts
      // straight away, and a late cancel would close the window that just reopened.
      setTimeout(() => {
        if (!aliveRef.current && !uidRef.current) api('/enrol/cancel', { method: 'POST' }).catch(() => {});
      }, 0);
    };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (staff) {
        const { member } = await api('/staff/members', {
          method: 'POST',
          body: JSON.stringify({ uid, name, designation, department: batch }),
        });
        onSaved(member);
      } else {
        const { student } = await api('/students', {
          method: 'POST',
          body: JSON.stringify({ uid, name, batch }),
        });
        onSaved(student);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={staff ? 'Add a staff member' : 'Add a student'} onClose={onClose}>
      {!uid ? (
        <>
          <p className="sub">Hold the new card against the reader.</p>
          {broker && !broker.connected && (
            <div className="warning" role="alert" style={{ marginTop: 16 }}>
              <strong>The server cannot hear the reader yet.</strong> {broker.message}
            </div>
          )}
          {error && (
            <div className="error" role="alert" style={{ marginTop: 16 }}>
              {error}
            </div>
          )}
          <div className="reader-prompt">
            <div className="pulse">
              <i />
            </div>
            {secondsLeft > 0 && <p className="countdown num">Waiting for a card… {secondsLeft}s</p>}
          </div>
          <div className="modal-actions">
            <button className="btn quiet" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim()) save();
          }}
        >
          <p className="sub">Card read. Fill in the details to finish.</p>
          <div className="captured num" style={{ marginTop: 16 }}>
            {uid}
          </div>

          {error && (
            <div className="error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}

          <label className="field">
            <span>Name</span>
            <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>

          {staff && (
            <label className="field">
              <span>Designation</span>
              <input
                type="text"
                value={designation}
                placeholder="e.g. Robotics teacher"
                onChange={(e) => setDesignation(e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span>{staff ? 'Department' : 'Batch'}</span>
            <select value={batch} onChange={(e) => setBatch(e.target.value)} style={{ width: '100%' }}>
              {groups.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <p className="sub" style={{ fontSize: 13 }}>
            {staff
              ? 'The staff ID is assigned automatically.'
              : 'The student ID is assigned automatically from the batch level.'}
          </p>

          <div className="modal-actions">
            <button type="button" className="btn quiet" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : staff ? 'Save staff member' : 'Save student'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
