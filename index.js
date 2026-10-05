import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import { config } from './config.js';
import { setIo } from './realtime.js';
import { startMqtt, mqttState, readerStatuses, brokerStatus } from './mqtt.js';
import authRoutes from './routes/auth.js';
import batchRoutes from './routes/batches.js';
import studentRoutes from './routes/students.js';
import enrolRoutes from './routes/enrol.js';
import attendanceRoutes from './routes/attendance.js';
import reportRoutes from './routes/reports.js';
import staffRoutes from './routes/staff.js';
import notificationRoutes from './routes/notifications.js';
import { startNotifier } from './notify.js';


const app = express();
app.use(cors());
app.use(express.json());

// Serve built React frontend in production
app.use(express.static(path.join(__dirname, 'dist')));
let dbError = '';
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : dbError || 'connecting',
    mqtt: mqttState(),
  })
);
app.use('/api/auth', authRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/enrol', enrolRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/notifications', notificationRoutes);

// Catch-all: send React app for any non-API route (React Router handles it)
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
);

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Something went wrong on the server.' });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  try {
    socket.data.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    next(new Error('unauthorised'));
  }
});

setIo(io);

io.on('connection', (socket) => {
  // Student taps go to the "admin" room, staff taps to "staffadmin". The super
  // admin hears both, plus its own room for cards it is enrolling.
  const { role } = socket.data.user;
  socket.join(role === 'superadmin' ? ['superadmin', 'admin', 'staffadmin'] : role);
  socket.emit('broker:status', brokerStatus());
  for (const status of readerStatuses()) socket.emit('reader:status', status);
});

// Listen first, so the host sees a running app even while the database is
// unreachable; a crash here shows only as a 503 with no clue why.
server.listen(config.port, () => console.log(`[api] listening on ${config.port}`));

process.on('unhandledRejection', (err) => console.error('[process] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[process] uncaught exception:', err));

async function connectDb() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
    console.log('[db] connected');
    startMqtt();
    await startNotifier();
  } catch (err) {
    dbError = err.message;
    console.error('[db] connection failed, retrying in 15s:', err.message);
    setTimeout(connectDb, 15_000);
  }
}
connectDb();
