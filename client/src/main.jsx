import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useThemeStore } from './stores/theme.store';
import './styles/main.scss';

// Aplica el tema antes de montar React para evitar parpadeo
useThemeStore.getState().init();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
