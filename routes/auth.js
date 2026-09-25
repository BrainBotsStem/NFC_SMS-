import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models.js';
import { signToken, requireAuth } from '../auth.js';
import { asyncHandler } from '../asyncHandler.js';

const router = Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required.' });

    const user = await User.findOne({ username: String(username).toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid username or password.' });

    const token = signToken(user);
    res.json({ token, user: { username: user.username, role: user.role } });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.sub).select('username role');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { username: user.username, role: user.role } });
  })
);

export default router;
