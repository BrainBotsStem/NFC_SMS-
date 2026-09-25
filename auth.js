import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }
}

/** The student side: its own admin, or the super admin. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

/** The staff side, which has its own sign-in; the super admin also gets in. */
export function requireStaffAdmin(req, res, next) {
  if (req.user?.role !== 'staffadmin' && req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Staff attendance access only.' });
  }
  next();
}

/** Either side: used by the shared card reader features, such as enrolling a card. */
export function requireAnyAdmin(req, res, next) {
  if (!['admin', 'staffadmin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}
