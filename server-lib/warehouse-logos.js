// server-lib/warehouse-logos.js  —  Warehouse logo and footer utilities
import { pool } from "./core.js";
import { getPrintLogoDataUri, ensureWarehouseLogoTable } from "./tables.js";
import { normalizeLogoData, isWarehouseLogoTableMissingError } from "./format.js";

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

export {
  getWarehouseCustomLogoRow, getWarehouseLogoDataUri,
  getPreferredWarehousePrintLogoDataUri, buildWarehouseFooterHtml,
};
