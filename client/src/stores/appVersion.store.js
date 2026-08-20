import { create } from 'zustand';

// Versión baked-in del bundle (inyectada en build por vite.config.js).
// En dev sin haber construido nunca vale 'dev'.
const BUILT_IN_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const BUILT_IN_AT = typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : '';
const BUILT_IN_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '';

/**
 * appVersionStore — snapshot de la versión que está corriendo la app.
 *
 * - `builtVersion` es la versión que se baked-in en este bundle (constante
 *   durante toda la vida del JS cargado). Cambia solo al recargar.
 * - `serverVersion` es la versión publicada en /version.json; si difiere
 *   de builtVersion, hay una actualización pendiente.
 * - `isUpToDate` indica si están en sincronía.
 *
 * El store se actualiza desde useVersionCheck (polling + visibilitychange)
 * y desde los listeners de Service Worker (controllerchange ya recarga la
 * página, pero podríamos enganchar aquí también si queremos).
 */
export const useAppVersionStore = create((set) => ({
  builtVersion: BUILT_IN_VERSION,
  builtAt: BUILT_IN_AT,
  builtCommit: BUILT_IN_COMMIT,
  serverVersion: BUILT_IN_VERSION,
  pendingUpdate: false,

  /**
   * Llamado por useVersionCheck cuando el polling detecta que la versión
   * del server (version.json) es distinta a la baked-in.
   */
  setServerVersion(serverVersion) {
    set((s) => ({
      serverVersion,
      pendingUpdate: serverVersion !== s.builtVersion,
    }));
  },
}));
