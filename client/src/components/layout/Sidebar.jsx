import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import './Sidebar.scss';

// Ítems de navegación
const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: '◉', section: 'home' },
  { to: '/entradas', label: 'Entradas', icon: '⇣', section: 'entradas' },
  { to: '/salidas', label: 'Salidas', icon: '⇡', section: 'salidas' },
  { to: '/pedidos', label: 'Realizar pedidos', icon: '✎', section: 'pedidos' },
  { to: '/pedidos-despachar', label: 'Pedidos x Despachar', icon: '⇢', section: 'pedidos-despachar' },
  { to: '/productos', label: 'Productos', icon: '◧', section: 'productos' },
  { to: '/categorias', label: 'Categorías', icon: '◫', section: 'categorias' },
  { to: '/subcategorias', label: 'Subcategorías', icon: '◳', section: 'subcategorias' },
  { to: '/proveedores', label: 'Proveedores', icon: '◊', section: 'proveedores' },
  { to: '/medidas', label: 'Medidas', icon: '⊟', section: 'medidas' },
  { to: '/motivos', label: 'Motivos', icon: '◐', section: 'motivos' },
  { to: '/usuarios', label: 'Usuarios', icon: '◐', section: 'usuarios' },
  { to: '/bodegas', label: 'Bodegas', icon: '⬚', section: 'bodegas' },
];

function SidebarContent({ onLinkClick }) {
  const user = useAuthStore((s) => s.user);
  const permissions = user?.permisos || {};

  const visibleItems = NAV_ITEMS.filter((item) => {
    const key = `section.view.${item.section}`;
    if (!permissions || Object.keys(permissions).length === 0) return true;
    return permissions[key] !== false;
  });

  return (
    <>
      <div className="sidebar__brand">
        <div className="sidebar__logo">B</div>
        <div>
          <div className="sidebar__brand-name">Bodega</div>
          <div className="sidebar__brand-sub">Inventario</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Navegación principal">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onLinkClick}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
            }
          >
            <span className="sidebar__icon" aria-hidden="true">{item.icon}</span>
            <span className="sidebar__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
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
 * - Desktop: renderiza la barra lateral estática (sticky)
 * - Móvil: solo se monta cuando el usuario abre el drawer (hamburguesa)
 */
export function Sidebar({ isDesktop = true, isOpen = false, onClose }) {
  // ---------- Móvil: drawer temporal ----------
  if (!isDesktop) {
    if (!isOpen) return null; // no se renderiza hasta que el user lo abra
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
    <aside className="sidebar">
      <SidebarContent />
    </aside>
  );
}
