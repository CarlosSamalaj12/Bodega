import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useThemeStore } from './stores/theme.store';
import './styles/main.scss';

// Solo en desarrollo: desregistrar Service Workers y limpiar cachés ajenos.
// Un SW viejo (de builds previos en este mismo origen) intercepta los fetches
// y sirve index.html/módulos mezclados de versiones distintas → dos copias de
// React en el mismo árbol → "Invalid hook call" intermitente al recargar.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

// En producción: registrar y mantener al día el Service Worker propio
// (public/sw.js, servido por Express). Antes esto no se hacía desde la app
// React, así que un SW viejo de builds anteriores podía quedar "huérfano"
// controlando la página con cache-first y sirviendo index.html/bundles
// antiguos para siempre (por eso algunos usuarios veían versiones viejas).
// Con updateViaCache:'none' + skipWaiting + recarga al activar, la primera
// visita tras un deploy actualiza el SW y purga las cachés viejas de inmediato.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
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

// Aplica el tema antes de montar React para evitar parpadeo
useThemeStore.getState().init();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
