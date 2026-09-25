import crypto from 'node:crypto';
import mqtt from 'mqtt';
import { config } from './config.js';
import { handleScan, setEnrolListener } from './scan.js';
import { emit } from './realtime.js';
import { Student, Staff, ProcessedTap } from './models.js';

/*
 * Topics, all under MQTT_TOPIC_ROOT (bb/att):
 *
 *   <root>/<device>/scan    reader -> server   a tap
 *                             {"uid","t","a","id"}  stored on the reader, replayed; answered with an ack
 *                             {"uid","n"}          live tap (unknown card / enrolment); answered with cmd
 *   <root>/<device>/ack     server -> reader   {"id"}  the stored tap is safe, delete it
 *   <root>/<device>/cmd     server -> reader   {"result","n"}  answer to a live tap
 *   <root>/<device>/time    server -> reader   {"t": unix seconds}  clock, for when NTP is blocked
 *   <root>/<device>/status  reader -> server   online / offline (retained)
 *   <root>/<device>/beat    reader -> server   heartbeat every few seconds, so a reader that
 *                                              loses power shows as off quickly
 *   <root>/roster           server -> readers  "<version>|UID,UID,..." (retained) every registered card
 *   <root>/enrol            server -> readers  {"open":1,"secs":60} enrolment window
 */

const root = config.mqtt.topicRoot;
let client = null;
const readers = new Map(); // deviceId -> { status: "online" | "offline", lastSeen, beats }

// A reader that sends heartbeats and then goes quiet this long is shown as off.
// Without heartbeats (older firmware) the broker's "offline" message is used,
// which arrives about 1.5 x the reader's keepalive later.
const BEAT_TIMEOUT_MS = 8000;

// The whole roster travels in one message. The reader's buffer is 16 KB.
const ROSTER_MAX_BYTES = 15000;

/** Last known status of every reader, so a dashboard that opens later still shows it. */
export function readerStatuses() {
  return [...readers].map(([deviceId, r]) => ({ deviceId, status: r.status }));
}

/** Records what we now know about a reader, and tells the dashboards if it changed. */
function setReader(deviceId, status, { beat = false } = {}) {
  let r = readers.get(deviceId);
  if (!r) readers.set(deviceId, (r = { status: null, lastSeen: 0, beats: false }));
  if (status === 'online') r.lastSeen = Date.now();
  if (beat) r.beats = true;
  if (r.status === status) return;
  r.status = status;
  console.log(`[reader] ${deviceId} ${status}`);
  emit('reader:status', { deviceId, status });
}

// Marks a heartbeat reader off once it goes quiet. Skipped while the server's
// own broker link is down, since then silence says nothing about the reader.
setInterval(() => {
  if (!state.connected) return;
  const now = Date.now();
  for (const [deviceId, r] of readers) {
    if (r.beats && r.status === 'online' && now - r.lastSeen > BEAT_TIMEOUT_MS) setReader(deviceId, 'offline');
  }
}, 1000).unref();

// Lets the dashboard explain why a card tap is not arriving, instead of waiting silently.
const state = { configured: false, connected: false, error: '' };

/** Whether the server itself is connected to the broker, sent to each dashboard as it connects. */
export function brokerStatus() {
  return { connected: state.connected };
}

export function mqttState() {
  let message = '';
  if (!state.configured) message = 'MQTT_URL is not set in .env, so the server is not listening for the reader.';
  else if (!state.connected && /not authori[sz]ed|bad user/i.test(state.error))
    message = 'HiveMQ refused the login. Check MQTT_USERNAME and MQTT_PASSWORD in .env, then restart the server.';
  else if (!state.connected) message = state.error || 'Connecting to the HiveMQ broker...';
  return { configured: state.configured, connected: state.connected, message };
}

/**
 * Sends every registered card to the readers, so they can accept or refuse a
 * tap on their own with no network. Retained, so a reader that connects later
 * still gets the current list. Called at start-up and whenever students change.
 */
export async function publishRoster() {
  if (!client?.connected) return; // sent again on the next connect
  // Students and staff tap the same reader, so it holds both.
  const [students, staff] = await Promise.all([Student.find({}, 'uid').lean(), Staff.find({}, 'uid').lean()]);
  const uids = [...students, ...staff].map((s) => s.uid).sort();
  const list = uids.join(',');
  // The version only changes when the list does, so a reader skips a needless flash write.
  const version = crypto.createHash('sha1').update(list).digest('hex').slice(0, 10);
  const payload = `${version}|${list}`;
  if (payload.length > ROSTER_MAX_BYTES) {
    console.error(`[mqtt] roster is ${payload.length} bytes, over the ${ROSTER_MAX_BYTES} the reader can hold.`);
    return;
  }
  client.publish(`${root}/roster`, payload, { qos: 1, retain: true });
  console.log(`[mqtt] roster sent: ${uids.length} cards`);
}

