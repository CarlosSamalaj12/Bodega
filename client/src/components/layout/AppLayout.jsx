import { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/components/ui/Toast';
import { getSocket } from '@/services/socket';
import { useDispatchStore } from '@/stores/dispatch.store';
import { playNotificationSound } from '@/utils/sound';
import { useAlertNotifications } from '@/hooks/useAlertNotifications';
import { initPushService, subscribeToPush } from '@/services/push.service';
import { useAuthStore } from '@/stores/auth.store';
import './AppLayout.scss';

export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const notifyNew = useDispatchStore((s) => s.notifyNew);
  const pushInitRef = useRef(false);

  // Notificaciones de alertas (stock mínimo, vencimientos, etc.)
  useAlertNotifications();

  // Inicializar Push Notifications (una vez por sesión)
  useEffect(() => {
    if (!user?.id_warehouse || pushInitRef.current) return;
    pushInitRef.current = true;

    initPushService().then((ok) => {
      if (ok) {
        subscribeToPush(user.id_warehouse).catch(() => {});
      }
    });
  }, [user?.id_warehouse]);

  // Cierra el drawer en móvil al cambiar de ruta
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false);
  }, [location.pathname, isDesktop]);

  // Socket.IO: notificaciones en tiempo real
  useEffect(() => {
    const socket = getSocket();

    // Mapa para evitar duplicados rápidos
    const recent = new Map();

    /** Notificación genérica con debounce */
    const notify = (id, label, path, msg) => {
      const now = Date.now();
      const key = `${label}:${id}`;
      const last = recent.get(key);
      if (last && now - last < 10000) return;
      recent.set(key, now);
      for (const [k, ts] of recent) { if (now - ts > 30000) recent.delete(k); }

      playNotificationSound();

      const onTargetPage = window.location.pathname === path;
      if (!onTargetPage) {
        toast.info(msg, {
          duration: 8000,
          actionLabel: 'Abrir',
          onClick: () => navigate(`${path}?open=${id}`),
        });
      } else {
        toast.info(msg);
      }
    };

    // ---- Pedidos por despachar ----
    const pedidoHandler = (payload) => {
      const idPedido = Number(payload?.id_pedido || 0);
      if (!idPedido) return;

      const status = String(payload?.status || '').toUpperCase();
      const action = String(payload?.action || '').toLowerCase();
      const isNew = action === 'created' || action === 'new';
      const isDispatchable = ['PENDIENTE', 'APROBADO', 'PARCIAL'].includes(status);
      if (!isNew && !isDispatchable) return;

      if (window.location.pathname !== '/pedidos-despachar') {
        notifyNew(idPedido);
      }

      notify(
        idPedido, 'pedido', '/pedidos-despachar',
        `Nuevo pedido #${idPedido} recibido para despachar`
      );
    };
    socket.on('pedido:changed', pedidoHandler);

    // ---- Movimientos (entradas/salidas) ----
    const movHandler = (payload) => {
      const idMov = Number(payload?.id_movimiento || 0);
      if (!idMov) return;

      const tipo = String(payload?.tipo || payload?.tipo_movimiento || '').toUpperCase();
      const action = String(payload?.action || '').toLowerCase();
      if (action !== 'created' && action !== 'new') return;

      if (tipo === 'ENTRADA' || tipo === 'AJUSTE') {
        notify(
          idMov, 'entrada', '/entradas',
          `Nueva entrada #${idMov} registrada`
        );
      } else if (tipo === 'SALIDA') {
        notify(
          idMov, 'salida', '/salidas',
          `Nueva salida #${idMov} registrada`
        );
      }
    };
    socket.on('movimiento:changed', movHandler);

    return () => {
      socket.off('pedido:changed', pedidoHandler);
      socket.off('movimiento:changed', movHandler);
    };
  }, [notifyNew]);

  return (
    <div className={`app-layout ${!isDesktop && sidebarOpen ? 'app-layout--drawer-open' : ''}`}>
      <Sidebar
        isDesktop={isDesktop}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      {isDesktop && <div className="app-layout__main"><Outlet /></div>}
      {!isDesktop && (
        <main className="app-layout__main app-layout__main--mobile">
          <Outlet />
        </main>
      )}

      {/* Backdrop en móvil cuando el drawer está abierto */}
      {!isDesktop && sidebarOpen && (
        <div
          className="app-layout__backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Botón hamburguesa flotante en móvil */}
      {!isDesktop && (
        <button
          type="button"
          className="app-layout__menu-button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Abrir menú"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      )}
    </div>
  );
}
