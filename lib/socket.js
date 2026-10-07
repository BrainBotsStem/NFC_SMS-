import { io } from 'socket.io-client';
import { BASE, getToken } from './api.js';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(BASE || undefined, { auth: { token: getToken() }, autoConnect: true });
  }
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
