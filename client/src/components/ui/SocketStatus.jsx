import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { getSocket } from '@/services/socket';

const STATUS = {
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  DISCONNECTED: 'disconnected',
};

/**
 * SocketStatus — indicador visual del estado de conexión Socket.IO.
 * Se muestra como un punto de color con tooltip.
 */
export function SocketStatus({ showLabel = false }) {
  const [status, setStatus] = useState(STATUS.CONNECTING);

  const updateStatus = useCallback((newStatus) => {
    setStatus(newStatus);
  }, []);

  useEffect(() => {
    let mounted = true;
    let socket;

    try {
      socket = getSocket();
    } catch {
      if (mounted) updateStatus(STATUS.DISCONNECTED);
      return;
    }

    const onConnect = () => {
      if (mounted) updateStatus(STATUS.CONNECTED);
    };
    const onDisconnect = () => {
      if (mounted) updateStatus(STATUS.DISCONNECTED);
    };
    const onConnectError = () => {
      if (mounted) updateStatus(STATUS.DISCONNECTED);
    };

    // Estado inicial
    if (socket.connected) {
      updateStatus(STATUS.CONNECTED);
    } else {
      updateStatus(STATUS.CONNECTING);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      mounted = false;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, [updateStatus]);

  const config = {
    [STATUS.CONNECTED]: {
      label: 'Conectado',
      title: 'Conexión en tiempo real activa',
      className: 'socket-status--online',
    },
    [STATUS.CONNECTING]: {
      label: 'Conectando…',
      title: 'Estableciendo conexión en tiempo real…',
      className: 'socket-status--connecting',
    },
    [STATUS.DISCONNECTED]: {
      label: 'Desconectado',
      title: 'Sin conexión en tiempo real',
      className: 'socket-status--offline',
    },
  };

  const { label, title, className } = config[status];

  return (
    <span
      className={`socket-status ${className}`}
      title={title}
      aria-label={title}
      role="status"
    >
      <span className="socket-status__dot" aria-hidden="true" />
      {showLabel && <span className="socket-status__label">{label}</span>}
    </span>
  );
}

SocketStatus.propTypes = {
  showLabel: PropTypes.bool,
};
