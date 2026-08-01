import api from './api';

// Servicios de autenticación
export const authService = {
  async login(username, password) {
    const { data } = await api.post('/api/auth/login', { username, password });
    // El JWT vive en cookie HttpOnly (server-side, no legible por JS). Aquí
    // solo persistimos el perfil del usuario (no es un secreto) para hidratar
    // el store al recargar.
    if (data?.user) {
      localStorage.setItem('user', JSON.stringify(data.user || {}));
    }
    return data;
  },

  async logout() {
    try {
      // Limpia la cookie HttpOnly en el servidor.
      await api.post('/api/auth/logout');
    } catch {
      // Si la sesión ya expiró, el 401 también limpia localmente.
    }
    localStorage.removeItem('token'); // legacy
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
    // El token está en cookie HttpOnly (inaccesible a JS); la presencia del
    // perfil guardado es el indicador local de sesión. La validación real la
    // hace el servidor en cada request (401 → login).
    return Boolean(localStorage.getItem('user'));
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
