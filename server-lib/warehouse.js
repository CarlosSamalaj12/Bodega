// server-lib/warehouse.js  —  Warehouse utilities, logo handling, product visibility
import { pool } from "./core.js";
import { getPrintLogoDataUri, ensureWarehouseLogoTable } from "./tables.js";
import {
  normalizeWarehouseIdList, buildNamedInClause,
  isAvatarTableMissingError, isWarehouseLogoTableMissingError, normalizeLogoData,
} from "./format.js";
import { ensureUserWarehouseAccessTable, ensureProductWarehouseVisibilityTable } from "./permissions.js";

async function getWarehouseCustomLogoRow(id_bodega) {
  const idBodega = Number(id_bodega || 0);
  if (idBodega <= 0) return null;
  try {
    await ensureWarehouseLogoTable();
    const [[row]] = await pool.query(
      `SELECT logo_data, logo_app_data, logo_print_data FROM bodega_logo WHERE id_bodega=:id_bodega LIMIT 1`,
      { id_bodega: idBodega }
    );
    const legacy = normalizeLogoData(row?.logo_data);
    return { legacy, app: normalizeLogoData(row?.logo_app_data) || null, print: normalizeLogoData(row?.logo_print_data) || legacy || null };
  } catch (e) {
    if (!isWarehouseLogoTableMissingError(e)) throw e;
    return null;
  }
}

async function getWarehouseLogoDataUri(id_bodega) {
  const row = await getWarehouseCustomLogoRow(id_bodega);
  if (row?.print) return row.print;
  return getPrintLogoDataUri();
}
async function getWarehouseAppLogoDataUri(id_bodega) {
  const row = await getWarehouseCustomLogoRow(id_bodega);
  if (row?.app) return row.app;
  return null;
}
async function getWarehousePrintLogoDataUri(id_bodega) {
  const row = await getWarehouseCustomLogoRow(id_bodega);
  if (row?.print) return row.print;
  return getPrintLogoDataUri();
}
async function getPreferredWarehousePrintLogoDataUri(...warehouseIds) {
  for (const warehouseId of warehouseIds) {
    const id = Number(warehouseId || 0);
    if (id <= 0) continue;
    const row = await getWarehouseCustomLogoRow(id);
    if (row?.print) return row.print;
  }
  return getPrintLogoDataUri();
}

function buildWarehouseFooterHtml(...candidates) {
  const picked = candidates.find((x) => x && (String(x.telefono_contacto || "").trim() || String(x.direccion_contacto || "").trim()));
  const tel = String(picked?.telefono_contacto || "").trim();
  const dir = String(picked?.direccion_contacto || "").trim();
  const lines = [];
  if (tel) lines.push(`Tel: ${tel}`);
  if (dir) lines.push(`Direccion: ${dir}`);
  return lines.join("<br/>");
}

async function getUserWarehouseAccessIds(idUsuario) {
  await ensureUserWarehouseAccessTable();
  const [rows] = await pool.query(`SELECT id_bodega FROM usuario_bodegas_acceso WHERE id_usuario=:id_usuario ORDER BY id_bodega ASC`, { id_usuario: idUsuario });
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

function buildProductWarehouseVisibilityClause(productExpr, warehouseParamName) {
  return `(:${warehouseParamName} IS NULL OR NOT EXISTS (SELECT 1 FROM producto_bodegas_visibilidad pbv_all WHERE pbv_all.id_producto=${productExpr}) OR EXISTS (SELECT 1 FROM producto_bodegas_visibilidad pbv_allow WHERE pbv_allow.id_producto=${productExpr} AND pbv_allow.id_bodega=:${warehouseParamName} AND pbv_allow.visible=1))`;
}

async function areWarehouseIdsValid(conn, ids) {
  const list = normalizeWarehouseIdList(ids);
  if (!list.length) return true;
  const inClause = buildNamedInClause(list, "pbv");
  const [rows] = await conn.query(`SELECT id_bodega FROM bodegas WHERE activo=1 AND id_bodega IN (${inClause.sql})`, { ...inClause.params });
  const validIds = normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
  return validIds.length === list.length;
}

async function getProductVisibleWarehouseIds(idProducto) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  if (!id_producto) return [];
  const [rows] = await pool.query(`SELECT id_bodega FROM producto_bodegas_visibilidad WHERE id_producto=:id_producto AND visible=1 ORDER BY id_bodega ASC`, { id_producto });
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

async function saveProductVisibleWarehouseIds(conn, idProducto, ids) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  if (!id_producto) return;
  const visibleIds = normalizeWarehouseIdList(ids);
  await conn.query(`DELETE FROM producto_bodegas_visibilidad WHERE id_producto=:id_producto`, { id_producto });
  for (const id_bodega of visibleIds) {
    await conn.query(`INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible) VALUES (:id_producto, :id_bodega, 1)`, { id_producto, id_bodega });
  }
}

