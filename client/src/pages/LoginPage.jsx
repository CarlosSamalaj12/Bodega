import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import './LoginPage.scss';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Si ya está autenticado, redirige a la app
  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(username, password);
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } catch {
      // error ya está en el store
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__panel">
        <div className="login-page__brand">
          <div className="login-page__logo">B</div>
          <h1 className="login-page__title">Bodega</h1>
          <p className="login-page__subtitle">Sistema de Inventario</p>
        </div>

        <form className="login-page__form" onSubmit={handleSubmit}>
          <Input
            label="Usuario"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
          <Input
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            error={error}
          />
          <Button type="submit" variant="primary" size="lg" block disabled={isLoading}>
            {isLoading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
