import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/attendance',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  timezone: process.env.TZ_NAME || 'Asia/Colombo',
  intakeYear: process.env.INTAKE_YEAR || '26',

  // A tap after the in time becomes the out time once this long has passed.
  // Anything sooner is treated as an accidental double tap and ignored.
  minOutGapMs: Number(process.env.OUT_MIN_MINUTES || 10) * 60 * 1000,

  // After an out time, a tap sooner than this is an accidental double tap.
  // A later tap is the in time of the next class the same day.
  minRejoinGapMs: Number(process.env.REJOIN_MIN_SECONDS || 60) * 1000,

  // A class with no out tap is closed after this long, so a student who forgot
  // to tap out does not have their next day's in tap taken as an out time.
  visitWindowMs: Number(process.env.VISIT_WINDOW_HOURS || 12) * 60 * 60 * 1000,

  // How long the reader waits for a card after admin presses "Add student".
  enrollWindowMs: Number(process.env.ENROLL_WINDOW_SECONDS || 60) * 1000,

  mqtt: {
    url: process.env.MQTT_URL || '',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    topicRoot: process.env.MQTT_TOPIC_ROOT || 'bb/att',
  },

  seedAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  // Runs both the student and the staff side.
  seedSuperAdmin: {
    username: process.env.SUPER_ADMIN_USERNAME || 'superadmin',
    password: process.env.SUPER_ADMIN_PASSWORD || 'superadmin123',
  },

  // The staff attendance side has its own sign-in.
  seedStaffAdmin: {
    username: process.env.STAFF_ADMIN_USERNAME || 'staff',
    password: process.env.STAFF_ADMIN_PASSWORD || 'staff123',
  },
};

if (config.jwtSecret === 'change-me-in-production') {
  console.warn('[config] JWT_SECRET is not set. Set it before deploying.');
}
