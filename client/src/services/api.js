import axios from 'axios';

// Cliente Axios configurado para hablar con el backend Express
// a través del proxy de Vite en dev, o vía la misma URL en producción.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inyecta el token JWT en cada request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Si el backend responde 401, limpia sesión y redirige a login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
