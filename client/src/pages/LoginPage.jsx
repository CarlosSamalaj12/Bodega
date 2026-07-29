import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/auth.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import './LoginPage.scss';

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(null);
  const [filter, setFilter] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef(null);
  const searchRef = useRef(null);

  // Cargar lista de usuarios al montar
  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    authService
      .listLoginUsers()
      .then((rows) => {
        if (cancelled) return;
        setUsers(Array.isArray(rows) ? rows : []);
        setUsersError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setUsersError(e?.message || 'No se pudieron cargar usuarios');
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Si ya está autenticado, redirige a la app
  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.full_name || '').toLowerCase().includes(q)
    );
  }, [users, filter]);

  const onSelectUser = (u) => {
    setSelectedUser(u);
    setUsername(u.username);
    setTimeout(() => {
      if (passwordRef.current) {
        passwordRef.current.focus();
        passwordRef.current.select?.();
      }
    }, 60);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    try {
      await login(username, password);
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch {
      // error ya está en el store
    }
  };

  const canSubmit = Boolean(username && password) && !isLoading;
  const selectedInit = selectedUser
    ? getInitials(selectedUser.full_name || selectedUser.username)
    : '?';

  return (
    <div className="login-page">
      <div className="login-page__panel">
        <div className="login-page__brand">
          <div className="login-page__logo">B</div>
          <h1 className="login-page__title">Bodega</h1>
          <p className="login-page__subtitle">Sistema de Inventario</p>
        </div>

        <div className="login-page__avatarWrap" data-has-user={Boolean(selectedUser)}>
          {selectedUser?.avatar_url ? (
            <img
              className="login-page__avatar"
              src={selectedUser.avatar_url}
              alt="Avatar usuario"
            />
          ) : selectedUser ? (
            <span className="login-page__avatarInitials">{selectedInit}</span>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
            </svg>
          )}
        </div>
        <div className="login-page__selectedName">
          {selectedUser
            ? (selectedUser.full_name || selectedUser.username)
            : 'Selecciona tu usuario'}
        </div>

        <div className="login-page__usersHeader">
          <span className="login-page__usersTitle">Usuarios</span>
          {!usersLoading && users.length > 0 && (
            <span className="login-page__usersCount">
              {filteredUsers.length}/{users.length}
            </span>
          )}
        </div>
        <div className="login-page__search">
          <span className="login-page__searchIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            ref={searchRef}
            className="login-page__searchInput"
            type="text"
            placeholder="Buscar por nombre..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="login-page__usersGrid" role="listbox" aria-label="Lista de usuarios">
          {usersLoading ? (
            <div className="login-page__usersEmpty">Cargando usuarios...</div>
          ) : usersError ? (
            <div className="login-page__usersEmpty">{usersError}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="login-page__usersEmpty">Sin resultados</div>
          ) : (
            filteredUsers.map((u) => {
              const init = getInitials(u.full_name || u.username);
              const isSelected = selectedUser?.username === u.username;
              return (
                <button
                  type="button"
                  key={u.username}
                  className={`login-page__userCard ${isSelected ? 'is-selected' : ''}`}
                  data-user={u.username}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelectUser(u)}
                >
                  <div className="login-page__userCardDot" aria-hidden="true">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" />
                    ) : (
                      <span>{init.charAt(0)}</span>
                    )}
                  </div>
                  <div className="login-page__userCardBody">
                    <div className="login-page__userCardName">
                      {u.full_name || u.username}
                    </div>
                    <div className="login-page__userCardUser">@{u.username}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <form className="login-page__form" onSubmit={onSubmit}>
          <div className="login-page__passwordField">
            <Input
              ref={passwordRef}
              label="Contrasena"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={storeError}
            />
            <button
              type="button"
              className={`login-page__togglePass ${showPassword ? 'is-showing' : ''}`}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
              title="Mostrar/ocultar contrasena"
            >
              <svg className="login-page__iconEye" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg className="login-page__iconEyeOff" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 6.1A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.9" />
                <path d="M6.1 6.2A17.4 17.4 0 0 0 2 12s3.5 6 10 6a10.6 10.6 0 0 0 4.4-1" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            </button>
          </div>
          <Button type="submit" variant="primary" size="lg" block disabled={!canSubmit}>
            {isLoading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
