import { Component } from 'react';
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
