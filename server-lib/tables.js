// server-lib/tables.js  —  Barrel module re-exporting tables submodules
// ==============================================================
// Logo utility          →  tables-logo.js
// Warehouse tables      →  tables-warehouse.js
// Movement tables       →  tables-movement.js
// User tables           →  tables-user.js
// Report tables         →  tables-report.js
// Audit tables          →  tables-audit.js
// Orders tables         →  tables-orders.js
// Catalog validation    →  tables-catalog.js
// ==============================================================

export { getPrintLogoDataUri } from "./tables-logo.js";
export { ensureWarehouseLogoTable, ensureBodegaContactColumns, ensureWarehouseCountOutColumn, ensureWarehouseSalidaPriceRequirementColumn } from "./tables-warehouse.js";
export { ensureMovimientoDetallePrecioSalidaColumn, ensureMovimientoDashboardColumn, ensureMovimientoPastUpdateTrigger } from "./tables-movement.js";
export { ensureUserAvatarTable, ensureUserOrderPinTable, ensureSupervisorPinTable, ensureUsersNoAutoLogoutColumn } from "./tables-user.js";
export { ensureCuadreCajaTable, ensureDashboardCacheTable, ensureDailyCloseTables } from "./tables-report.js";
export { ensureOpsAuditTables, ensureSensitiveActionAuditTable } from "./tables-audit.js";
export { ensureOrderDispatchColumns } from "./tables-orders.js";
export { ensureCatalogCanDeactivate } from "./tables-catalog.js";
