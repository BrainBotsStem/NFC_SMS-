import { Link } from 'react-router-dom';
import { Avatar, Icon, Logo } from '../components/ui.jsx';
import { usePageTitle } from '../lib/usePageTitle.js';

const FEATURES = [
  {
    icon: 'login',
    hue: 152,
    title: 'Tap in, tap out',
    text: 'The first tap is the in time. A tap 10 minutes or more later becomes the out time, so time on site comes for free.',
  },
  {
    icon: 'activity',
    hue: 212,
    title: 'Live dashboard',
    text: 'Arrivals appear the moment a card is read, with a pop-up on every page. No refreshing, no waiting for a report.',
  },
  {
    icon: 'layers',
    hue: 262,
    title: 'Batches by level',
    text: 'Elementary, Intermediate and Advanced batches, each with its own colour and a live count of who is in.',
  },
  {
    icon: 'card',
    hue: 335,
    title: 'Enrol with a card',
    text: 'Press Add student, tap the new card, type a name. The student ID is assigned automatically.',
  },
  {
    icon: 'shield',
    hue: 24,
    title: 'Secure sign-in',
    text: 'Attendance and the student roll sit behind a sign-in, so only your admin can see or change anything.',
  },
  {
    icon: 'smartphone',
    hue: 188,
    title: 'Made for any screen',
    text: 'Works on phone, tablet and desktop, and switches to a dark theme automatically when your device does.',
  },
];

const STEPS = [
  { n: 1, icon: 'card', title: 'Tap the card', text: 'The student holds their card to the reader at the door.' },
  {
    n: 2,
    icon: 'zap',
    title: 'Get instant feedback',
    text: 'A green light and one beep confirm it. A red light means the card is not registered.',
  },
  {
    n: 3,
    icon: 'activity',
    title: 'See it on the dashboard',
    text: 'The batch page updates live with in time, out time and time on site.',
  },
];

