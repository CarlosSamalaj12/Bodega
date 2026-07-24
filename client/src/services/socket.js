import { io } from 'socket.io-client';

// Conexión singleton a Socket.IO del backend
// Usa el proxy de Vite (mismo origin) en dev.
let socket = null;

export function getSocket() {
  if (socket) return socket;

  const token = localStorage.getItem('token');
  socket = io({
    path: '/socket.io',
    auth: { token: token || '' },
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
