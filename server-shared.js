// server-shared.js  —  Barrel module re-exporting all server-lib submodules
// ==============================================================
// This file is the single import point for route modules.
// All shared code has been split into logical submodules under server-lib/.
// ==============================================================

// 1) Core: Express app, pool, Socket.IO, middleware, metrics, idempotency
import { app, httpServer, HOST, PORT, io, pool, bcrypt,
  OPS_BACKUP_AUTO_ENABLED, OPS_BACKUP_INTERVAL_MS,
  OPS_BACKUP_BASE_DIR, OPS_RECOVERY_CHECK_INTERVAL_MS,
  opsMetrics, trimOldEvents, beginIdempotentRequest, trackPinFailure,
  DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS,
} from './server-lib/core.js';

// 2) Auth
export { signToken, auth, emitPedidoChanged } from './server-lib/auth.js';

// 3) Permissions
export {
  PERM_CATALOG, ensureUserPermissionsTable, ensureUserWarehouseAccessTable,
  ensureProductWarehouseVisibilityTable, permissionDefaults,
  getUserPermissionsMap, canManageUserPermissions, requirePermission,
} from './server-lib/permissions.js';

// 4) Warehouse utils
export {
  getWarehouseCustomLogoRow, getWarehouseLogoDataUri,
  getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml,
  getUserWarehouseAccessIds,
  buildProductWarehouseVisibilityClause, areWarehouseIdsValid,
  getProductVisibleWarehouseIds, saveProductVisibleWarehouseIds,
  isProductVisibleInWarehouse, setProductWarehouseVisibility,
  getScopedWarehouseFilter,
} from './server-lib/warehouse.js';

// 5) Formatters
export {
  ymd, dmy, normalizeYmdInput,
  normalizeDeviceKey, getSharedDeviceKeys,
  isValidOrderPin, findOrderPinCollision,
  normalizeWarehouseIdList, buildNamedInClause, normalizeLogoData,
  isAvatarTableMissingError,
  buildTokenizedLikeFilter, softDelete,
  pickLotsFEFO, getLastUnitCost, resolveStockScope,
} from './server-lib/format.js';

// 6) Tables
export {
  getPrintLogoDataUri, ensureWarehouseLogoTable, ensureBodegaContactColumns,
  ensureWarehouseCountOutColumn, ensureWarehouseSalidaPriceRequirementColumn,
  ensureMovimientoDetallePrecioSalidaColumn, ensureMovimientoDashboardColumn,
  ensureMovimientoPastUpdateTrigger, ensureCuadreCajaTable, ensureDashboardCacheTable,
  ensureUserAvatarTable, ensureUserOrderPinTable, ensureSupervisorPinTable,
  ensureUsersNoAutoLogoutColumn, ensureDailyCloseTables, ensureOpsAuditTables,
  ensureSensitiveActionAuditTable, ensureOrderDispatchColumns, ensureCatalogCanDeactivate,
} from './server-lib/tables.js';

// 7) Cuadre
export {
  CUADRE_DENOMINACIONES, CUADRE_DOLAR_DENOM_USD, CUADRE_DOLAR_TIPO_CAMBIO,
  normalizeCuadrePayload,
} from './server-lib/cuadre.js';

// 8) Sensitive actions
export {
  verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit,
  requireSensitiveApproval, enforceDailyCloseBeforeMutations,
  readDashboardResumenCache, createDailyCloseForDate,
} from './server-lib/sensitive.js';

// 9) Backup & recovery
export { createLogicalBackup, maybeRunMonthlyRecoveryTest, prewarmDashboardCache } from './server-lib/backup.js';

// ========== RE-EXPORT core names (imported above) ==========
export {
  app, httpServer, HOST, PORT, io, pool, bcrypt,
  OPS_BACKUP_AUTO_ENABLED, OPS_BACKUP_INTERVAL_MS,
  OPS_BACKUP_BASE_DIR, OPS_RECOVERY_CHECK_INTERVAL_MS,
  opsMetrics, trimOldEvents, beginIdempotentRequest, trackPinFailure,
  DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS,
};

// ========== TABLE CREATION CALLS (side effects at startup) ==========
import { ensureUserPermissionsTable, ensureUserWarehouseAccessTable, ensureProductWarehouseVisibilityTable } from './server-lib/permissions.js';
import { ensureWarehouseLogoTable, ensureBodegaContactColumns, ensureWarehouseCountOutColumn, ensureWarehouseSalidaPriceRequirementColumn, ensureMovimientoDetallePrecioSalidaColumn, ensureMovimientoDashboardColumn, ensureMovimientoPastUpdateTrigger, ensureCuadreCajaTable, ensureDashboardCacheTable, ensureUserAvatarTable, ensureUserOrderPinTable, ensureSupervisorPinTable, ensureUsersNoAutoLogoutColumn, ensureDailyCloseTables, ensureOpsAuditTables, ensureSensitiveActionAuditTable, ensureOrderDispatchColumns } from './server-lib/tables.js';

ensureUserPermissionsTable().catch(e => console.error("No se pudo crear tabla usuario_permisos:", e));
ensureUserWarehouseAccessTable().catch(e => console.error("No se pudo crear tabla usuario_bodegas_acceso:", e));
ensureProductWarehouseVisibilityTable().catch(e => console.error("No se pudo crear tabla producto_bodegas_visibilidad:", e));
ensureWarehouseLogoTable().catch(e => console.error("No se pudo crear tabla bodega_logo:", e));
ensureBodegaContactColumns().catch(e => console.error("No se pudo crear columnas de contacto en bodegas:", e));
ensureWarehouseCountOutColumn().catch(e => console.error("No se pudo crear columna configuracion_bodega.permite_salida_conteo_final:", e));
ensureWarehouseSalidaPriceRequirementColumn().catch(e => console.error("No se pudo crear columna configuracion_bodega.requiere_precio_salida:", e));
ensureMovimientoDetallePrecioSalidaColumn().catch(e => console.error("No se pudo crear columna movimiento_detalle.precio_salida:", e));
ensureMovimientoDashboardColumn().catch(e => console.error("No se pudo crear columna movimiento_encabezado.no_contar_dashboard:", e));
ensureMovimientoPastUpdateTrigger().catch(e => console.error("No se pudo actualizar trigger trg_me_no_update_pasado:", e));
ensureCuadreCajaTable().catch(e => console.error("No se pudo crear tabla cuadre_caja:", e));
ensureDashboardCacheTable().catch(e => console.error("No se pudo crear tabla dashboard_cache_resumen:", e));
ensureUserAvatarTable().catch(e => console.error("No se pudo crear tabla usuario_avatar:", e));
ensureUserOrderPinTable().catch(e => console.error("No se pudo crear tabla usuario_pin_pedido:", e));
ensureSupervisorPinTable().catch(e => console.error("No se pudo crear tabla usuario_pin_supervisor:", e));
ensureUsersNoAutoLogoutColumn().catch(e => console.error("No se pudo crear columna usuarios.no_auto_logout:", e));
ensureDailyCloseTables().catch(e => console.error("No se pudo crear tablas de cierre diario:", e));
ensureOpsAuditTables().catch(e => console.error("No se pudieron crear tablas de backup/recovery:", e));
ensureSensitiveActionAuditTable().catch(e => console.error("No se pudo crear tabla auditoria_accion_sensible:", e));
ensureOrderDispatchColumns().catch(e => console.error("No se pudo actualizar columnas de despacho en pedidos:", e));
