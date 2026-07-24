import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { ProductosPage } from '@/pages/ProductosPage';
import { EntradasPage } from '@/pages/EntradasPage';
import { SalidasPage } from '@/pages/SalidasPage';
import { PedidosPage } from '@/pages/PedidosPage';
import { DespacharPage } from '@/pages/DespacharPage';
import { CategoriasPage } from '@/pages/CategoriasPage';
import { SubcategoriasPage } from '@/pages/SubcategoriasPage';
import { ProveedoresPage } from '@/pages/ProveedoresPage';
import { MedidasPage } from '@/pages/MedidasPage';
import { MotivosPage } from '@/pages/MotivosPage';
import { BodegasPage } from '@/pages/BodegasPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'entradas', element: <EntradasPage /> },
      { path: 'salidas', element: <SalidasPage /> },
      { path: 'pedidos', element: <PedidosPage /> },
      { path: 'pedidos-despachar', element: <DespacharPage /> },
      { path: 'productos', element: <ProductosPage /> },
      { path: 'categorias', element: <CategoriasPage /> },
      { path: 'subcategorias', element: <SubcategoriasPage /> },
      { path: 'proveedores', element: <ProveedoresPage /> },
      { path: 'medidas', element: <MedidasPage /> },
      { path: 'motivos', element: <MotivosPage /> },
      { path: 'bodegas', element: <BodegasPage /> },
      { path: 'usuarios', element: <PlaceholderPage title="Usuarios" section="usuarios" /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
