import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Enter a username and password.' });
  }
  const user = await User.findOne({ username: String(username).toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'That username and password do not match.' });
  }
  res.json({
    token: signToken(user),
    user: { username: user.username, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role } });
});

export default router;
