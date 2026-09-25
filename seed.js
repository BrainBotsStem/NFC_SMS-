import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { User, Batch, Department } from './models.js';

const BATCHES = [
  { name: 'Elementary 01', level: 'EL' },
  { name: 'Elementary 02', level: 'EL' },
  { name: 'Intermediate 01', level: 'IL' },
  { name: 'Intermediate 02', level: 'IL' },
  { name: 'Intermediate 03', level: 'IL' },
  { name: 'Intermediate 04', level: 'IL' },
  { name: 'Advanced Level 01', level: 'AL' },
  { name: 'Advanced Level 02', level: 'AL' },
];

await mongoose.connect(config.mongoUri);

for (const [i, b] of BATCHES.entries()) {
  await Batch.updateOne({ name: b.name }, { $set: { ...b, order: i } }, { upsert: true });
}
console.log(`[seed] ${BATCHES.length} batches ready`);

// Starting departments for the staff side; more can be added from the dashboard.
if ((await Department.countDocuments()) === 0) {
  await Department.insertMany([
    { name: 'Teachers', order: 1 },
    { name: 'Office', order: 2 },
  ]);
  console.log('[seed] 2 staff departments ready');
}

async function upsertUser({ username, password }, role) {
  const existing = await User.findOne({ username: username.toLowerCase() });
  if (existing) {
    console.log(`[seed] ${role} "${username}" already exists, password unchanged`);
    return;
  }
  await User.create({
    username: username.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role,
  });
  console.log(`[seed] created ${role} "${username}"`);
}

await upsertUser(config.seedAdmin, 'admin');
await upsertUser(config.seedStaffAdmin, 'staffadmin');
await upsertUser(config.seedSuperAdmin, 'superadmin');

await mongoose.disconnect();
