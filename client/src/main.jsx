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

// Aplica el tema antes de montar React para evitar parpadeo
useThemeStore.getState().init();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
