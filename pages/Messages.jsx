import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import Modal from '../components/Modal.jsx';
import { Empty, Icon, SkeletonRows } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';
import { clock, dayLabel, dayOf, formatPhone, today } from '../lib/format.js';
import { usePageTitle } from '../lib/usePageTitle.js';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'pending', label: 'Waiting' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'skipped', label: 'Skipped' },
];

const STATUS = {
  pending: ['Waiting', 'wait'],
  sending: ['Sending', 'wait'],
  sent: ['Sent', 'came'],
  failed: ['Failed', 'absent'],
  cancelled: ['Cancelled', 'left'],
  skipped: ['Skipped', 'none'],
};

const KIND = { in: 'Arrived', out: 'Left', test: 'Test' };

const PROVIDER = { console: 'test mode', notifylk: 'Notify.lk SMS' };

/** Every text sent to a parent, what happened to it, and a way to test the SMS account. */
export default function Messages() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  usePageTitle('Messages');

  const load = useCallback(
    () =>
      api(`/notifications${status ? `?status=${status}` : ''}`)
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((e) => setError(e.message)),
    [status]
  );

  useEffect(() => {
    load();
  }, [load]);

  // A message changing anywhere refreshes the list. Bursts (a reader replaying
  // its backlog) are gathered into one request.
  useEffect(() => {
    const socket = getSocket();
    let t;
    const onUpdate = () => {
      clearTimeout(t);
      t = setTimeout(load, 400);
    };
    socket.on('notify:update', onUpdate);
    return () => {
      clearTimeout(t);
      socket.off('notify:update', onUpdate);
    };
  }, [load]);

  async function sendTest() {
    setBusy(true);
    setError('');
    try {
      await api('/notifications/test', { method: 'POST', body: JSON.stringify({ phone: testPhone }) });
      toast('Test message sent', { detail: testPhone, icon: 'message' });
      setTesting(false);
      load();
    } catch (e) {
      setError(e.message);
      setTesting(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function retry(row) {
    try {
      await api(`/notifications/${row._id}/retry`, { method: 'POST' });
      toast('Sending again', { detail: row.student?.name || formatPhone(row.phone), icon: 'message' });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const settings = data?.settings;
  const counts = data?.today || {};
  const todayStr = today();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Parent messages</h1>
          <p className="sub">
            {settings
              ? settings.mode === 'every'
                ? 'A text goes to the parent on every tap in and every tap out.'
                : `One text when a student arrives, and one when they leave. A "left" text waits ${settings.outDelayMinutes} minutes and is dropped if the student taps in for the next class.`
              : 'Loading…'}
          </p>
        </div>
        <button className="btn quiet" onClick={() => setTesting(true)} disabled={!settings || settings.provider === 'off'}>
          <Icon name="message" /> Send a test
        </button>
      </div>

      {settings?.problem ? (
        <div className="warning" role="alert" style={{ marginBottom: 18 }}>
          <strong>Messages are not being sent.</strong> {settings.problem}
        </div>
      ) : settings?.provider === 'console' ? (
        <div className="warning" style={{ marginBottom: 18 }}>
          <strong>Test mode.</strong> Messages are written to the server log instead of being sent, so parents get
          nothing and there is no cost. Set <code>NOTIFY_PROVIDER=notifylk</code> in <code>.env</code> to send real
          texts.
        </div>
      ) : null}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <div className="summary">
        {[
          ['sent', 'Sent today', 152],
          ['pending', 'Waiting', 212],
          ['failed', 'Failed today', 8],
        ].map(([key, label, h]) => (
          <div
            key={key}
            style={{ '--h': h }}
            role="button"
            tabIndex={0}
            onClick={() => setStatus(key)}
            onKeyDown={(e) => e.key === 'Enter' && setStatus(key)}
          >
            <span>{label}</span>
            <strong className="num">{(counts[key] || 0) + (key === 'pending' ? counts.sending || 0 : 0)}</strong>
          </div>
        ))}
      </div>

      <div className="controls">
        <div className="chips" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip ${status === f.key ? 'on' : ''}`}
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {settings && settings.provider !== 'off' && (
          <span className="sub" style={{ fontSize: 13 }}>
            Sending through {PROVIDER[settings.provider] || settings.provider}
          </span>
        )}
      </div>

      {!data ? (
        <SkeletonRows rows={4} />
      ) : data.notifications.length === 0 ? (
        <Empty
          icon="message"
          title={status ? 'No messages with this status.' : 'No messages yet.'}
          hint={
            status
              ? 'Try All.'
              : "Add a parent's mobile to a student on the Students page. Their next tap sends the first text."
          }
        >
          {!status && (
            <Link className="btn" to="/admin">
              Go to Students
            </Link>
          )}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="messages-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Student</th>
                <th>Type</th>
                <th className="hide-sm">To</th>
                <th>Status</th>
                <th className="hide-sm">Message</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.notifications.map((m) => {
                const [label, tone] = STATUS[m.status] || [m.status, 'none'];
                const when = m.tapTime || m.createdAt;
                const day = dayOf(when);
                return (
                  <tr key={m._id}>
                    <td className="time num">
                      {clock(when)}
                      {day !== todayStr && <em className="muted-note"> · {dayLabel(day)}</em>}
                    </td>
                    <td className="name">
                      {m.student ? (
                        <Link to={`/student/${m.student._id}`}>{m.student.name}</Link>
                      ) : (
                        <span className="muted-note">—</span>
                      )}
                    </td>
                    <td>{KIND[m.kind]}</td>
                    <td className="code num hide-sm">{formatPhone(m.phone)}</td>
                    <td>
                      <span className={`pill ${tone}`}>{label}</span>
                      {m.status === 'pending' && new Date(m.sendAfter) > new Date() && (
                        <em className="muted-note"> at {clock(m.sendAfter)}</em>
                      )}
                    </td>
                    <td className="message-text hide-sm">
                      {m.message}
                      {m.error && <span className="message-error">{m.error}</span>}
                    </td>
                    <td>
                      {(m.status === 'failed' || m.status === 'skipped') && m.kind !== 'test' && (
                        <button className="btn quiet small" onClick={() => retry(m)}>
                          Send again
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {testing && (
        <Modal title="Send a test message" onClose={() => setTesting(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && testPhone.trim()) sendTest();
            }}
          >
            <p className="sub">
              {settings?.provider === 'console'
                ? 'Test mode is on, so the message goes to the server log, not to the phone.'
                : 'A short test text goes to this number now. It checks the SMS account works.'}
            </p>
            <label className="field">
              <span>Mobile number</span>
              <input
                type="tel"
                inputMode="tel"
                value={testPhone}
                autoFocus
                placeholder="e.g. 077 123 4567"
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn quiet" onClick={() => setTesting(false)}>
                Cancel
              </button>
              <button className="btn" disabled={busy || !testPhone.trim()}>
                {busy ? 'Sending…' : 'Send test'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
