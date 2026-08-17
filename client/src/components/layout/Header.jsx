import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useScrollDirection } from '@/hooks/useScrollDirection';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { SocketStatus } from '@/components/ui/SocketStatus';
import './Header.scss';

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

export function Header({ title, subtitle, actions, autoHide = false }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Detectar dirección de scroll para auto-hide. Solo cuando autoHide=true.
  // El hook ya devuelve 'up' cuando estamos en el top, así que el header
  // siempre se ve en esa zona.
  const scrollDir = useScrollDirection({ threshold: 8 });
  const hidden = autoHide && scrollDir === 'down';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const displayName = user?.full_name || user?.username || 'Usuario';
  const roleName = user?.role_name || '';
  const initials = getInitials(displayName);
  const userTitle = `${displayName}${roleName ? ' · ' + roleName : ''}`;

  const className = `header${hidden ? ' header--hidden' : ''}`;

  return (
    <header className={className} data-auto-hide={autoHide ? 'true' : 'false'}>
      <div className="header__title">
        <h1 className="header__h1">{title}</h1>
        {subtitle && <p className="header__subtitle">{subtitle}</p>}
      </div>

      <div className="header__right">
        {actions && <div className="header__actions">{actions}</div>}
        <SocketStatus />
        <ThemeToggle />
        <div className="header__user" title={userTitle}>
          <span className="header__avatar" aria-hidden="true">{initials}</span>
          <span className="header__user-text">
            <span className="header__user-name">{displayName}</span>
            {roleName && <span className="header__user-role">{roleName}</span>}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly={isMobile}
          onClick={handleLogout}
          className="header__logout"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          {isMobile ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          ) : 'Salir'}
        </Button>
      </div>
    </header>
  );
}
