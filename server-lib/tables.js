// server-lib/tables.js  —  Database table/column creation functions
import { pool, __dirname } from "./core.js";
import fs from "fs/promises";

let printLogoDataUriCache = null;
async function getPrintLogoDataUri() {
  if (printLogoDataUriCache) return printLogoDataUriCache;
  try {
    const logoPath = (await import("path")).join(__dirname, "imagenes", "JDL_negro.png");
    const buf = await fs.readFile(logoPath);
    printLogoDataUriCache = `data:image/png;base64,${buf.toString("base64")}`;
    return printLogoDataUriCache;
  } catch { return "/imagenes/JDL_negro.png"; }
}

async function ensureWarehouseLogoTable() { await pool.query(`CREATE TABLE IF NOT EXISTS bodega_logo (id_bodega INT NOT NULL, logo_data LONGTEXT NULL, logo_app_data LONGTEXT NULL, logo_print_data LONGTEXT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_bodega), CONSTRAINT fk_bodega_logo FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); const [cols] = await pool.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='bodega_logo'`); const colSet = new Set((cols || []).map((r) => String(r.COLUMN_NAME || "").trim().toLowerCase())); if (!colSet.has("logo_app_data")) await pool.query(`ALTER TABLE bodega_logo ADD COLUMN logo_app_data LONGTEXT NULL`); if (!colSet.has("logo_print_data")) await pool.query(`ALTER TABLE bodega_logo ADD COLUMN logo_print_data LONGTEXT NULL`); }
async function ensureBodegaContactColumns() { const [rows] = await pool.query(`SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bodegas' AND COLUMN_NAME IN ('telefono_contacto','direccion_contacto')`); const colSet = new Set((rows || []).map((r) => String(r?.col || "").toLowerCase())); if (!colSet.has("telefono_contacto")) await pool.query(`ALTER TABLE bodegas ADD COLUMN telefono_contacto VARCHAR(40) NULL`); if (!colSet.has("direccion_contacto")) await pool.query(`ALTER TABLE bodegas ADD COLUMN direccion_contacto VARCHAR(255) NULL`); }
async function ensureWarehouseCountOutColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='configuracion_bodega' AND COLUMN_NAME='permite_salida_conteo_final'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE configuracion_bodega ADD COLUMN permite_salida_conteo_final TINYINT(1) NOT NULL DEFAULT 0`); }
async function ensureWarehouseSalidaPriceRequirementColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='configuracion_bodega' AND COLUMN_NAME='requiere_precio_salida'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE configuracion_bodega ADD COLUMN requiere_precio_salida TINYINT(1) NOT NULL DEFAULT 0`); }
async function ensureMovimientoDetallePrecioSalidaColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_detalle' AND COLUMN_NAME='precio_salida'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE movimiento_detalle ADD COLUMN precio_salida DECIMAL(12,2) NULL AFTER costo_unitario`); }
async function ensureMovimientoDashboardColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='movimiento_encabezado' AND COLUMN_NAME='no_contar_dashboard'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE movimiento_encabezado ADD COLUMN no_contar_dashboard TINYINT(1) NOT NULL DEFAULT 0`); }
async function ensureMovimientoPastUpdateTrigger() {
  await pool.query(`DROP TRIGGER IF EXISTS trg_me_no_update_pasado`);
  await pool.query(`CREATE TRIGGER trg_me_no_update_pasado BEFORE UPDATE ON movimiento_encabezado FOR EACH ROW BEGIN IF DATE(OLD.creado_en) <> CURDATE() AND NOT (COALESCE(@allow_dashboard_flag_past_update,0)=1 AND COALESCE(OLD.no_contar_dashboard,0)<>COALESCE(NEW.no_contar_dashboard,0) AND COALESCE(OLD.tipo_movimiento,'')=COALESCE(NEW.tipo_movimiento,'') AND COALESCE(OLD.id_motivo,0)=COALESCE(NEW.id_motivo,0) AND COALESCE(OLD.id_bodega_origen,0)=COALESCE(NEW.id_bodega_origen,0) AND COALESCE(OLD.id_bodega_destino,0)=COALESCE(NEW.id_bodega_destino,0) AND COALESCE(OLD.id_proveedor,0)=COALESCE(NEW.id_proveedor,0) AND COALESCE(OLD.no_documento,'')=COALESCE(NEW.no_documento,'') AND COALESCE(OLD.observaciones,'')=COALESCE(NEW.observaciones,'') AND COALESCE(OLD.creado_por,0)=COALESCE(NEW.creado_por,0) AND COALESCE(OLD.confirmado_en,'1000-01-01 00:00:00')=COALESCE(NEW.confirmado_en,'1000-01-01 00:00:00') AND COALESCE(OLD.estado,'')=COALESCE(NEW.estado,'') AND COALESCE(OLD.creado_en,'1000-01-01 00:00:00')=COALESCE(NEW.creado_en,'1000-01-01 00:00:00')) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='No se puede modificar un movimiento de fecha anterior.'; END IF; END`);
}
async function ensureCuadreCajaTable() { await pool.query(`CREATE TABLE IF NOT EXISTS cuadre_caja (id_cuadre INT NOT NULL AUTO_INCREMENT, fecha DATE NOT NULL, id_bodega INT NOT NULL, sede VARCHAR(120) NULL, responsable VARCHAR(120) NULL, payload_json LONGTEXT NOT NULL, total_efectivo DECIMAL(14,2) NOT NULL DEFAULT 0, total_cobro DECIMAL(14,2) NOT NULL DEFAULT 0, total_venta_ambiente DECIMAL(14,2) NOT NULL DEFAULT 0, gran_total_reporte DECIMAL(14,2) NOT NULL DEFAULT 0, creado_por INT NULL, actualizado_por INT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_cuadre), UNIQUE KEY uq_cuadre_caja_fecha_bodega (fecha, id_bodega), KEY idx_cuadre_caja_bodega_fecha (id_bodega, fecha)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureDashboardCacheTable() { await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_cache_resumen (scope_key VARCHAR(80) NOT NULL, id_bodega INT NULL, dias INT NOT NULL, mov_days INT NOT NULL, payload_json LONGTEXT NOT NULL, generado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (scope_key), KEY idx_cache_generado (generado_en), KEY idx_cache_bodega (id_bodega)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureUserAvatarTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_avatar (id_usuario INT NOT NULL, avatar_data LONGTEXT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureUserOrderPinTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_pin_pedido (id_usuario INT NOT NULL, pin_hash VARCHAR(255) NOT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario), CONSTRAINT fk_usuario_pin_pedido_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureSupervisorPinTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_pin_supervisor (id_usuario INT NOT NULL, pin_hash VARCHAR(255) NOT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario), CONSTRAINT fk_usuario_pin_supervisor_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureUsersNoAutoLogoutColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios' AND COLUMN_NAME='no_auto_logout'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE usuarios ADD COLUMN no_auto_logout TINYINT(1) NOT NULL DEFAULT 0`); }
async function ensureDailyCloseTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS cierre_dia (id_cierre BIGINT NOT NULL AUTO_INCREMENT, id_bodega INT NOT NULL, fecha_cierre DATE NOT NULL, total_entradas DECIMAL(18,3) NOT NULL DEFAULT 0, total_salidas DECIMAL(18,3) NOT NULL DEFAULT 0, total_existencia_cierre DECIMAL(18,3) NOT NULL DEFAULT 0, creado_por INT NULL, origen ENUM('MANUAL','AUTO') NOT NULL DEFAULT 'MANUAL', observaciones VARCHAR(255) NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id_cierre), UNIQUE KEY uq_cierre_bodega_fecha (id_bodega, fecha_cierre), KEY idx_cierre_bodega_fecha (id_bodega, fecha_cierre)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cierre_dia_detalle (id_cierre_detalle BIGINT NOT NULL AUTO_INCREMENT, id_cierre BIGINT NOT NULL, id_producto INT NOT NULL, sku VARCHAR(80) NULL, nombre_producto VARCHAR(180) NULL, existencia_inicial DECIMAL(18,3) NOT NULL DEFAULT 0, entradas_dia DECIMAL(18,3) NOT NULL DEFAULT 0, salidas_dia DECIMAL(18,3) NOT NULL DEFAULT 0, existencia_cierre DECIMAL(18,3) NOT NULL DEFAULT 0, PRIMARY KEY (id_cierre_detalle), KEY idx_detalle_cierre (id_cierre), KEY idx_detalle_producto (id_producto), CONSTRAINT fk_cierre_detalle_cierre FOREIGN KEY (id_cierre) REFERENCES cierre_dia(id_cierre) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
async function ensureOpsAuditTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS backup_audit (id_backup BIGINT NOT NULL AUTO_INCREMENT, backup_date DATE NOT NULL, trigger_type VARCHAR(30) NOT NULL, status VARCHAR(20) NOT NULL, file_path VARCHAR(500) NULL, bytes_written BIGINT NULL, creado_por INT NULL, error_message VARCHAR(500) NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, finalizado_en DATETIME NULL, PRIMARY KEY (id_backup), KEY idx_backup_date (backup_date, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS recovery_test_audit (id_test BIGINT NOT NULL AUTO_INCREMENT, trigger_type VARCHAR(30) NOT NULL, status VARCHAR(20) NOT NULL, source_file VARCHAR(500) NULL, summary_json LONGTEXT NULL, creado_por INT NULL, error_message VARCHAR(500) NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, finalizado_en DATETIME NULL, PRIMARY KEY (id_test), KEY idx_recovery_status (status, creado_en)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
async function ensureSensitiveActionAuditTable() { await pool.query(`CREATE TABLE IF NOT EXISTS auditoria_accion_sensible (id_auditoria BIGINT NOT NULL AUTO_INCREMENT, action_key VARCHAR(80) NOT NULL, action_label VARCHAR(180) NOT NULL, endpoint VARCHAR(180) NULL, http_method VARCHAR(12) NULL, id_usuario_actor INT NOT NULL, actor_nombre VARCHAR(160) NULL, id_bodega_actor INT NULL, id_usuario_supervisor INT NULL, supervisor_usuario VARCHAR(80) NULL, supervisor_nombre VARCHAR(160) NULL, approval_method VARCHAR(40) NULL, reference_type VARCHAR(40) NULL, reference_id BIGINT NULL, detail_json LONGTEXT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id_auditoria), KEY idx_auditoria_fecha (creado_en), KEY idx_auditoria_accion (action_key, creado_en), KEY idx_auditoria_actor (id_usuario_actor, creado_en), KEY idx_auditoria_supervisor (id_usuario_supervisor, creado_en)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureOrderDispatchColumns() {
  const [estadoRows] = await pool.query(`SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_encabezado' AND COLUMN_NAME='estado' LIMIT 1`);
  const estadoType = String(estadoRows?.[0]?.column_type || "").toLowerCase();
  if (estadoType.startsWith("enum(") && !estadoType.includes("completado_justificado")) {
    const values = []; estadoType.replace(/'([^']*)'/g, (_, v) => { values.push(String(v || "").toUpperCase()); return ""; });
    if (!values.length) values.push("PENDIENTE", "APROBADO", "PARCIAL", "COMPLETADO", "CANCELADO");
    if (!values.includes("COMPLETADO_JUSTIFICADO")) values.push("COMPLETADO_JUSTIFICADO");
    await pool.query(`ALTER TABLE pedido_encabezado MODIFY COLUMN estado ENUM(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}) NOT NULL DEFAULT 'PENDIENTE'`);
  }
  const [headRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_encabezado' AND COLUMN_NAME='justificacion_despacho'`);
  if (Number(headRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_encabezado ADD COLUMN justificacion_despacho TEXT NULL`);
  const [lineStateRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='estado_linea'`);
  if (Number(lineStateRows?.[0]?.c || 0) <= 0) { await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN estado_linea VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'`); await pool.query(`UPDATE pedido_detalle SET estado_linea = CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 'DESPACHADO' ELSE 'PENDIENTE' END`); }
  const [lineJustRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='justificacion_linea'`);
  if (Number(lineJustRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN justificacion_linea VARCHAR(255) NULL`);
  const [lineCancelByRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='anulado_por'`);
  if (Number(lineCancelByRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN anulado_por INT NULL`);
  const [lineCancelAtRows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pedido_detalle' AND COLUMN_NAME='anulado_en'`);
  if (Number(lineCancelAtRows?.[0]?.c || 0) <= 0) await pool.query(`ALTER TABLE pedido_detalle ADD COLUMN anulado_en DATETIME NULL`);
}

async function ensureCatalogCanDeactivate(conn, { entity, id }) {
  if (entity === "PRODUCTO") {
    const [[orderRow]] = await conn.query(`SELECT COUNT(*) AS c FROM pedido_detalle pd JOIN pedido_encabezado pe ON pe.id_pedido=pd.id_pedido WHERE pd.id_producto=:id AND pe.estado IN ('PENDIENTE','PARCIAL')`, { id });
    if (Number(orderRow?.c || 0) > 0) return { ok: false, status: 409, code: "PRODUCT_IN_OPEN_ORDER", error: "No se puede desactivar el producto porque tiene pedidos abiertos" };
  }
  if (entity === "MOTIVO") {
    const [[movRow]] = await conn.query(`SELECT COUNT(*) AS c FROM movimiento_encabezado WHERE id_motivo=:id AND estado NOT IN ('CONFIRMADO','CANCELADO','COMPLETADO')`, { id });
    if (Number(movRow?.c || 0) > 0) return { ok: false, status: 409, code: "MOTIVO_IN_OPEN_MOVEMENT", error: "No se puede desactivar el motivo porque tiene movimientos abiertos" };
  }
  return { ok: true };
}

export {
  getPrintLogoDataUri, ensureWarehouseLogoTable, ensureBodegaContactColumns,
  ensureWarehouseCountOutColumn, ensureWarehouseSalidaPriceRequirementColumn,
  ensureMovimientoDetallePrecioSalidaColumn, ensureMovimientoDashboardColumn,
  ensureMovimientoPastUpdateTrigger, ensureCuadreCajaTable, ensureDashboardCacheTable,
  ensureUserAvatarTable, ensureUserOrderPinTable, ensureSupervisorPinTable,
  ensureUsersNoAutoLogoutColumn, ensureDailyCloseTables, ensureOpsAuditTables,
  ensureSensitiveActionAuditTable, ensureOrderDispatchColumns, ensureCatalogCanDeactivate,
};
