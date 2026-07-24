import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

export function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
