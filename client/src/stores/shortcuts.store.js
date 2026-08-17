import { create } from 'zustand';
import api from '@/services/api';
import { getDefaultShortcutsMap, SHORTCUT_CATALOG } from '@/utils/shortcuts';

/**
 * shortcuts.store.js
 *
 * Estado global de atajos personalizados por el usuario.
 *
 * - `overrides` es un mapa { [id_atajo]: combo } con las personalizaciones
 *   del usuario actual. Se carga desde el backend en el login y se persiste
 *   al guardar (PUT /api/me/shortcuts).
 * - `loaded` indica si ya intentamos sincronizar con el backend. Mientras
 *   sea false, el sistema usa los defaults locales.
 * - El catálogo (SHORTCUT_CATALOG) es estático y vive en utils/shortcuts.
 *
 * Helper `getCombo(id)` resuelve el combo efectivo: override > default.
 */

export const useShortcutsStore = create((set, get) => ({
  overrides: {},        // { [id]: combo }
  loaded: false,        // ¿ya hicimos GET del backend?
  loading: false,       // ¿estamos cargando?
  saving: false,        // ¿estamos guardando?
  error: null,

  /** Devuelve el combo efectivo para un id (override > default). */
  getCombo(id) {
    const s = get();
    if (s.overrides && Object.prototype.hasOwnProperty.call(s.overrides, id)) {
      return s.overrides[id];
    }
    const def = SHORTCUT_CATALOG.find((x) => x.id === id);
    return def ? def.defaultCombo : '';
  },

  /** Mapa completo id -> combo efectivo (post merge). */
  getEffectiveMap() {
    const out = {};
    for (const s of SHORTCUT_CATALOG) {
      out[s.id] = get().getCombo(s.id);
    }
    return out;
  },

  /** ¿El usuario personalizó este atajo? */
  isCustomized(id) {
    const s = get();
    return Object.prototype.hasOwnProperty.call(s.overrides || {}, id);
  },

  /**
   * Carga la configuración de atajos del backend.
   * Si falla, deja los defaults locales y marca loaded=true igual.
   */
  async load() {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const { data } = await api.get('/api/me/shortcuts');
      // El backend devuelve { shortcuts: {id: combo} } o {} si nunca se configuró.
      const map = (data && typeof data === 'object' && data.shortcuts) || {};
      set({ overrides: map, loaded: true, loading: false });
    } catch (e) {
      // En silencio: el usuario no podrá personalizar hasta que pueda
      // pegarle al backend, pero los defaults siguen funcionando.
      set({ loaded: true, loading: false });
    }
  },

  /**
   * Actualiza el combo de un atajo y persiste en el backend.
   * Si `combo` es null/undefined, elimina el override (vuelve al default).
   */
  async setShortcut(id, combo) {
    const current = get().overrides || {};
    const next = { ...current };
    if (combo == null || combo === '') {
      delete next[id];
    } else {
      next[id] = combo;
    }
    set({ overrides: next, saving: true, error: null });
    try {
      const { data } = await api.put('/api/me/shortcuts', { shortcuts: next });
      // El backend puede normalizar / filtrar; tomamos su respuesta como verdad.
      set({
        overrides: (data && data.shortcuts) || next,
        saving: false,
      });
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo guardar el atajo';
      // Revertimos al estado anterior en memoria.
      set({ overrides: current, saving: false, error: msg });
      throw new Error(msg);
    }
  },

  /**
   * Restaura todos los atajos a sus defaults.
   * Llama al endpoint DELETE y limpia overrides.
   */
  async resetAll() {
    set({ saving: true, error: null });
    try {
      await api.delete('/api/me/shortcuts');
      set({ overrides: {}, saving: false });
    } catch (e) {
      const msg = e?.response?.data?.error || 'No se pudo restablecer';
      set({ saving: false, error: msg });
      throw new Error(msg);
    }
  },

  /** Resetea el store (ej. en logout). */
  reset() {
    set({ overrides: {}, loaded: false, loading: false, saving: false, error: null });
  },
}));

/** Helper para usar fuera de componentes React. */
export const shortcutsApi = {
  getCombo: (id) => useShortcutsStore.getState().getCombo(id),
  isCustomized: (id) => useShortcutsStore.getState().isCustomized(id),
  getEffectiveMap: () => useShortcutsStore.getState().getEffectiveMap(),
};