async function isProductVisibleInWarehouse(conn, idProducto, idBodega) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  const id_bodega = Number(idBodega || 0);
  if (!id_producto || !id_bodega) return false;
  const [[row]] = await conn.query(`SELECT EXISTS(SELECT 1 FROM producto_bodegas_visibilidad pbv WHERE pbv.id_producto=:id_producto) AS restricted, EXISTS(SELECT 1 FROM producto_bodegas_visibilidad pbv WHERE pbv.id_producto=:id_producto AND pbv.id_bodega=:id_bodega AND pbv.visible=1) AS allowed`, { id_producto, id_bodega });
  return !Number(row?.restricted || 0) || Number(row?.allowed || 0) === 1;
}

async function getActiveWarehouseIds(conn) {
  const [rows] = await conn.query(`SELECT id_bodega FROM bodegas WHERE activo=1 ORDER BY id_bodega ASC`);
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

async function setProductWarehouseVisibility(conn, idProducto, idBodega, visible) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  const id_bodega = Number(idBodega || 0);
  const nextVisible = Number(visible) ? 1 : 0;
  if (!id_producto || !id_bodega) throw new Error("Producto o bodega invalida");
  const [[productRow]] = await conn.query(`SELECT id_producto FROM productos WHERE id_producto=:id_producto LIMIT 1`, { id_producto });
  if (!productRow) { const err = new Error("Producto no existe"); err.status = 404; throw err; }
  const [[warehouseRow]] = await conn.query(`SELECT id_bodega FROM bodegas WHERE id_bodega=:id_bodega AND activo=1 LIMIT 1`, { id_bodega });
  if (!warehouseRow) { const err = new Error("Bodega no existe o esta inactiva"); err.status = 400; throw err; }
  const [currentRows] = await conn.query(`SELECT id_bodega, visible FROM producto_bodegas_visibilidad WHERE id_producto=:id_producto`, { id_producto });
  if (!currentRows.length) {
    if (nextVisible) return;
    const activeWarehouseIds = await getActiveWarehouseIds(conn);
    for (const wid of activeWarehouseIds) {
      await conn.query(`INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible) VALUES (:id_producto, :id_bodega, :visible)`, { id_producto, id_bodega: wid, visible: wid === id_bodega ? 0 : 1 });
    }
    return;
  }
  await conn.query(`INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible) VALUES (:id_producto, :id_bodega, :visible) ON DUPLICATE KEY UPDATE visible=VALUES(visible), actualizado_en=CURRENT_TIMESTAMP`, { id_producto, id_bodega, visible: nextVisible });
  const activeWarehouseIds = await getActiveWarehouseIds(conn);
  const [visibleRows] = await conn.query(`SELECT id_bodega FROM producto_bodegas_visibilidad WHERE id_producto=:id_producto AND visible=1 ORDER BY id_bodega ASC`, { id_producto });
  const visibleIds = normalizeWarehouseIdList((visibleRows || []).map((r) => r.id_bodega));
  if (activeWarehouseIds.length && visibleIds.length === activeWarehouseIds.length && visibleIds.every((id, idx) => id === activeWarehouseIds[idx])) {
    await conn.query(`DELETE FROM producto_bodegas_visibilidad WHERE id_producto=:id_producto`, { id_producto });
  }
}

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

export {
  getWarehouseCustomLogoRow, getWarehouseLogoDataUri, getWarehouseAppLogoDataUri,
  getWarehousePrintLogoDataUri, getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml,
  getUserWarehouseAccessIds, buildProductWarehouseVisibilityClause, areWarehouseIdsValid,
  getProductVisibleWarehouseIds, saveProductVisibleWarehouseIds, isProductVisibleInWarehouse,
  getActiveWarehouseIds, setProductWarehouseVisibility, getScopedWarehouseFilter,
};
