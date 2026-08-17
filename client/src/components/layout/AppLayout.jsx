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
import { useShortcutsStore } from '@/stores/shortcuts.store';
import { Shortcuts } from '@/hooks/useShortcut.jsx';
import { ShortcutsHelpModal } from '@/components/shared/ShortcutsHelpModal';
import './AppLayout.scss';

export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const notifyNew = useDispatchStore((s) => s.notifyNew);
  const pushInitRef = useRef(false);
  const permsBootstrappedRef = useRef(false);

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

  // Sincronizar permisos con el server al montar. El store se hidrata desde
  // localStorage (snapshot del último login), que puede quedar desfasado si
  // el server agregó permisos nuevos al catálogo o si el usuario actual fue
  // editado por otro admin. Refrescar en mount garantiza que la UI
  // (sidebar, Ajustes, etc.) siempre refleje la DB. Si el JWT expiró, el
  // interceptor de axios manda a /login. Si hay error de red, simplemente
  // seguimos con el snapshot local; el próximo mount lo reintenta.
  useEffect(() => {
    if (!isAuthenticated || permsBootstrappedRef.current) return;
    permsBootstrappedRef.current = true;
    useAuthStore.getState().refreshPermisos().catch(() => {
      // Silenciar: el interceptor ya manejó 401, los errores de red
      // se toleran y el próximo mount vuelve a intentar.
    });
  }, [isAuthenticated]);

  // Cargar atajos personalizados del usuario (en paralelo al refresh de
  // permisos). Fire-and-forget; si falla, los defaults siguen activos.
  useEffect(() => {
    if (!isAuthenticated) return;
    useShortcutsStore.getState().load();
  }, [isAuthenticated]);

  // ── Atajos globales (disponibles en cualquier pantalla) ──
  const openHelp = () => setShortcutsHelpOpen(true);
  const closeHelp = () => setShortcutsHelpOpen(false);

  const globalShortcuts = (
    <Shortcuts
      map={{
        'help.showShortcuts': { handler: openHelp },
        'modal.close': { handler: closeHelp },
        'nav.goHome': { handler: () => navigate('/') },
        'nav.goAjustes': { handler: () => navigate('/ajustes') },
      }}
    />
  );

  // Cierra el drawer en móvil al cambiar de ruta
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false);
  }, [location.pathname, isDesktop]);

  // Socket.IO: notificaciones en tiempo real
  useEffect(() => {
    const socket = getSocket();

    // Asegurar reconexión del socket tras el inicio de sesión para que tome las cookies HttpOnly
    if (!socket.connected) {
      socket.connect();
    }

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

    // ---- Permisos / cuenta cambiados (admin editó este usuario en vivo) ----
    const permisosHandler = async (payload) => {
      const kind = String(payload?.kind || 'permisos');

      // "bodegas-acceso" no afecta user.permisos (el scope se calcula server-side
      // en cada request), pero la data ya cargada en la página actual queda stale.
      // Avisamos al usuario y le damos la opción de recargar manualmente.
      if (kind === 'bodegas-acceso') {
        toast.info('Tu acceso a bodegas fue actualizado. Recarga la página para ver los cambios.', {
          duration: 0, // no auto-dismiss
          actionLabel: 'Recargar',
          onClick: () => window.location.reload(),
        });
        return;
      }

      // Para "permisos" / "user" / "deactivated" sí refrescamos el snapshot local.
      try {
        await useAuthStore.getState().refreshPermisos();
      } catch {
        // Si el refresh falla (token vencido, user desactivado), el interceptor
        // de axios ya se encarga de mandar al /login.
        return;
      }
      if (kind === 'deactivated') {
        toast.error('Tu cuenta fue desactivada. Contacta al administrador.', {
          duration: 8000,
        });
      } else if (kind === 'user') {
        toast.info('Tu usuario fue actualizado. Recarga para aplicar algunos cambios.', {
          duration: 5000,
          actionLabel: 'Recargar',
          onClick: () => window.location.reload(),
        });
      } else {
        toast.info('Tus permisos fueron actualizados. El menú se ha ajustado.', {
          duration: 5000,
        });
      }
    };
    socket.on('permisos:changed', permisosHandler);

    return () => {
      socket.off('pedido:changed', pedidoHandler);
      socket.off('movimiento:changed', movHandler);
      socket.off('permisos:changed', permisosHandler);
    };
  }, [notifyNew]);

  return (
    <div className={`app-layout ${!isDesktop && sidebarOpen ? 'app-layout--drawer-open' : ''}`}>
      {globalShortcuts}
      <Sidebar
        isDesktop={isDesktop}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      <main className={`app-layout__main ${!isDesktop ? 'app-layout__main--mobile' : ''}`}>
        <Outlet />
      </main>

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

      {/* Modal de ayuda de atajos (abre con Shift+/) */}
      <ShortcutsHelpModal
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />
    </div>
  );
}