/** A static, illustrative picture of the dashboard. It is labelled as sample data. */
function Preview() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span>Attendance · sample data</span>
      </div>
      <div className="mock-body">
        <div className="mock-tiles">
          <div style={{ '--h': 152 }}>
            <span>In today</span>
            <strong>42</strong>
          </div>
          <div style={{ '--h': 32 }}>
            <span>Non-attendees</span>
            <strong>18</strong>
          </div>
          <div style={{ '--h': 236 }}>
            <span>Students</span>
            <strong>60</strong>
          </div>
        </div>

        <div className="mock-cards">
          {[
            { name: 'Elementary 01', hue: 150, n: 12, of: 14 },
            { name: 'Intermediate 02', hue: 232, n: 9, of: 15 },
            { name: 'Advanced Level 01', hue: 18, n: 6, of: 8 },
          ].map((b) => (
            <div key={b.name} className="card" style={{ '--h': b.hue }}>
              <span className="card-top">
                <span className="card-icon">
                  <Icon name="users" />
                </span>
                <span className="card-name">{b.name}</span>
              </span>
              <span className="card-count num">
                <strong>{b.n}</strong>
                <span>of {b.of} in</span>
              </span>
              <span className="meter">
                <i style={{ width: `${Math.round((b.n / b.of) * 100)}%` }} />
              </span>
            </div>
          ))}
        </div>

        <ul className="mock-feed">
          {[
            ['Kavindi Silva', 'tapped in', '08:03', 'pill in'],
            ['Nimal Perera', 'tapped out', '07:58', 'pill none'],
            ['Ruwan Fernando', 'tapped in', '07:52', 'pill in'],
          ].map(([name, what, time, cls]) => (
            <li key={name}>
              <Avatar name={name} small />
              <span className="mock-who">{name}</span>
              <span className={cls}>{what}</span>
              <span className="mock-time num">{time}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="toast success mock-toast">
        <span className="toast-icon">
          <Icon name="login" />
        </span>
        <span className="toast-body">
          <strong>Kavindi Silva tapped in</strong>
          <span>08:03 · Elementary 01</span>
        </span>
      </div>
    </div>
  );
}

export default function Landing() {
  usePageTitle('Smart student attendance');

  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-wrap l-nav-in">
          <Link to="/" className="brand">
            <Logo />
            <span>
              Attendance
            </span>
          </Link>
          <nav className="l-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#hardware">Hardware</a>
          </nav>
          <Link to="/login" className="btn">
            Sign in
          </Link>
        </div>
      </header>

      <section className="l-hero">
        <div className="l-wrap l-hero-in">
          <div className="l-hero-copy">
            <span className="l-badge">
              BrainBots STEM Academy · Smart Attendance
            </span>
            <h1>
              Attendance that{' '}
              <span className="l-grad">records itself.</span>
            </h1>
            <p className="l-lead">
              Students tap a card on the reader at the door. Teachers see who
              has arrived, who has left — <strong>the moment it happens</strong>,
              on any phone or screen, with no paper registers.
            </p>
            <div className="l-cta">
              <Link to="/login" className="btn l-btn-lg">
                🚀 Sign in to dashboard <Icon name="arrow-right" />
              </Link>
              <a href="#how" className="btn quiet l-btn-lg">
                See how it works
              </a>
            </div>
            <ul className="l-points">
              <li>
                <Icon name="check" /> Tap in &amp; tap out
              </li>
              <li>
                <Icon name="check" /> Live real-time updates
              </li>
              <li>
                <Icon name="check" /> Instant PDF reports
              </li>
              <li>
                <Icon name="check" /> Any phone or screen
              </li>
            </ul>
          </div>
          <Preview />
        </div>
      </section>


      <section className="l-section" id="features">
        <div className="l-wrap">
          <span className="l-eyebrow">Features</span>
          <h2 className="l-title">Everything a front desk needs, nothing it doesn't</h2>
          <p className="l-intro">
            Built around one gesture, a card tap, and a dashboard that stays out of the way.
          </p>
          <div className="l-features">
            {FEATURES.map((f) => (
              <article key={f.title} className="l-feature" style={{ '--h': f.hue }}>
                <span className="card-icon">
                  <Icon name={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section l-alt" id="how">
        <div className="l-wrap">
          <span className="l-eyebrow">How it works</span>
          <h2 className="l-title">Three steps, about a second each</h2>
          <div className="l-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="l-step">
                <span className="l-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-section" id="hardware">
        <div className="l-wrap l-hw">
          <div>
            <span className="l-eyebrow">Hardware</span>
            <h2 className="l-title">Simple, low-cost reader</h2>
            <p className="l-intro">
              An ESP32-C3 board with a PN532 card reader sends each tap to the server over an encrypted MQTT
              connection. The reader stores no student data.
            </p>
            <ul className="l-checks">
              <li>
                <Icon name="check" /> Green light and a beep for a registered card
              </li>
              <li>
                <Icon name="check" /> Red light and three beeps for an unknown card
              </li>
              <li>
                <Icon name="check" /> A separate signal when the network is down, so a fault is never mistaken
                for a rejected card
              </li>
            </ul>
          </div>

          <div className="l-flow" aria-label="Card to reader to server to dashboard">
            {[
              ['card', 'Card', 152],
              ['cpu', 'Reader', 212],
              ['lock', 'Secure server', 262],
              ['users', 'Dashboard', 24],
            ].map(([icon, label, hue], i) => (
              <div key={label} className="l-flow-item">
                {i > 0 && <span className="l-flow-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>}
                <span className="l-flow-node" style={{ '--h': hue }}>
                  <span className="card-icon">
                    <Icon name={icon} />
                  </span>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-band">
        <div className="l-wrap l-band-in">
          <div>
            <h2>Ready to see today's arrivals?</h2>
            <p>Sign in to open the live dashboard.</p>
          </div>
          <Link to="/login" className="btn l-btn-lg l-btn-light">
            Sign in <Icon name="arrow-right" />
          </Link>
        </div>
      </section>

      <footer className="l-footer">
        <div className="l-wrap l-footer-in">
          <Link to="/" className="brand">
            <Logo />
            <span>
              Attendance
            </span>
          </Link>
          <nav aria-label="Footer">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#hardware">Hardware</a>
            <Link to="/login">Sign in</Link>
          </nav>
          <small>© {new Date().getFullYear()} Smart student attendance</small>
        </div>
      </footer>
    </div>
  );
}
