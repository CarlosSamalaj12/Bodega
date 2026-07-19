// server-lib/warehouse.js  —  Barrel module re-exporting warehouse submodules
// ==============================================================
// Logo & footer utilities      →  warehouse-logos.js
// Product/warehouse visibility →  warehouse-visibility.js
// Scoped warehouse filter      →  warehouse-filter.js
// ==============================================================

export {
  getWarehouseCustomLogoRow, getWarehouseLogoDataUri,
  getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml,
} from "./warehouse-logos.js";

export {
  getUserWarehouseAccessIds, buildProductWarehouseVisibilityClause, areWarehouseIdsValid,
  getProductVisibleWarehouseIds, saveProductVisibleWarehouseIds, isProductVisibleInWarehouse,
  getActiveWarehouseIds, setProductWarehouseVisibility,
} from "./warehouse-visibility.js";

export { getScopedWarehouseFilter } from "./warehouse-filter.js";
