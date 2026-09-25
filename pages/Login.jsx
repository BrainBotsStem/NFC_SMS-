import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Icon, Logo } from '../components/ui.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

export default function Login() {
  const { login } = useAuth();
  usePageTitle('Sign in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <Link to="/" className="back">
          <Icon name="chev-left" /> Back to home
        </Link>
        <Logo />
        <h1>Welcome back</h1>
        <p className="sub">Sign in with your student admin or staff account.</p>

        {error && (
          <div className="error" role="alert" style={{ marginTop: 16, marginBottom: 0 }}>
            {error}
          </div>
        )}

        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn quiet small"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <button className="btn" disabled={busy || !username.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-foot">Student and staff attendance · card reader dashboard</p>
      </form>
    </div>
  );
}
