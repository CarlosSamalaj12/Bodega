import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

/**
 * PermissionGuard
 * - Bloquea el render de children si el usuario no tiene el permiso indicado.
 * - Convención: si `user.permisos[permissionKey]` es false o 0, no tiene acceso.
 *   Cualquier otro valor (true/1/ausente) se considera permitido.
 * - Si el usuario no está autenticado, redirige a /login.
 * - Si no tiene permiso, redirige a / (Inicio) con un state.from para eventual logging.
 *
 * Nota sobre roles sin permisos cargados: si `user.permisos` viene vacío o
 * no existe (caso típico de un admin o rol sin permisos granulares), el guard
 * es permisivo y deja pasar. Esto preserva la compatibilidad con cuentas
 * existentes que aún no tengan configuración de permisos por sección.
 */
export function PermissionGuard({ permissionKey, children, fallback = null }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const perms = user?.permisos;
  const hasPermsLoaded =
    perms && typeof perms === 'object' && Object.keys(perms).length > 0;

  const isExplicitlyDenied =
    hasPermsLoaded && (perms[permissionKey] === false || perms[permissionKey] === 0);

  if (isExplicitlyDenied) {
    if (fallback) return fallback;
    return <Navigate to="/" replace state={{ from: location, denied: permissionKey }} />;
  }

  return children;
}

/**
 * Hook de conveniencia para chequear permisos desde componentes.
 * @returns {{ permisos: object|null, hasPermsLoaded: boolean, has: (key: string) => boolean }}
 */
export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const perms = user?.permisos;
  const hasPermsLoaded =
    perms && typeof perms === 'object' && Object.keys(perms).length > 0;

  return {
    permisos: perms || null,
    hasPermsLoaded,
    has: (key) => {
      if (!hasPermsLoaded) return true; // permisivo si no hay datos
      const v = perms[key];
      return !(v === false || v === 0);
    },
  };
}
