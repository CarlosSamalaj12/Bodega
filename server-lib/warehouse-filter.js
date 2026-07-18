// server-lib/warehouse-filter.js  —  Warehouse scope filter utility
import { normalizeWarehouseIdList } from "./format.js";

function getScopedWarehouseFilter(scope, requestedWarehouse, opts = {}) {
  const fallbackToDefault = Boolean(opts.fallbackToDefault);
  const requested = Number(requestedWarehouse || 0) || null;
  const restrictedIds = normalizeWarehouseIdList(scope?.allowed_warehouse_ids || []);
  if (requested) {
    if (restrictedIds.length && !restrictedIds.includes(requested)) return { denied: true, selected: null, restrictedIds };
    return { denied: false, selected: requested, restrictedIds };
  }
  if (fallbackToDefault) {
    if (restrictedIds.length) {
      const preferred = Number(scope?.id_bodega || 0);
      const selected = restrictedIds.includes(preferred) ? preferred : restrictedIds[0];
      return { denied: false, selected: selected || null, restrictedIds };
    }
    return { denied: false, selected: Number(scope?.id_bodega || 0) || null, restrictedIds };
  }
  return { denied: false, selected: null, restrictedIds };
}

export { getScopedWarehouseFilter };
