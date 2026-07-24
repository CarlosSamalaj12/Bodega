import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import './AppLayout.scss';

export function AppLayout() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Cierra el drawer en móvil al cambiar de ruta
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false);
  }, [location.pathname, isDesktop]);

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
