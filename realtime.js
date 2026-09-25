let io = null;

export function setIo(instance) {
  io = instance;
}

/**
 * Broadcast to connected dashboards. No-op before the server is up.
 * room: a role ("admin" for the student side, "staffadmin" for the staff
 * side) to reach only that side; omitted, every dashboard gets it.
 */
export function emit(event, payload, room) {
  if (!io) return;
  (room ? io.to(room) : io).emit(event, payload);
}
