import { io } from 'socket.io-client';

// Conexión singleton a Socket.IO del backend
// Usa el proxy de Vite (mismo origin) en dev.
let socket = null;

export function getSocket() {
  if (socket) return socket;

  socket = io({
    path: '/socket.io',
    // La sesión viaja en la cookie HttpOnly; el server la lee del handshake.
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  socket.on('connect_error', (err) => {
    console.warn('[socket] connect_error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
