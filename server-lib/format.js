// server-lib/format.js  —  Date utils, device/PIN utils, number format, FEFO, token filter
import { pool, bcrypt } from "./core.js";

function ymd(value) { if (!value) return null; try { return new Date(value).toISOString().slice(0, 10); } catch { return null; } }
function dmy(value) { const s = ymd(value); if (!s) return ""; const [yyyy, mm, dd] = s.split("-"); return `${dd}-${mm}-${yyyy}`; }
function normalizeYmdInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) { const [dd, mm, yyyy] = raw.split("-"); return `${yyyy}-${mm}-${dd}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) { const [dd, mm, yyyy] = raw.split("/"); return `${yyyy}-${mm}-${dd}`; }
  return ymd(raw) || "";
}
function addDaysYmd(baseYmd, days) { const d = new Date(`${baseYmd}T00:00:00`); d.setDate(d.getDate() + Number(days || 0)); return d.toISOString().slice(0, 10); }
function onlyToday(dateTimeStr) { const d = new Date(dateTimeStr); const now = new Date(); return d.toDateString() === now.toDateString(); }

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

function normalizeDeviceKey(v) { return String(v || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""); }
function getSharedDeviceKeys() { return String(process.env.SHARED_DEVICE_KEYS || "").split(",").map((x) => normalizeDeviceKey(x)).filter(Boolean); }
function isValidOrderPin(pin) { return /^\d{6,12}$/.test(String(pin || "")); }
function isValidSupervisorPin(pin) { return /^\d{6,12}$/.test(String(pin || "")); }

async function findOrderPinCollision(pin, excludeUserId = 0, conn = pool, onlyActive = false) {
  const safePin = String(pin || "").trim();
  if (!safePin) return null;
  const excluded = Number(excludeUserId || 0);
  const activeClause = onlyActive ? " AND u.activo=1" : "";
  const [rows] = await conn.query(
    `SELECT upp.id_usuario, u.usuario, u.nombre_completo${activeClause}
     FROM usuario_pin_pedido upp
     JOIN usuarios u ON u.id_usuario=upp.id_usuario
     WHERE upp.id_usuario!=:excluded${activeClause}`,
    { excluded }
  );
  for (const r of rows || []) {
    const match = await bcrypt.compare(safePin, r.pin_hash || "");
    if (match) return r;
  }
  return null;
}

function normalizeWarehouseIdList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((x) => Number(x || 0)).filter((x) => Number.isInteger(x) && x > 0)));
}

function buildNamedInClause(values, prefix) {
  const ids = normalizeWarehouseIdList(values);
  if (!ids.length) return { sql: "NULL", params: {}, ids };
  const params = {};
  const placeholders = ids.map((id, idx) => { const key = `${prefix}${idx}`; params[key] = id; return `:${key}`; });
  return { sql: placeholders.join(", "), params, ids };
}

function normalizeLogoData(value) {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (s.startsWith("data:image/") || s.startsWith("http")) return s;
  return null;
}

function isAvatarTableMissingError(e) {
  if (!e) return false;
  const msg = String(e.message || "").toLowerCase();
  return msg.includes("usuario_avatar") || msg.includes("unknown table") || msg.includes("doesn't exist");
}

function isWarehouseLogoTableMissingError(e) {
  if (!e) return false;
  const msg = String(e.message || "").toLowerCase();
  return msg.includes("bodega_logo") || msg.includes("unknown table") || msg.includes("doesn't exist");
}

function buildTokenizedLikeFilter(rawInput, columns = [], paramPrefix = "qtk") {
  const safeCols = Array.isArray(columns) ? columns.filter((c) => typeof c === "string" && c.trim()) : [];
  const raw = String(rawInput || "").trim();
  if (!raw || !safeCols.length) return { clause: "1=1", params: {}, hasTokens: false };
  const normalizeSearchToken = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00f1\u00d1]/g, "n").toLowerCase().trim();
  const normalizedSqlExpr = (col) => `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '\u00e1','a'), '\u00e9','e'), '\u00ed','i'), '\u00f3','o'), '\u00fa','u'), '\u00c1','a'), '\u00c9','e'), '\u00cd','i'), '\u00d3','o'), '\u00da','u'), '\u00f1','n'), '\u00d1','n'))`;
  const tokens = raw.split(/\s+/).map((t) => normalizeSearchToken(t)).filter(Boolean).slice(0, 8);
  if (!tokens.length) return { clause: "1=1", params: {}, hasTokens: false };
  const params = {};
  const groups = tokens.map((token, idx) => { const key = `${paramPrefix}${idx}`; params[key] = `%${token}%`; const orCols = safeCols.map((col) => `${normalizedSqlExpr(col)} LIKE :${key}`).join(" OR "); return `(${orCols})`; });
  return { clause: groups.join(" AND "), params, hasTokens: true };
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

async function pickLotsFEFO(conn, id_bodega, id_producto, qtyNeeded, opts = {}) {
  const allowExpired = opts.allowExpired !== false;
  const whereVenc = allowExpired ? "" : "AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())";
  const [lots] = await conn.query(`SELECT lote, fecha_vencimiento, stock FROM v_stock_disponible WHERE id_bodega=:id_bodega AND id_producto=:id_producto ${whereVenc} ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC`, { id_bodega, id_producto });
  const picks = []; let remaining = Number(qtyNeeded);
  for (const l of lots) { if (remaining <= 0) break; const take = Math.min(remaining, Number(l.stock)); picks.push({ lote: l.lote, fecha_vencimiento: l.fecha_vencimiento, qty: take }); remaining -= take; }
  if (!picks.length && allowExpired) { const [[r]] = await conn.query(`SELECT stock FROM v_stock_resumen WHERE id_bodega=:id_bodega AND id_producto=:id_producto LIMIT 1`, { id_bodega, id_producto }); const stock = Number(r?.stock || 0); if (stock > 0) { const take = Math.min(stock, Number(qtyNeeded)); return { picks: [{ lote: null, fecha_vencimiento: null, qty: take }], remaining: Number(qtyNeeded) - take }; } }
  return { picks, remaining };
}

async function getLastUnitCost(conn, id_bodega, id_producto, lote) {
  const [rows] = await conn.query(`SELECT costo_unitario FROM kardex WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote=:lote AND delta_cantidad > 0 ORDER BY creado_en DESC LIMIT 1`, { id_bodega, id_producto, lote });
  return rows[0]?.costo_unitario ?? 0;
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
  ymd, dmy, normalizeYmdInput, addDaysYmd, onlyToday,
  clampText, numMoney, numQty, normalizeDeviceKey, getSharedDeviceKeys,
  isValidOrderPin, isValidSupervisorPin, findOrderPinCollision,
  normalizeWarehouseIdList, buildNamedInClause, normalizeLogoData,
  isAvatarTableMissingError, isWarehouseLogoTableMissingError,
  buildTokenizedLikeFilter, listActive, softDelete,
  pickLotsFEFO, getLastUnitCost, resolveStockScope,
};
