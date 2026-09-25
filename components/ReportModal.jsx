import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api, apiBlob } from '../lib/api.js';
import { today, daysAgo } from '../lib/format.js';

const PRESETS = [
  { key: 'today', label: 'Today', from: () => today(), to: () => today() },
  { key: 'week', label: 'Last week', from: () => daysAgo(6), to: () => today() },
  { key: 'month', label: 'Last 30 days', from: () => daysAgo(29), to: () => today() },
  { key: 'all', label: 'All time', from: () => '', to: () => '' },
];

/**
 * Pick a period (and, for batch/all reports, a batch), generate the PDF,
 * then download it - kept as explicit steps so nothing downloads before the
 * admin has seen it generate cleanly.
 */
export default function ReportModal({ kind, id, label, onClose, side = 'student' }) {
  // side "staff": kind "batch" means a department and "student" one staff member.
  const staffSide = side === 'staff';
  const groupWord = staffSide ? 'Department' : 'Batch';
  const allGroups = staffSide ? 'All departments' : 'All batches';
  const showBatchPicker = kind === 'all' || kind === 'batch';

  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [batches, setBatches] = useState(null);
  const [batchId, setBatchId] = useState(kind === 'batch' ? id : '');
  const [status, setStatus] = useState('idle'); // idle | working | ready | error
  const [error, setError] = useState('');
  const [file, setFile] = useState(null); // { url, filename }

  useEffect(() => {
    if (!showBatchPicker) return;
    api(staffSide ? '/staff/departments' : '/batches')
      .then((d) => setBatches(staffSide ? d.departments : d.batches))
      .catch(() => setBatches([]));
  }, [showBatchPicker, staffSide]);

  function pick(p) {
    setPreset(p.key);
    setFrom(p.from());
    setTo(p.to());
    setStatus('idle');
    setFile(null);
  }

  function editCustom(which, value) {
    if (which === 'from') setFrom(value);
    else setTo(value);
    setPreset('custom');
    setStatus('idle');
    setFile(null);
  }

  function pickBatch(newId) {
    setBatchId(newId);
    setStatus('idle');
    setFile(null);
  }

  async function generate() {
    setStatus('working');
    setError('');
    try {
      const params = new URLSearchParams();
      if (preset !== 'all') {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
      }
      let path;
      if (staffSide) {
        path = '/staff/report';
        if (!showBatchPicker) params.set('member', id);
        else if (batchId) params.set('department', batchId);
      } else {
        path = !showBatchPicker ? `/reports/student/${id}` : batchId ? `/reports/batch/${batchId}` : `/reports/all`;
      }
      const qs = params.toString();
      const { blob, filename } = await apiBlob(`${path}${qs ? `?${qs}` : ''}`);
      const url = URL.createObjectURL(blob);
      setFile({ url, filename });
      setStatus('ready');
      // Open it straight away so it can be seen (and saved from) the browser's
      // own PDF viewer. The Download button below still works if a pop-up
      // blocker stops this.
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleClose() {
    if (file) URL.revokeObjectURL(file.url);
    onClose();
  }

  function batchTitle() {
    if (!batchId) return allGroups;
    const found = batches?.find((b) => b._id === batchId);
    if (found) return found.name;
    // Before the batch list has loaded, fall back to the name the caller
    // already knew (the batch this modal was opened from).
    return batchId === id ? label : `this ${groupWord.toLowerCase()}`;
  }

  const title = showBatchPicker ? batchTitle() : label;

  return (
    <Modal title={`Attendance report — ${title}`} onClose={handleClose}>
      <p className="sub">Choose a period, generate the PDF, then download it.</p>

      {showBatchPicker && (
        <label className="field" style={{ marginTop: 16 }}>
          <span>{groupWord}</span>
          <select value={batchId} onChange={(e) => pickBatch(e.target.value)} style={{ width: '100%' }}>
            <option value="">{allGroups}</option>
            {(batches || []).map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="chips" role="group" aria-label="Quick range" style={{ marginTop: 16 }}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chip ${preset === p.key ? 'on' : ''}`}
            onClick={() => pick(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset !== 'all' && (
        <div className="controls" style={{ marginTop: 12 }}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && editCustom('from', e.target.value)}
            aria-label="From date"
          />
          <span className="to">to</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && editCustom('to', e.target.value)}
            aria-label="To date"
          />
        </div>
      )}

      {error && (
        <div className="error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn quiet" onClick={handleClose}>
          Close
        </button>
        {status === 'ready' ? (
          <button className="btn" onClick={download}>
            Download PDF
          </button>
        ) : (
          <button className="btn" onClick={generate} disabled={status === 'working'}>
            {status === 'working' ? 'Generating…' : 'Generate PDF'}
          </button>
        )}
      </div>
    </Modal>
  );
}
