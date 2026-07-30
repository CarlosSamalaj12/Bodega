import api from './api';

// Servicios de autenticación
export const authService = {
  async login(username, password) {
    const { data } = await api.post('/api/auth/login', { username, password });
    if (data?.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user || {}));
    }
    return data;
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getStoredUser() {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  isAuthenticated() {
    return Boolean(localStorage.getItem('token'));
  },

  async me() {
    const { data } = await api.get('/api/auth/me');
    return data;
  },

  /**
   * Refresca el snapshot de permisos del usuario actual.
   * Devuelve `{ permisos, catalogo, is_admin_role }`.
   */
  async refreshPermisos() {
    const { data } = await api.get('/api/me/permisos');
    return data;
  },

  async listLoginUsers() {
    const { data } = await api.get('/api/auth/users');
    return Array.isArray(data) ? data : [];
  },
};
