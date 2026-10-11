import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
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
          <LogOut size={15} strokeWidth={1.8} aria-hidden="true" />
          {!isMobile && <span>Salir</span>}
        </Button>
      </div>
    </header>
  );
}
