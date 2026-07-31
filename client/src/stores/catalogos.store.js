import { create } from 'zustand';
import { catalogosService } from '@/services/catalogos.service';
import { useAuthStore } from '@/stores/auth.store';

// Cache TTL: 5 minutos
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cachedData = null;
let _cachedAt = 0;

/**
 * Store global de catálogos.
 * Se cachea en memoria (no en localStorage) para que persista entre
 * navegaciones sin pegarle al servidor cada vez.
 */
export const useCatalogosStore = create((set, get) => ({
  motivos: [],
  proveedores: [],
  bodegas: [],
  isLoading: false,
  error: null,
  lastFetched: 0,

  get isStale() {
    return Date.now() - get().lastFetched > CACHE_TTL_MS;
  },

  isMotivosLoaded: () => get().motivos.length > 0,
  isProveedoresLoaded: () => get().proveedores.length > 0,
  isBodegasLoaded: () => get().bodegas.length > 0,

  /**
   * Carga todos los catálogos. Si ya están cacheados y no están stale,
   * no hace nada (devuelve lo cacheado).
   * @param {object} opts - opciones de fetch
   * @param {boolean} opts.force - forzar refresh ignorando cache
   */
  async fetchAll(opts = {}) {
    const state = get();
    if (!opts.force && state.lastFetched > 0 && !get().isStale) {
      return; // cache hit, no hacer nada
    }

    set({ isLoading: true, error: null });
    try {
      const user = useAuthStore.getState().user;
      const idWh = Number(user?.id_warehouse || 0);

      const [mot, prov, bds] = await Promise.all([
        catalogosService.getMotivos(),
        catalogosService.getProveedores(),
        catalogosService.getBodegas(),
      ]);

      const motivosValidos = (mot || []).filter((m) =>
        ['ENTRADA', 'SALIDA', 'AJUSTE'].includes(String(m.tipo_movimiento || '').toUpperCase())
      );
      const bodegaUser = (bds || []).find((b) => Number(b.id_bodega) === idWh) || null;

      set({
        motivos: motivosValidos,
        proveedores: prov || [],
        bodegas: bds || [],
        bodegaUser,
        lastFetched: Date.now(),
        isLoading: false,
      });
    } catch (e) {
      set({ error: e?.response?.data?.error || e?.message || 'Error al cargar catálogos', isLoading: false });
    }
  },

  /**
   * Versión ligera: solo carga motivos filtrados por tipo.
   * Útil para páginas que solo necesitan un tipo de motivo.
   */
  async fetchMotivosPorTipo(tipos) {
    const state = get();
    // Si ya tenemos motivos y el cache es fresco, filtramos localmente
    if (!get().isStale && state.motivos.length > 0) {
      const tipoSet = new Set((tipos || []).map((t) => String(t).toUpperCase()));
      return state.motivos.filter((m) => tipoSet.has(String(m.tipo_movimiento || '').toUpperCase()));
    }
    // Si no, forzamos fetch completo
    await get().fetchAll({ force: true });
    return get().motivos.filter((m) =>
      (tipos || []).map((t) => String(t).toUpperCase()).includes(String(m.tipo_movimiento || '').toUpperCase())
    );
  },

  /** Limpia el cache (ej: tras logout) */
  clear() {
    set({ motivos: [], proveedores: [], bodegas: [], lastFetched: 0, error: null });
  },
}));
