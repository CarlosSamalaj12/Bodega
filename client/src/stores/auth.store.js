import { create } from 'zustand';
import { authService } from '@/services/auth.service';

// Store de autenticación con Zustand
export const useAuthStore = create((set) => ({
  user: authService.getStoredUser(),
  isAuthenticated: authService.isAuthenticated(),
  isLoading: false,
  error: null,

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  async login(username, password) {
    set({ isLoading: true, error: null });
    try {
      const data = await authService.login(username, password);
      set({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return data;
    } catch (e) {
      const message = e?.response?.data?.error || e.message || 'Error al iniciar sesión';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  logout() {
    authService.logout();
    set({ user: null, isAuthenticated: false, error: null });
  },
}));
