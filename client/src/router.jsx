import { lazy, Suspense, useState } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary, RouteErrorFallback } from '@/components/shared/ErrorBoundary';
import { PermissionGuard } from '@/components/shared/PermissionGuard';

// Envoltorio de lazy que intenta recargar la página limpia si falla la carga del chunk dinámico.
// Evita pantallas rotas persistentes al cambiar de versión o por micro-cortes de red.
function lazyWithRetry(componentImport) {
  return lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      console.error('[lazyWithRetry] Error cargando componente dinámico:', error);
      const errorMsg = (error?.message || '').toLowerCase();
      if (
        errorMsg.includes('failed to fetch') ||
        errorMsg.includes('dynamically imported') ||
        errorMsg.includes('expected a javascript-or-wasm') ||
        errorMsg.includes('dynamic import') ||
        errorMsg.includes('load module script') ||
        errorMsg.includes('mime type')
      ) {
        console.warn('[lazyWithRetry] Falla de carga dinámica detectada. Forzando recarga de página...');
        window.location.reload();
      }
      throw error;
    }
  });
}

// Carga diferida de todas las páginas con reintento automático
const LoginPage = lazyWithRetry(() => import('@/pages/LoginPage'));
const HomePage = lazyWithRetry(() => import('@/pages/HomePage'));
const ProductosPage = lazyWithRetry(() => import('@/pages/ProductosPage'));
const EntradasPage = lazyWithRetry(() => import('@/pages/EntradasPage'));
const SalidasPage = lazyWithRetry(() => import('@/pages/SalidasPage'));
const PedidosPage = lazyWithRetry(() => import('@/pages/PedidosPage'));
const DespacharPage = lazyWithRetry(() => import('@/pages/DespacharPage'));
const CategoriasPage = lazyWithRetry(() => import('@/pages/CategoriasPage'));
// Subcategorias ahora está integrada en CategoriasPage
const ProveedoresPage = lazyWithRetry(() => import('@/pages/ProveedoresPage'));
const MedidasPage = lazyWithRetry(() => import('@/pages/MedidasPage'));
const MotivosPage = lazyWithRetry(() => import('@/pages/MotivosPage'));
const BodegasPage = lazyWithRetry(() => import('@/pages/BodegasPage'));
const KardexPage = lazyWithRetry(() => import('@/pages/KardexPage'));
const KardexGeneralPage = lazyWithRetry(() => import('@/pages/KardexGeneralPage'));
const ExistenciasPage = lazyWithRetry(() => import('@/pages/ExistenciasPage'));
const AlertasPage = lazyWithRetry(() => import('@/pages/AlertasPage'));
const UsuariosPage = lazyWithRetry(() => import('@/pages/UsuariosPage'));
const ReglasSubcategoriasPage = lazyWithRetry(() => import('@/pages/ReglasSubcategoriasPage'));
const LimitesPage = lazyWithRetry(() => import('@/pages/LimitesPage'));
const ReporteEntradasPage = lazyWithRetry(() => import('@/pages/ReporteEntradasPage'));
const ReporteSalidasPage = lazyWithRetry(() => import('@/pages/ReporteSalidasPage'));
const CorteDiarioPage = lazyWithRetry(() => import('@/pages/CorteDiarioPage'));
const ReportePedidosPage = lazyWithRetry(() => import('@/pages/ReportePedidosPage'));
const AjustesPage = lazyWithRetry(() => import('@/pages/AjustesPage'));
const TransferenciasPage = lazyWithRetry(() => import('@/pages/TransferenciasPage'));
const ConteoCiclicoPage = lazyWithRetry(() => import('@/pages/ConteoCiclicoPage'));
const CuadreCajaPage = lazyWithRetry(() => import('@/pages/CuadreCajaPage'));
const TendenciaProductoPage = lazyWithRetry(() => import('@/pages/TendenciaProductoPage'));
const AuditoriaSensiblesPage = lazyWithRetry(() => import('@/pages/AuditoriaSensiblesPage'));

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
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorFallback />,
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
      { path: 'kardex-general', element: wrap(<KardexGeneralPage />) },
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
      {
        path: 'ajustes',
        element: (
          <PermissionGuard permissionKey="section.view.ajustes">
            <AjustesPage />
          </PermissionGuard>
        ),
      },
      { path: 'transferencias', element: wrap(<TransferenciasPage />) },
      { path: 'conteo-ciclico', element: wrap(<ConteoCiclicoPage />) },
      { path: 'tendencia-producto', element: wrap(<TendenciaProductoPage />) },
      { path: 'auditoria-sensibles', element: wrap(<AuditoriaSensiblesPage />) },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
    errorElement: <RouteErrorFallback />,
  },
]);
