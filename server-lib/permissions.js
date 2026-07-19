// server-lib/permissions.js  —  Barrel module re-exporting permissions submodules
// ==============================================================
// Core permission logic        →  permissions-core.js
// Table creation functions     →  permissions-ensure.js
// ==============================================================

export {
  PERM_CATALOG, permissionDefaults,
  getUserPermissionsMap, canManageUserPermissions, requirePermission,
} from "./permissions-core.js";

export {
  ensureUserPermissionsTable, ensureUserWarehouseAccessTable,
  ensureProductWarehouseVisibilityTable,
} from "./permissions-ensure.js";
