import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth.store';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { dashboardService } from '@/services/dashboard.service';
import { entradasService } from '@/services/entradas.service';
import { salidasService } from '@/services/salidas.service';
import { pedidosService } from '@/services/pedidos.service';
import './HomePage.scss';

const DashboardCharts = lazy(() => import('@/components/dashboard/DashboardCharts'));

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [resumen, setResumen] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [recentEntradas, setRecentEntradas] = useState([]);
  const [recentSalidas, setRecentSalidas] = useState([]);
  const [pedidosPendientes, setPedidosPendientes] = useState(0);

  const loadDashboard = useCallback(async () => {
    const d = days;
    setLoading(true);
    setTrendLoading(true);
    setTrendData(null);
    try {
      const [dash, entradas, salidas, pedidos] = await Promise.all([
        dashboardService.resumen({ days: d, mov_days: d }),
        // listAgrupado devuelve objetos con id_movimiento, total_cantidad, total_costo
        // (necesario para mostrar el resumen en la Home).
        entradasService.listAgrupado({ limit: 100 }),
        salidasService.listAgrupado({ limit: 100 }),
        pedidosService.list({ scope: 'dispatch' }),
      ]);

      setResumen(dash);
      setRecentEntradas(Array.isArray(entradas) ? entradas.slice(0, 5) : []);
      setRecentSalidas(Array.isArray(salidas) ? salidas.slice(0, 5) : []);

      // Cargar tendencia de movimientos
      dashboardService.trends(Math.min(d, 90)).then((td) => {
        if (Array.isArray(td)) setTrendData(td);
      }).catch(() => {}).finally(() => setTrendLoading(false));

      const pending = (Array.isArray(pedidos) ? pedidos : []).filter((p) => {
        const est = String(p.estado || '').toUpperCase();
        return ['PENDIENTE', 'APROBADO', 'PARCIAL'].includes(est);
      });
      setPedidosPendientes(pending.length);
    } catch (e) {
      const errMsg = e?.response?.data?.error;
      toast.error(typeof errMsg === 'string' ? errMsg : 'No se pudo cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, [days]);

  const handleDaysChange = useCallback((nd) => {
    setDays(nd);
    // El useEffect se encarga de llamar loadDashboard al cambiar days
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Normalizar los valores del resumen a números
  const r = useMemo(() => {
    const raw = resumen?.resumen;
    if (!raw) return null;
    return {
      productos_vigentes: Number(raw.productos_vigentes) || 0,
      productos_proximos: Number(raw.productos_proximos) || 0,
      productos_vencidos: Number(raw.productos_vencidos) || 0,
      productos_bajo_minimo: Number(raw.productos_bajo_minimo) || 0,
      productos_proximo_minimo: Number(raw.productos_proximo_minimo) || 0,
      cantidad_vigente: Number(raw.cantidad_vigente) || 0,
      cantidad_proxima: Number(raw.cantidad_proxima) || 0,
      cantidad_vencida: Number(raw.cantidad_vencida) || 0,
      total_dinero: raw.total_dinero != null ? Number(raw.total_dinero) : null,
    };
  }, [resumen]);

  const infoCards = useMemo(() => [
    {
      title: 'Productos vigentes',
      value: r?.productos_vigentes ?? '—',
      subtitle: `${r?.cantidad_vigente ?? 0} unidades`,
      variant: 'success',
      icon: '◉',
      to: '/productos',
    },
    {
      title: 'Próximos a vencer',
      value: r?.productos_proximos ?? '—',
      subtitle: `${r?.cantidad_proxima ?? 0} unidades`,
      variant: 'warning',
      icon: '◐',
      to: '/productos',
    },
    {
      title: 'Vencidos',
      value: r?.productos_vencidos ?? '—',
      subtitle: `${r?.cantidad_vencida ?? 0} unidades`,
      variant: 'danger',
      icon: '◌',
      to: '/productos',
    },
    {
      title: 'Stock bajo mínimo',
      value: r?.productos_bajo_minimo ?? '—',
      subtitle: `${r?.productos_proximo_minimo ?? 0} próximo${r?.productos_proximo_minimo === 1 ? '' : 's'}`,
      variant: 'danger',
      icon: '⬇',
      to: '/productos',
    },
    {
      title: 'Valor inventario',
      value: r?.total_dinero != null ? Number(r.total_dinero).toLocaleString('es-GT', { minimumFractionDigits: 2 }) : '—',
      subtitle: 'Costo total en existencia',
      variant: 'accent',
      icon: '₡',
    },
    {
      title: 'Pedidos x despachar',
      value: pedidosPendientes,
      subtitle: `${pedidosPendientes === 1 ? 'pedido pendiente' : 'pedidos pendientes'}`,
      variant: pedidosPendientes > 0 ? 'warning' : 'success',
      icon: '⇢',
      to: '/pedidos-despachar',
    },
  ], [r, pedidosPendientes]);

  const movimientoMas = resumen?.mas_movimiento;
  const movimientoMenos = resumen?.menos_movimiento;

  return (
    <>
      <Header
        title="Inicio"
        subtitle={`Bienvenido, ${user?.full_name || user?.username || 'usuario'}${resumen?.scope?.bodega_nombre ? ` · ${resumen.scope.bodega_nombre}` : ''}`}
        actions={
          <div className="home-page__header-actions">
            <div className="home-page__days-selector" role="group" aria-label="Rango de días">
              {[7, 15, 30, 60, 90].map((nd) => (
                <button
                  key={`hom-nd-${nd}`}
                  type="button"
                  className={`home-page__days-btn ${nd === days ? 'home-page__days-btn--active' : ''}`}
                  onClick={() => handleDaysChange(nd)}
                  disabled={loading}
                >
                  {nd}d
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={loadDashboard} disabled={loading}>
              {loading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        }
      />

      <div className="home-page">
        {loading && !resumen && (
          <div className="home-page__loading">
            <Spinner size={22} label="Cargando dashboard…" />
          </div>
        )}

        {!loading && !resumen && (
          <Card accent>
            <p>No se pudo cargar el dashboard. Verifica la conexión con el servidor.</p>
            <Button variant="subtle" onClick={loadDashboard}>Reintentar</Button>
          </Card>
        )}

        {/* Grid de tarjetas de resumen */}
        {resumen && (
          <div className="home-page__grid">
            {infoCards.map((card) => {
              const isClickable = card.to && Number(card.value) > 0;
              const Tag = isClickable ? 'button' : 'div';
              return (
                <Tag
                  key={`hom-${card.title}`}
                  className={`home-page__stat-card ${isClickable ? 'home-page__stat-card--clickable' : ''}`}
                  onClick={isClickable ? () => navigate(card.to) : undefined}
                  type={isClickable ? 'button' : undefined}
                >
                  <span className={`home-page__stat-icon home-page__stat-icon--${card.variant}`} aria-hidden="true">
                    {card.icon}
                  </span>
                  <div className="home-page__stat-body">
                    <span className="home-page__stat-value">{card.value}</span>
                    <span className="home-page__stat-title">{card.title}</span>
                    <span className="home-page__stat-subtitle">{card.subtitle}</span>
                  </div>
                </Tag>
              );
            })}
          </div>
        )}

        {/* Gráficas (lazy: Recharts se carga bajo demanda) */}
        {resumen && (
          <ErrorBoundary message="No se pudieron cargar las gráficas. Intenta refrescar la página." onReset={loadDashboard}>
            <Suspense fallback={<div className="home-page__loading"><Spinner size={18} label="Cargando gráficas…" /></div>}>
              <DashboardCharts
                resumen={resumen}
                trendData={trendData}
                trendLoading={trendLoading}
                days={Math.min(days, 90)}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        <div className="home-page__rows">
          {/* Producto con más movimiento */}
          {movimientoMas && (
            <Card title="Más movimiento" subtitle={`Producto que más salió en los últimos ${days} días`} compact accent>
              <div className="home-page__mov-item">
                <span className="home-page__mov-name">{String(movimientoMas.nombre_producto || '')}</span>
                {movimientoMas.sku && <code className="home-page__mov-sku">{String(movimientoMas.sku)}</code>}
                <Badge variant="warning">{Number(movimientoMas.cantidad_movimiento) || 0} u.</Badge>
              </div>
            </Card>
          )}

          {/* Producto con menos movimiento */}
          {movimientoMenos && (
            <Card title="Menos movimiento" subtitle={`Producto que menos salió en los últimos ${days} días`} compact>
              <div className="home-page__mov-item">
                <span className="home-page__mov-name">{String(movimientoMenos.nombre_producto || '')}</span>
                {movimientoMenos.sku && <code className="home-page__mov-sku">{String(movimientoMenos.sku)}</code>}
                <Badge variant="info">{Number(movimientoMenos.cantidad_movimiento) || 0} u.</Badge>
              </div>
            </Card>
          )}
        </div>

        <div className="home-page__rows">
          {/* Últimas entradas */}
          <Card
            title="Últimas entradas"
            subtitle={recentEntradas.length ? `Últimos ${recentEntradas.length} movimientos` : 'Sin entradas recientes'}
            actions={
              recentEntradas.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => navigate('/entradas')}>Ver todas</Button>
              )
            }
          >
            {recentEntradas.length > 0 ? (
              <div className="home-page__list">
                {recentEntradas.map((e) => (
                  <button
                    key={`hom-est-${e.id_movimiento}`}
                    type="button"
                    className="home-page__list-item"
                    onClick={() => navigate(`/entradas?open=${e.id_movimiento}`)}
                  >
                    <span className="home-page__list-id"><code>#{e.id_movimiento}</code></span>
                    <span className="home-page__list-label">{e.nombre_motivo}</span>
                    <span className="home-page__list-qty">{e.total_cantidad} u.</span>
                    <span className="home-page__list-total">{Number(e.total_costo || 0).toFixed(2)}</span>
                    {e.no_documento && <code className="home-page__list-doc">{e.no_documento}</code>}
                  </button>
                ))}
              </div>
            ) : (
              <Button size="sm" variant="subtle" onClick={() => navigate('/entradas')}>+ Nueva entrada</Button>
            )}
          </Card>

          {/* Últimas salidas */}
          <Card
            title="Últimas salidas"
            subtitle={recentSalidas.length ? `Últimos ${recentSalidas.length} movimientos` : 'Sin salidas recientes'}
            actions={
              recentSalidas.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => navigate('/salidas')}>Ver todas</Button>
              )
            }
          >
            {recentSalidas.length > 0 ? (
              <div className="home-page__list">
                {recentSalidas.map((s) => (
                  <button
                    key={`hom-${s.id_movimiento}`}
                    type="button"
                    className="home-page__list-item"
                    onClick={() => navigate(`/salidas?open=${s.id_movimiento}`)}
                  >
                    <span className="home-page__list-id"><code>#{s.id_movimiento}</code></span>
                    <span className="home-page__list-label">{s.nombre_motivo}</span>
                    <span className="home-page__list-qty">{s.total_cantidad} u.</span>
                    <span className="home-page__list-total">{Number(s.total_costo || 0).toFixed(2)}</span>
                    {s.no_documento && <code className="home-page__list-doc">{s.no_documento}</code>}
                  </button>
                ))}
              </div>
            ) : (
              <Button size="sm" variant="subtle" onClick={() => navigate('/salidas')}>+ Nueva salida</Button>
            )}
          </Card>
        </div>

        {/* Pedidos pendientes */}
        {pedidosPendientes > 0 && (
          <Card
            title="Pedidos por despachar"
            subtitle={`${pedidosPendientes} pedido${pedidosPendientes === 1 ? '' : 's'} pendiente${pedidosPendientes === 1 ? '' : 's'}`}
            accent
            actions={<Button size="sm" variant="ghost" onClick={() => navigate('/pedidos-despachar')}>Ir a despachar</Button>}
          >
            <p>Hay pedidos pendientes de despacho. Revisa el módulo para surtirlos.</p>
          </Card>
        )}
      </div>
    </>
  );
}
