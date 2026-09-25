import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { User } from './models.js';

// Usage: npm run set-admin -- <username> <password>          (student side)
//        npm run set-admin -- --staff <username> <password>  (staff side)
//        npm run set-admin -- --super <username> <password>  (both sides)
const args = process.argv.slice(2);
const FLAGS = { '--staff': 'staffadmin', '--super': 'superadmin' };
const role = FLAGS[args[0]] || 'admin';
const [username, password] = FLAGS[args[0]] ? args.slice(1) : args;

if (!username || !password) {
  console.error('Usage: npm run set-admin -- [--staff | --super] <username> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('The password must be at least 8 characters.');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);

const passwordHash = await bcrypt.hash(password, 10);
const admin = await User.findOne({ role });

if (admin) {
  admin.username = username;
  admin.passwordHash = passwordHash;
  await admin.save();
  console.log(`[admin] updated. Sign in as "${admin.username}" with the new password.`);
} else {
  await User.create({ username, passwordHash, role });
  console.log(`[admin] created "${username.toLowerCase()}".`);
}

await mongoose.disconnect();
