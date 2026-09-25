import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

/**
 * Two steps. First the server is told to treat the next card read as a new
 * card; when that UID arrives over the socket we move to the name and batch
 * form. Closing the modal always cancels the window on the server.
 */
export default function EnrolModal({ batches, onClose, onSaved }) {
  const [uid, setUid] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [name, setName] = useState('');
  const [batch, setBatch] = useState(batches[0]?._id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uidRef = useRef(null);

  useEffect(() => {
    let timer;
    const socket = getSocket();

    const onCard = (d) => {
      uidRef.current = d.uid;
      setUid(d.uid);
      setError('');
    };
    const onTaken = (d) =>
      setError(`That card already belongs to ${d.name} (${d.studentId}). Try another card.`);
    const onTimeout = () => setError('No card was tapped. Close this and start again.');

    socket.on('enrol:card', onCard);
    socket.on('enrol:taken', onTaken);
    socket.on('enrol:timeout', onTimeout);

    api('/enrol/start', { method: 'POST' })
      .then(({ expiresAt }) => {
        timer = setInterval(() => {
          const left = Math.ceil((expiresAt - Date.now()) / 1000);
          setSecondsLeft(left > 0 ? left : 0);
          if (left <= 0) clearInterval(timer);
        }, 500);
      })
      .catch((e) => setError(e.message));

    return () => {
      clearInterval(timer);
      socket.off('enrol:card', onCard);
      socket.off('enrol:taken', onTaken);
      socket.off('enrol:timeout', onTimeout);
      // Only cancel if no card was captured; capturing already closed the window.
      if (!uidRef.current) api('/enrol/cancel', { method: 'POST' }).catch(() => {});
    };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const { student } = await api('/students', {
        method: 'POST',
        body: JSON.stringify({ uid, name, batch }),
      });
      onSaved(student);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add a student</h2>

        {!uid ? (
          <>
            <p className="sub">Hold the new card against the reader.</p>
            {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
            <div className="reader-prompt">
              <div className="pulse">
                <i />
              </div>
              {secondsLeft > 0 && (
                <p className="countdown num">Waiting {secondsLeft}s</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn quiet" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sub">Card read. Fill in the details to finish.</p>
            <div className="captured num" style={{ marginTop: 16 }}>
              {uid}
            </div>

            {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Batch</span>
              <select value={batch} onChange={(e) => setBatch(e.target.value)} style={{ width: '100%' }}>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <p className="sub" style={{ fontSize: 13 }}>
              The student ID is assigned automatically from the batch level.
            </p>

            <div className="modal-actions">
              <button className="btn quiet" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" onClick={save} disabled={busy || !name.trim()}>
                {busy ? 'Saving' : 'Save student'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
