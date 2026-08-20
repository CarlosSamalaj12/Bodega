import { useEffect, useRef, useCallback } from 'react';
import { toast } from '@/components/ui/Toast';
import { useAppVersionStore } from '@/stores/appVersion.store';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const VERSION_URL = '/version.json';

// `__APP_VERSION__` se inyecta en build por vite.config.js (plugin
// appVersionPlugin). En dev sin haber construido nunca vale 'dev'.
const BUILT_IN_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/**
 * useVersionCheck — hook que mantiene la app sincronizada con la última
 * versión desplegada en el server.
 *
 *   1. Al montar (y luego cada POLL_INTERVAL_MS o cuando la pestaña vuelve
 *      a estar visible), hace fetch a /version.json con cache-busting.
 *   2. Si la versión del server es distinta a la que tiene baked-in el
 *      bundle actual (__APP_VERSION__), actualiza el store (que la UI
 *      puede leer para mostrar la versión actual) y muestra un toast
 *      persistente con un botón "Actualizar" que hace
 *      window.location.reload() (lo que además fuerza al SW a tomar la
 *      nueva versión).
 *
 * Por qué polling + visibility y no solo al recibir un evento push:
 *   - Los pushes solo llegan si la app está abierta en background o el SW
 *     está activo; un cliente que perdió la conexión de socket se pierde
 *     el aviso. El chequeo por HTTP es la red de seguridad universal.
 *   - visibilitychange cubre el caso típico: usuario vuelve a la pestaña
 *     después de horas → la app se entera en <1s.
 */
export function useVersionCheck() {
  const setServerVersion = useAppVersionStore((s) => s.setServerVersion);
  const notifiedForRef = useRef(null); // evita mostrar el mismo toast N veces

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch(`${VERSION_URL}?ts=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!res.ok) return; // sin archivo (dev sin build) o error de red
      const data = await res.json();
      const serverVersion = String(data?.version || '').trim();
      if (!serverVersion) return;
      if (serverVersion === BUILT_IN_VERSION) return; // ya estamos al día
      if (notifiedForRef.current === serverVersion) return; // ya avisamos

      notifiedForRef.current = serverVersion;
      setServerVersion(serverVersion);
      toast.info(`Nueva versión ${serverVersion} disponible`, {
        duration: 0, // persistente hasta que el usuario actúe
        actionLabel: 'Actualizar',
        onClick: () => {
          // Forzar recarga completa: el SW se actualiza y sirve el bundle
          // nuevo; el SW viejo se descarta.
          window.location.reload();
        },
      });
    } catch {
      // Silencioso: el siguiente poll lo reintenta.
    }
  }, [setServerVersion]);

  useEffect(() => {
    // Chequeo inicial después de que cargue la página (no bloquea el render).
    const t = setTimeout(checkVersion, 1500);

    // Re-chequear cuando la pestaña vuelve a estar visible (caso típico:
    // usuario dejó la app abierta en otra pestaña durante un deploy).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Poll periódico por si la app queda en foreground sin cambio de
    // visibilidad (p.ej. otra pestaña del mismo origen que ya hizo foco).
    const interval = setInterval(checkVersion, POLL_INTERVAL_MS);

    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [checkVersion]);
}

