import axios from 'axios';

// Cliente Axios configurado para hablar con el backend Express
// a través del proxy de Vite en dev, o vía la misma URL en producción.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30_000,
  withCredentials: true, // envía la cookie HttpOnly (sesión) en cada request
  headers: {
    'Content-Type': 'application/json',
  },
});

// Si el backend responde 401, limpia sesión y redirige a login.
// Si la petición falla por error de red o timeout, y es de tipo GET (idempotente), reintenta automáticamente.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config } = error;

    // Si la petición no tiene config o no es un método GET, no reintentar
    if (!config || config.method !== 'get') {
      return handle401(error);
    }

    // Configurar estado de reintentos
    config.__retryCount = config.__retryCount || 0;
    const maxRetries = 2; // Reintentar 2 veces como máximo (3 intentos en total)
    const retryDelay = 1000; // Delay base de 1 segundo

    // Verificar si es un error de red (sin response) o un timeout
    const isNetworkError = !error.response;
    const isTimeout = error.code === 'ECONNABORTED';

    if ((isNetworkError || isTimeout) && config.__retryCount < maxRetries) {
      config.__retryCount += 1;
      console.warn(`[api] Petición fallida (${error.message}). Reintentando ${config.__retryCount}/${maxRetries} con delay exponencial...`);

      // Delay exponencial simple
      await new Promise((resolve) => setTimeout(resolve, retryDelay * config.__retryCount));

      // Re-ejecutar la petición con la misma configuración
      return api(config);
    }

    return handle401(error);
  }
);

function handle401(error) {
  if (error.response?.status === 401) {
    localStorage.removeItem('token'); // legacy
    localStorage.removeItem('user');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
  return Promise.reject(error);
}

export default api;
