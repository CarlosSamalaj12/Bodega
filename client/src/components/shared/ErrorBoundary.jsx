import { Component } from 'react';
import { useRouteError } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Error Boundary genérico.
 * Atrapa errores de renderizado y muestra una UI de respaldo.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Registrar el error real en console sin depender del formateo de DevTools
    console.error('[ErrorBoundary]', error?.message || error, error?.stack || '');

    // Si es un error de importación dinámica (por ejemplo, porque cambió el hash en un deploy),
    // recargar la página limpia automáticamente para obtener la nueva versión de los assets.
    const errorMsg = (error?.message || '').toLowerCase();
    if (
      errorMsg.includes('failed to fetch') ||
      errorMsg.includes('dynamically imported module') ||
      errorMsg.includes('expected a javascript-or-wasm') ||
      errorMsg.includes('dynamic import') ||
      errorMsg.includes('load module script') ||
      errorMsg.includes('mime type')
    ) {
      console.warn('[ErrorBoundary] Falla de carga dinámica detectada. Forzando recarga de página...');
      window.location.reload();
    }
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      // Si se proporciona un fallback personalizado, usarlo
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.state.error, this.handleReset)
          : this.props.fallback;
      }

      return (
        <Card accent style={{ padding: '1.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            {this.props.message || 'Ocurrió un error al mostrar esta sección.'}
          </p>
          <Button variant="subtle" size="sm" onClick={this.handleReset}>
            Reintentar
          </Button>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Fallback de error para `errorElement` de React Router (rutas top-level).
 * Se usa en el router para que fallas de renderizado/loader/action de una ruta
 * raíz (login, layout, catch-all) caigan en una UI de respaldo de la app en
 * lugar del default genérico de React Router. Reutiliza la misma UI del
 * ErrorBoundary (Card + botón de reintento).
 */
export function RouteErrorFallback() {
  const error = useRouteError();
  const message =
    error?.message || error?.statusText || 'Ocurrió un error al cargar esta página.';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <Card accent style={{ padding: '1.5rem', textAlign: 'center', maxWidth: 420 }}>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          {message}
        </p>
        <Button variant="subtle" size="sm" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </Card>
    </div>
  );
}
