import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useThemeStore } from './stores/theme.store';
import './styles/main.scss';

// Limpiar Service Workers de otros paths (p.ej. registros viejos de builds
// anteriores o de extensiones) que podrían tener cachés incompatibles.
// No tocamos /sw.js aunque sea una versión anterior: el handler de abajo
// lo va a actualizar in-place vía skipWaiting + clients.claim.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) {
      const isOurSw = reg.active && new URL(reg.active.scriptURL).pathname === '/sw.js';
      if (!isOurSw) reg.unregister();
    }
  });
}

// Registrar el Service Worker propio (public/sw.js, servido por Express)
// en DEV y PROD. Esto es necesario para que Chrome/Edge ofrezcan el
// prompt de "Instalar app" en la barra de direcciones, que requiere SW
// registrado + manifest enlazado en el HTML. Con updateViaCache:'none'
// + skipWaiting + recarga al activar, la primera visita tras un deploy
// actualiza el SW y purga las cachés viejas de inmediato.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });

      // Si ya hay una versión esperando, activarla sin esperar al cierre
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

      // Cuando se descargue un SW nuevo, activarlo apenas termine de instalar
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // Al tomar control el SW nuevo, recargar una sola vez para servir
      // el index.html y los bundles nuevos (cache-first del SW viejo).
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (e) {
      console.warn('[sw] No se pudo registrar el service worker:', e);
    }
  });
}

// Capturar errores de importación de módulos dinámicos (Vite)
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[vite] Preload error detected, forcing page reload...', event);
  window.location.reload();
});

// Capturar errores de importación dinámica globales sin capturar
window.addEventListener('error', (event) => {
  const msg = (event.message || '').toLowerCase();
  if (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('expected a javascript-or-wasm module script') ||
    msg.includes('error loading dynamically imported module')
  ) {
    console.warn('[window.error] Falla de importación dinámica detectada. Recargando...', event);
    window.location.reload();
  }
}, true); // Usar fase de captura para interceptar errores de carga de script

// Aplica el tema antes de montar React para evitar parpadeo
useThemeStore.getState().init();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
