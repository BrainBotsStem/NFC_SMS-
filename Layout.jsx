import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { getSocket } from '../lib/socket.js';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [reader, setReader] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    const onStatus = ({ status }) => setReader(status);
    socket.on('reader:status', onStatus);
    return () => socket.off('reader:status', onStatus);
  }, []);

  const readerClass = reader === 'online' ? 'live' : reader === 'offline' ? 'down' : '';
  const readerText = reader === 'online' ? 'Reader on' : reader === 'offline' ? 'Reader off' : 'Reader unknown';

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Attendance <span>/ Bb</span>
        </Link>

        <nav className="topnav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>
            Batches
          </NavLink>
          {user.role === 'admin' && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? 'on' : '')}>
              Students
            </NavLink>
          )}
        </nav>

        <div className="topbar-end">
          <span className="reader-state">
            <i className={`dot ${readerClass}`} />
            {readerText}
          </span>
          <span>{user.username}</span>
          <button className="btn quiet small" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
