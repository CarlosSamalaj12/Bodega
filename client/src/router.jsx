import { lazy, Suspense, useState } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

// Carga diferida de todas las páginas
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const HomePage = lazy(() => import('@/pages/HomePage'));
const ProductosPage = lazy(() => import('@/pages/ProductosPage'));
const EntradasPage = lazy(() => import('@/pages/EntradasPage'));
const SalidasPage = lazy(() => import('@/pages/SalidasPage'));
const PedidosPage = lazy(() => import('@/pages/PedidosPage'));
const DespacharPage = lazy(() => import('@/pages/DespacharPage'));
const CategoriasPage = lazy(() => import('@/pages/CategoriasPage'));
// Subcategorias ahora está integrada en CategoriasPage
const ProveedoresPage = lazy(() => import('@/pages/ProveedoresPage'));
const MedidasPage = lazy(() => import('@/pages/MedidasPage'));
const MotivosPage = lazy(() => import('@/pages/MotivosPage'));
const BodegasPage = lazy(() => import('@/pages/BodegasPage'));
const KardexPage = lazy(() => import('@/pages/KardexPage'));
const ExistenciasPage = lazy(() => import('@/pages/ExistenciasPage'));
const AlertasPage = lazy(() => import('@/pages/AlertasPage'));
const UsuariosPage = lazy(() => import('@/pages/UsuariosPage'));
const ReglasSubcategoriasPage = lazy(() => import('@/pages/ReglasSubcategoriasPage'));
const LimitesPage = lazy(() => import('@/pages/LimitesPage'));
const ReporteEntradasPage = lazy(() => import('@/pages/ReporteEntradasPage'));
const ReporteSalidasPage = lazy(() => import('@/pages/ReporteSalidasPage'));
const CorteDiarioPage = lazy(() => import('@/pages/CorteDiarioPage'));
const ReportePedidosPage = lazy(() => import('@/pages/ReportePedidosPage'));
const AjustesPage = lazy(() => import('@/pages/AjustesPage'));
const TransferenciasPage = lazy(() => import('@/pages/TransferenciasPage'));
const ConteoCiclicoPage = lazy(() => import('@/pages/ConteoCiclicoPage'));
const CuadreCajaPage = lazy(() => import('@/pages/CuadreCajaPage'));
const TendenciaProductoPage = lazy(() => import('@/pages/TendenciaProductoPage'));
const AuditoriaSensiblesPage = lazy(() => import('@/pages/AuditoriaSensiblesPage'));

// Fallback compartido para Suspense
const PageFallback = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem',
      color: 'var(--color-text-muted)',
      fontSize: '0.875rem',
    }}
  >
    Cargando…
  </div>
);

/**
 * Envuelve una ruta lazy con ErrorBoundary + Suspense.
 * Si falla la carga del chunk, el ErrorBoundary muestra un botón "Reintentar"
 * que cambia el key para forzar la recarga completa del lazy component.
 */
function PageGuard({ children }) {
  const [key, setKey] = useState(0);
  return (
    <ErrorBoundary key={key} onReset={() => setKey((k) => k + 1)}>
      <Suspense fallback={<PageFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function wrap(page) {
  return <PageGuard>{page}</PageGuard>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: wrap(<LoginPage />),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: wrap(<HomePage />) },
      { path: 'entradas', element: wrap(<EntradasPage />) },
      { path: 'salidas', element: wrap(<SalidasPage />) },
      { path: 'pedidos', element: wrap(<PedidosPage />) },
      { path: 'pedidos-despachar', element: wrap(<DespacharPage />) },
      { path: 'productos', element: wrap(<ProductosPage />) },
      { path: 'categorias', element: wrap(<CategoriasPage />) },
      { path: 'subcategorias', element: <Navigate to="/categorias" replace /> },
      { path: 'proveedores', element: wrap(<ProveedoresPage />) },
      { path: 'medidas', element: wrap(<MedidasPage />) },
      { path: 'motivos', element: wrap(<MotivosPage />) },
      { path: 'bodegas', element: wrap(<BodegasPage />) },
      { path: 'kardex', element: wrap(<KardexPage />) },
      { path: 'existencias', element: wrap(<ExistenciasPage />) },
      { path: 'alertas', element: wrap(<AlertasPage />) },
      { path: 'usuarios', element: wrap(<UsuariosPage />) },
      { path: 'reglas-subcategorias', element: wrap(<ReglasSubcategoriasPage />) },
      { path: 'limites', element: wrap(<LimitesPage />) },
      { path: 'reporte-entradas', element: wrap(<ReporteEntradasPage />) },
      { path: 'reporte-salidas', element: wrap(<ReporteSalidasPage />) },
      { path: 'corte-diario', element: wrap(<CorteDiarioPage />) },
      { path: 'cuadre-caja', element: wrap(<CuadreCajaPage />) },
      { path: 'reporte-pedidos', element: wrap(<ReportePedidosPage />) },
      { path: 'ajustes', element: wrap(<AjustesPage />) },
      { path: 'transferencias', element: wrap(<TransferenciasPage />) },
      { path: 'conteo-ciclico', element: wrap(<ConteoCiclicoPage />) },
      { path: 'tendencia-producto', element: wrap(<TendenciaProductoPage />) },
      { path: 'auditoria-sensibles', element: wrap(<AuditoriaSensiblesPage />) },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