/** Tap time from the reader, or now if it is missing or clearly wrong. */
function tapTime(t) {
  const ms = Number(t) * 1000;
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (!ms || ms > now + 60_000 || ms < now - thirtyDays) return new Date(now);
  return new Date(ms);
}

async function onMessage(topic, buf) {
  const parts = topic.split('/');
  const deviceId = parts[parts.length - 2];
  const kind = parts[parts.length - 1];
  const raw = buf.toString();

  if (kind === 'beat') {
    setReader(deviceId, 'online', { beat: true });
    return;
  }

  if (kind === 'status') {
    if (raw !== 'online' && raw !== 'offline') return;
    setReader(deviceId, raw);
    // A reader that cannot reach an NTP server still gets the right time from here.
    if (raw === 'online') {
      client.publish(`${root}/${deviceId}/time`, JSON.stringify({ t: Math.floor(Date.now() / 1000) }), { qos: 0 });
    }
    return;
  }

  if (kind !== 'scan') return;
  setReader(deviceId, 'online'); // a tap only arrives from a connected reader

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn('[mqtt] unreadable scan payload:', raw);
    return;
  }

  if (msg.id) {
    // A tap the reader stored itself. It is replayed until acknowledged, so the
    // same id can arrive more than once; each is processed exactly once.
    const eventId = `${deviceId}:${msg.id}`;
    if (!(await ProcessedTap.exists({ eventId }))) {
      await handleScan({ uid: msg.uid, deviceId, at: tapTime(msg.t), live: false });
      await ProcessedTap.create({ eventId }).catch(() => {});
    }
    client.publish(`${root}/${deviceId}/ack`, JSON.stringify({ id: msg.id }), { qos: 1 });
    return;
  }

  // A live tap: the reader is waiting for a verdict (enrolment, or a card it does not know).
  let result = 'deny';
  try {
    result = await handleScan({ uid: msg.uid, deviceId, live: true });
  } catch (err) {
    console.error('[mqtt] scan failed:', err.message);
  }
  // n echoes the reader's request number, so a late answer is never mistaken for a newer tap.
  client.publish(`${root}/${deviceId}/cmd`, JSON.stringify({ result, n: msg.n }), { qos: 1 });
}

// Taps are handled one at a time, in arrival order. A reader coming back online
// sends its backlog quickly, and in/out depends on the order of a student's taps.
let queue = Promise.resolve();

export function startMqtt() {
  if (!config.mqtt.url) {
    console.warn('[mqtt] MQTT_URL not set, running without a reader connection.');
    return;
  }

  state.configured = true;
  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    clean: true,
    keepalive: 20,
    connectTimeout: 10_000,
    reconnectPeriod: 2000,
  });

  setEnrolListener(({ open, secs }) => {
    if (!client?.connected) return;
    client.publish(`${root}/enrol`, JSON.stringify({ open: open ? 1 : 0, secs: secs || 0 }), { qos: 1 });
  });

  client.on('connect', () => {
    state.connected = true;
    state.error = '';
    console.log('[mqtt] connected');
    // Heartbeats were not seen while the link was down; start their clock again.
    for (const r of readers.values()) r.lastSeen = Date.now();
    emit('broker:status', brokerStatus());
    client.subscribe([`${root}/+/scan`, `${root}/+/status`], { qos: 1 });
    client.subscribe(`${root}/+/beat`, { qos: 0 });
    publishRoster().catch((err) => console.error('[mqtt] roster failed:', err.message));
  });

  client.on('error', (err) => {
    state.error = err.message;
    console.error('[mqtt] error:', err.message);
  });
  client.on('close', () => {
    if (state.connected) console.warn('[mqtt] connection to the broker lost');
    state.connected = false;
    emit('broker:status', brokerStatus());
  });
  client.on('reconnect', () => console.log('[mqtt] reconnecting'));

  client.on('message', (topic, buf) => {
    queue = queue
      .then(() => onMessage(topic, buf))
      .catch((err) => console.error('[mqtt] message failed:', err.message));
  });
}
