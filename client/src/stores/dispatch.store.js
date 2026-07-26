import { create } from 'zustand';

/**
 * dispatchStore — seguimiento de pedidos nuevos por despachar
 * recibidos via Socket.IO mientras el usuario está en otra página.
 */
export const useDispatchStore = create((set, get) => ({
  newCount: 0,
  lastKnownIds: new Set(),

  /**
   * Registrar un pedido nuevo recibido via socket.
   */
  notifyNew(id_pedido) {
    const state = get();
    // Evitar duplicados
    if (state.lastKnownIds.has(id_pedido)) return;
    state.lastKnownIds.add(id_pedido);
    set({ newCount: state.newCount + 1, lastKnownIds: state.lastKnownIds });
  },

  /**
   * Limpiar la notificación al visitar la página.
   */
  clear() {
    set({ newCount: 0, lastKnownIds: new Set() });
  },
}));
