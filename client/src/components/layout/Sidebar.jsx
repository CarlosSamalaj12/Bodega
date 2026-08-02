import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useDispatchStore } from '@/stores/dispatch.store';
import { hasPermission } from '@/utils/permissions';
import api from '@/services/api';
import { getSocket } from '@/services/socket';
import './Sidebar.scss';

// Grupos de navegación (orden de aparición)
const GROUP_ORDER = ['dashboard', 'movimientos', 'inventario', 'reportes', 'admin'];
const GROUP_LABELS = {
  dashboard: '', // sin título
  movimientos: 'Movimientos',
  inventario: 'Inventario',
  reportes: 'Reportes',
  admin: 'Administración',
};

// Ítems de navegación
const NAV_ITEMS = [
  // Dashboard
  { to: '/', label: 'Inicio', icon: '🏠', section: 'home', group: 'dashboard' },
  { to: '/ajustes', label: 'Ajustes', icon: '⚙️', section: 'ajustes', group: 'dashboard' },

  // Movimientos
  { to: '/entradas', label: 'Entradas', icon: '📥', section: 'entradas', group: 'movimientos' },
  { to: '/salidas', label: 'Salidas', icon: '📤', section: 'salidas', group: 'movimientos' },
  { to: '/pedidos', label: 'Realizar pedidos', icon: '📋', section: 'pedidos', group: 'movimientos' },
  { to: '/pedidos-despachar', label: 'Pedidos x Despachar', icon: '🚚', section: 'pedidos-despachar', group: 'movimientos' },
  { to: '/transferencias', label: 'Transferencias', icon: '🔄', section: 'movimientos', group: 'movimientos' },

  // Inventario
  { to: '/productos', label: 'Productos', icon: '📦', section: 'productos', group: 'inventario' },
  { to: '/existencias', label: 'Existencias', icon: '📊', section: 'existencias', group: 'inventario' },
  { to: '/alertas', label: 'Alertas', icon: '⚠️', section: 'alertas', group: 'inventario' },
  { to: '/conteo-ciclico', label: 'Conteo Cíclico', icon: '📋', section: 'conteo-ciclico', group: 'inventario' },

  // Reportes
  { to: '/kardex', label: 'Kardex por producto', icon: '📒', section: 'kardex', group: 'reportes' },
  { to: '/kardex-general', label: 'Kardex general', icon: '📋', section: 'kardex-general', group: 'reportes' },
  { to: '/reporte-entradas', label: 'R. Entradas', icon: '📈', section: 'r-entradas', group: 'reportes' },
  { to: '/reporte-salidas', label: 'R. Salidas', icon: '📉', section: 'r-salidas', group: 'reportes' },
  { to: '/corte-diario', label: 'Corte Diario', icon: '📅', section: 'r-corte-diario', group: 'reportes' },
  { to: '/cuadre-caja', label: 'Cuadre Caja', icon: '💰', section: 'cuadre-caja', group: 'reportes' },
  { to: '/reporte-pedidos', label: 'R. Pedidos', icon: '📋', section: 'r-pedidos', group: 'reportes' },
  { to: '/tendencia-producto', label: 'Tendencia Producto', icon: '📈', section: 'tendencia-producto', group: 'reportes' },
  { to: '/auditoria-sensibles', label: 'Auditoría Sensibles', icon: '🔍', section: 'r-auditoria-sensibles', group: 'reportes' },

  // Administración
  { to: '/categorias', label: 'Categorías / Subcategorías', icon: '🗂️', section: 'categorias', group: 'admin' },
  { to: '/proveedores', label: 'Proveedores', icon: '🤝', section: 'proveedores', group: 'admin' },
  { to: '/medidas', label: 'Medidas', icon: '📏', section: 'medidas', group: 'admin' },
  { to: '/motivos', label: 'Motivos', icon: '💡', section: 'motivos', group: 'admin' },
  { to: '/usuarios', label: 'Usuarios', icon: '👤', section: 'usuarios', group: 'admin' },
  { to: '/bodegas', label: 'Bodegas', icon: '🏢', section: 'bodegas', group: 'admin' },
  { to: '/reglas-subcategorias', label: 'Reglas Subcategorías', icon: '⚙️', section: 'reglas-subcategorias', group: 'admin' },
  { to: '/limites', label: 'Límites Mín/Máx', icon: '⚖️', section: 'limites', group: 'admin' },
];

