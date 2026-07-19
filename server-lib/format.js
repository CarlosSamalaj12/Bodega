// server-lib/format.js  —  Barrel module re-exporting submodules
// Remaining local functions: number/text formatting, CRUD helpers, resolveStockScope
import { pool } from "./core.js";

// Re-export submodule functions
export { ymd, dmy, normalizeYmdInput } from "./dates.js";
export {
  normalizeDeviceKey, getSharedDeviceKeys,
  isValidOrderPin, isValidSupervisorPin, findOrderPinCollision,
} from "./pins.js";
export { pickLotsFEFO, getLastUnitCost } from "./fefo.js";
export {
  normalizeWarehouseIdList, buildNamedInClause, normalizeLogoData,
  isAvatarTableMissingError, isWarehouseLogoTableMissingError,
  buildTokenizedLikeFilter,
} from "./ids.js";

// ===== Local functions (number/text format, CRUD helpers, stock scope) =====

function clampText(v, maxLen = 120) { return String(v || "").trim().slice(0, Math.max(0, Number(maxLen || 0))); }
function numMoney(v) {
  if (v === null || typeof v === "undefined" || v === "") return 0;
  const raw = String(v).replace(/,/g, "").trim();
  if (!raw) return 0; const n = Number(raw);
  if (!Number.isFinite(n)) return 0; return Math.round(n * 100) / 100;
}
function numQty(v) {
  if (v === null || typeof v === "undefined" || v === "") return 0;
  const raw = String(v).replace(/,/g, "").trim();
  if (!raw) return 0; const n = Number(raw);
  if (!Number.isFinite(n)) return 0; return Math.round(n * 1000) / 1000;
}

async function listActive(table, nameField) {
  const safeTable = String(table || "").replace(/[^a-zA-Z_]/g, "");
  const safeField = String(nameField || "").replace(/[^a-zA-Z_]/g, "");
  if (!safeTable || !safeField) return [];
  const [rows] = await pool.query(`SELECT * FROM \`${safeTable}\` ORDER BY \`${safeField}\` ASC`);
  return rows;
}

async function softDelete(table, idField, id) {
  const safeTable = String(table || "").replace(/[^a-zA-Z_]/g, "");
  const safeField = String(idField || "").replace(/[^a-zA-Z_]/g, "");
  if (!safeTable || !safeField) return;
  await pool.query(`UPDATE \`${safeTable}\` SET active=0 WHERE \`${safeField}\`=:id`, { id });
}

async function resolveStockScope(user) {
  const userId = Number(user?.id_user || 0); const id_role = Number(user?.id_role || 0); const id_bodega = Number(user?.id_warehouse || 0);
  if (!id_bodega) return { id_usuario: userId, id_bodega: null, maneja_stock: false, is_principal: false, is_bodeguero: false, is_report_role: false, is_admin_role: false, can_view_existencias: false, can_all_bodegas: false, has_warehouse_restrictions: false, allowed_warehouse_ids: [] };
  const [[roleRow]] = await pool.query(`SELECT nombre_rol FROM roles WHERE id_rol=:id_rol LIMIT 1`, { id_rol: id_role });
  const roleName = String(roleRow?.nombre_rol || "").trim().toUpperCase();
  const is_bodeguero = roleName.includes("BODEGUER") || roleName.includes("ALMACEN");
  const is_report_role = !is_bodeguero && (roleName.includes("GERENT") || roleName.includes("ADMIN") || roleName.includes("REPORT") || roleName.includes("SUPERVISOR") || roleName.includes("CONTABILIDAD") || roleName.includes("CONTADOR") || roleName.includes("AUDITOR"));
  const is_admin_role = roleName.includes("ADMIN");
  const can_all_bodegas = is_admin_role || roleName.includes("REPORT") || (roleName.includes("GERENT") && !roleName.includes("BODEGUER"));
  const can_view_existencias = is_bodeguero || is_report_role || is_admin_role;
  const [[bodegaRow]] = await pool.query(`SELECT maneja_stock, tipo_bodega FROM bodegas WHERE id_bodega=:id_bodega LIMIT 1`, { id_bodega });
  const maneja_stock = Number(bodegaRow?.maneja_stock || 0) === 1;
  const is_principal = String(bodegaRow?.tipo_bodega || "").toUpperCase() === "PRINCIPAL";
  const { getUserWarehouseAccessIds } = await import("./warehouse.js");
  const warehouseIds = await getUserWarehouseAccessIds(userId);
  const has_warehouse_restrictions = warehouseIds.length > 0;
  return { id_usuario: userId, id_bodega, maneja_stock, is_principal, is_bodeguero, is_report_role, is_admin_role, can_view_existencias, can_all_bodegas, has_warehouse_restrictions, allowed_warehouse_ids: warehouseIds };
}

export {
  clampText, numMoney, numQty, softDelete, resolveStockScope,
};
