import { create } from 'zustand';
import { authService } from '@/services/auth.service';
import { useShortcutsStore } from '@/stores/shortcuts.store';

// Store de autenticación con Zustand
export const useAuthStore = create((set, get) => ({
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
      // Cargar atajos personalizados del usuario desde el backend.
      // Fire-and-forget: si falla, los defaults locales siguen activos.
      useShortcutsStore.getState().load();
      return data;
    } catch (e) {
      const message = e?.response?.data?.error || e.message || 'Error al iniciar sesión';
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  logout() {
    authService.logout();
    // Limpiar también los atajos personalizados del usuario saliente.
    useShortcutsStore.getState().reset();
    set({ user: null, isAuthenticated: false, error: null });
  },

  /**
   * Refresca el snapshot de permisos del usuario actual desde el servidor,
   * actualiza el store y el localStorage. Pensado para ser llamado desde el
   * listener de `permisos:changed` del socket.
   */
  async refreshPermisos() {
    const data = await authService.refreshPermisos();
    const current = get().user;
    if (current && data?.permisos) {
      const updatedUser = { ...current, permisos: data.permisos };
      try {
        localStorage.setItem('user', JSON.stringify(updatedUser));
      } catch { /* ignore quota */ }
      set({ user: updatedUser });
    }
    return data;
  },
}));
