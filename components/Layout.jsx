import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { getSocket } from '../lib/socket.js';
import { clock } from '../lib/format.js';
import { Avatar, Logo } from './ui.jsx';
import { useToast } from './Toasts.jsx';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const { pathname } = useLocation();
  // Three links sit between this page and the card reader: page -> server,
  // server -> HiveMQ, HiveMQ -> reader. The badge names the first one broken.
  const [serverUp, setServerUp] = useState(true);
  const [brokerUp, setBrokerUp] = useState(null);
  const [readers, setReaders] = useState({}); // deviceId -> "online" | "offline"
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // The account menu closes on a click elsewhere, on Escape, and on navigation.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const socket = getSocket();
    const onStatus = ({ deviceId, status }) => setReaders((r) => ({ ...r, [deviceId]: status }));
    const onBroker = ({ connected }) => setBrokerUp(connected);
    // The server sends the broker and reader status again on every reconnect.
    const onServerLost = () => setServerUp(false);
    const onServerBack = () => setServerUp(true);
    if (socket.disconnected && !socket.active) onServerLost();

    // Live taps are announced on every page, so nobody has to keep the
    // batch page open to see that a card was read.
    const onIn = (r) => toast(`${r.name} tapped in`, { detail: `${clock(r.time)} · ${r.batchName}`, icon: 'login' });
    const onOut = (r) => toast(`${r.name} tapped out`, { detail: clock(r.outTime), icon: 'logout' });
    const onStaffIn = (r) =>
      toast(`${r.name} tapped in`, { detail: `${clock(r.time)} · ${r.departmentName}`, icon: 'login' });
    const onStaffOut = (r) => toast(`${r.name} tapped out`, { detail: clock(r.outTime), icon: 'logout' });
    const onUnknown = (r) =>
      toast('Unknown card tapped', { detail: `Card ${r.uid} is not on the roll`, type: 'warn', icon: 'card' });
    // The card is still valid here (green light on the reader), but the tap
    // itself was ignored as a too-soon repeat - said out loud so it never
    // looks like the tap silently failed.
    const onRepeat = (r) =>
      toast(`${r.name} tapped again too soon`, {
        detail: `Ignored - last tap was ${clock(r.firstTime)}`,
        type: 'warn',
        icon: 'card',
      });

    // A parent text that could not be sent after its retries.
    const onNotify = (m) =>
      m.status === 'failed' &&
      toast('A parent message failed', {
        detail: [m.name, m.error].filter(Boolean).join(' · '),
        type: 'warn',
        icon: 'message',
      });

    socket.on('reader:status', onStatus);
    socket.on('broker:status', onBroker);
    socket.on('connect', onServerBack);
    socket.on('disconnect', onServerLost);
    socket.on('connect_error', onServerLost);
    socket.on('attendance:new', onIn);
    socket.on('attendance:out', onOut);
    socket.on('scan:unknown', onUnknown);
    socket.on('scan:repeat', onRepeat);
    socket.on('staff:in', onStaffIn);
    socket.on('staff:out', onStaffOut);
    socket.on('staff:repeat', onRepeat);
    socket.on('notify:update', onNotify);
    return () => {
      socket.off('reader:status', onStatus);
      socket.off('broker:status', onBroker);
      socket.off('connect', onServerBack);
      socket.off('disconnect', onServerLost);
      socket.off('connect_error', onServerLost);
      socket.off('attendance:new', onIn);
      socket.off('attendance:out', onOut);
      socket.off('scan:unknown', onUnknown);
      socket.off('scan:repeat', onRepeat);
      socket.off('staff:in', onStaffIn);
      socket.off('staff:out', onStaffOut);
      socket.off('staff:repeat', onRepeat);
      socket.off('notify:update', onNotify);
    };
  }, [toast]);

  const statuses = Object.values(readers);
  const [readerClass, readerText, readerTitle] = !serverUp
    ? ['down', 'Server offline', 'Cannot reach the attendance server. Start it with npm start.']
    : brokerUp === false
      ? ['down', 'No internet', 'The server cannot reach HiveMQ, so the reader cannot be seen. It retries on its own.']
      : statuses.includes('online')
        ? ['live', 'Reader on', 'The card reader is connected']
        : statuses.includes('offline')
          ? ['down', 'Reader off', 'The card reader is not connected. Taps are stored on it and sent later.']
          : ['', 'Waiting for reader', 'The server has not heard from the card reader since it started'];
  // admin sees the student side, staffadmin the staff side, superadmin both.
  const studentSide = user.role === 'admin' || user.role === 'superadmin';
  const staffSide = user.role === 'staffadmin' || user.role === 'superadmin';
  const ROLE_LABEL = { admin: 'Admin', staffadmin: 'Staff admin', superadmin: 'Super admin' };
  // A list tab stays lit inside one of its batches or departments.
  const batchesActive = pathname === '/' || pathname.startsWith('/batch/');
  const departmentsActive = pathname === '/departments' || pathname.startsWith('/department/');
  const tab = ({ isActive }) => (isActive ? 'on' : '');

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          <span>
            {studentSide ? 'Attendance' : 'Staff Attendance'}
          </span>
        </Link>

        <nav className="topnav" aria-label="Main">
          {studentSide && (
            <>
              <NavLink to="/" className={() => (batchesActive ? 'on' : '')}>
                Batches
              </NavLink>
              <NavLink to="/admin" className={tab}>
                Students
              </NavLink>
              <NavLink to="/messages" className={tab}>
                Messages
              </NavLink>
            </>
          )}
          {studentSide && staffSide && <span className="nav-divider" aria-hidden="true" />}
          {staffSide && (
            <>
              <NavLink to="/departments" className={() => (departmentsActive ? 'on' : '')}>
                Departments
              </NavLink>
              <NavLink to="/staff" className={tab}>
                Staff
              </NavLink>
            </>
          )}
        </nav>

        <div className="topbar-end">
          <span className={`reader-state ${readerClass}`} title={readerTitle}>
            <i className="dot" />
            {readerText}
          </span>
          {/* Name, role and Sign out live in one menu, so the bar fits on any screen. */}
          <div className="account" ref={menuRef}>
            <button
              type="button"
              className="account-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Avatar name={user.username} />
              <span className="username">
                {user.username}
                <em>{ROLE_LABEL[user.role] || user.role}</em>
              </span>
              <svg className="caret" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {menuOpen && (
              <div className="account-menu" role="menu">
                <div className="account-who">
                  <Avatar name={user.username} />
                  <span>
                    <strong>{user.username}</strong>
                    <em>{ROLE_LABEL[user.role] || user.role}</em>
                  </span>
                </div>
                <button type="button" role="menuitem" className="account-item danger" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