function SidebarContent({ onLinkClick, collapsed, onToggle }) {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permisos || {};
  const newDispatchCount = useDispatchStore((s) => s.newCount);
  const [logoApp, setLogoApp] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const lastAlertCountRef = useRef(0);

  useEffect(() => {
    const idWh = Number(user?.id_warehouse || 0);
    if (!idWh) return;
    let cancelled = false;
    api.get(`/api/bodegas/${idWh}/logo`).then(({ data }) => {
      if (!cancelled && data?.logo_app_data) {
        setLogoApp(data.logo_app_data);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id_warehouse]);

  // ── Conteo de alertas activas ──
  const fetchAlertCount = useCallback(async () => {
    const idWh = Number(user?.id_warehouse || 0);
    if (!idWh) return;
    try {
      const [alertasRes, minimoRes] = await Promise.all([
        api.get('/api/reportes/existencias/alertas', { params: { days: 30, limit: 500 } }),
        api.get('/api/reportes/existencias/stock-minimo', { params: { limit: 500 } }),
      ]);
      const alertas = Array.isArray(alertasRes.data) ? alertasRes.data : [];
      const minimo = Array.isArray(minimoRes.data) ? minimoRes.data : [];
      // Para alertas de vencimiento, solo contar las críticas (vencidas o próximas 3 días)
      const criticas = alertas.filter((a) => {
        const d = a.dias_para_vencer;
        return (d != null && d < 0) || (d != null && d <= 3) ||
               (a.dias_restantes_regla != null && a.dias_restantes_regla <= 0);
      });
      const total = criticas.length + minimo.length;
      if (total !== lastAlertCountRef.current) {
        lastAlertCountRef.current = total;
        setAlertCount(total);
      }
    } catch {
      // Silencioso
    }
  }, [user?.id_warehouse]);

  useEffect(() => {
    if (!user?.id_warehouse) return;
    fetchAlertCount();

    // Refrescar cuando lleguen eventos de stock o pedidos
    let socket;
    try {
      socket = getSocket();
    } catch { return; }

    const onChanged = () => { fetchAlertCount(); };
    socket.on('stock:changed', onChanged);
    socket.on('pedido:changed', onChanged);

    return () => {
      socket.off('stock:changed', onChanged);
      socket.off('pedido:changed', onChanged);
    };
  }, [fetchAlertCount, user?.id_warehouse]);

  const visibleItems = NAV_ITEMS.filter((item) => {
    return hasPermission(permissions, `section.view.${item.section}`);
  });

  // Agrupar ítems visibles por grupo, respetando GROUP_ORDER
  const groupedItems = useMemo(() => {
    const map = new Map();
    for (const item of visibleItems) {
      const g = item.group || 'dashboard';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(item);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      label: GROUP_LABELS[g],
      items: map.get(g),
    }));
  }, [visibleItems]);

  return (
    <>
      <div className="sidebar__brand">
        {logoApp ? (
          <img className="sidebar__logo-img" src={logoApp} alt="Logo" />
        ) : (
          <div className="sidebar__logo">B</div>
        )}
        <div>
          <div className="sidebar__brand-name">Bodega</div>
          <div className="sidebar__brand-sub">Inventario</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Navegación principal">
        {groupedItems.map((group) => (
          <div key={group.group} className="sidebar__group">
            {group.label && (
              <div className="sidebar__section-title" aria-hidden="true">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isDispatchSection = item.section === 'pedidos-despachar';
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onLinkClick}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
                  }
                >
                  <span className="sidebar__icon" aria-hidden="true">{item.icon}</span>
                  <span className="sidebar__label">{item.label}</span>
                  {isDispatchSection && newDispatchCount > 0 && (
                    <span className="sidebar__badge" aria-label={`${newDispatchCount} pedido${newDispatchCount !== 1 ? 's' : ''} nuevo${newDispatchCount !== 1 ? 's' : ''}`}>
                      {newDispatchCount > 99 ? '99+' : newDispatchCount}
                    </span>
                  )}
                  {item.section === 'alertas' && alertCount > 0 && (
                    <span className="sidebar__badge sidebar__badge--alert" aria-label={`${alertCount} alerta${alertCount !== 1 ? 's' : ''} activa${alertCount !== 1 ? 's' : ''}`}>
                      {alertCount > 99 ? '99+' : alertCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        {onToggle && (
          <button
            type="button"
            className="sidebar__toggle"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            <span className={`sidebar__toggle-arrow ${collapsed ? 'sidebar__toggle-arrow--collapsed' : ''}`}>
              ◀
            </span>
            {!collapsed && <span className="sidebar__toggle-label">Colapsar</span>}
          </button>
        )}

        <div className="sidebar__user">
          <div className="sidebar__avatar">
            {(user?.full_name || user?.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="sidebar__user-info">
            <div className="sidebar__user-name">{user?.full_name || user?.username || 'Usuario'}</div>
            <div className="sidebar__user-role">{user?.role_name || '—'}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Sidebar
 * - Desktop: renderiza la barra lateral estática (sticky), colapsable manualmente
 * - Móvil: solo se monta cuando el usuario abre el drawer (hamburguesa)
 */
export function Sidebar({ isDesktop = true, isOpen = false, onClose }) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const handleToggle = () => {
    setCollapsed((prev) => !prev);
  };

  // Persistir el estado colapsado en un efecto, no dentro del updater
  // (React puede ejecutar el updater más de una vez y el side effect
  // de localStorage se repetiría con estado inconsistente).
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // ---------- Móvil: drawer temporal ----------
  if (!isDesktop) {
    if (!isOpen) return null;
    return (
      <>
        <aside className="sidebar sidebar--drawer" role="dialog" aria-modal="true">
          <SidebarContent onLinkClick={onClose} />
        </aside>
        <div
          className="sidebar__backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      </>
    );
  }

  // ---------- Desktop: barra estática colapsable ----------
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <SidebarContent collapsed={collapsed} onToggle={handleToggle} />
    </aside>
  );
}
