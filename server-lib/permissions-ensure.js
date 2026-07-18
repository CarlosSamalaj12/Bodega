// server-lib/permissions-ensure.js  —  Permission-related table creation functions
import { pool } from "./core.js";

async function ensureUserPermissionsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS usuario_permisos (
    id_usuario INT NOT NULL, permiso VARCHAR(120) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, permiso)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function ensureUserWarehouseAccessTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS usuario_bodegas_acceso (
    id_usuario INT NOT NULL, id_bodega INT NOT NULL,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, id_bodega), KEY idx_uba_bodega (id_bodega),
    CONSTRAINT fk_uba_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_uba_bodega FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function ensureProductWarehouseVisibilityTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS producto_bodegas_visibilidad (
    id_producto INT NOT NULL, id_bodega INT NOT NULL, visible TINYINT(1) NOT NULL DEFAULT 1,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id_producto, id_bodega), KEY idx_pbv_bodega (id_bodega),
    CONSTRAINT fk_pbv_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto) ON DELETE CASCADE,
    CONSTRAINT fk_pbv_bodega FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [rows] = await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='producto_bodegas_visibilidad' AND COLUMN_NAME='visible' LIMIT 1`);
  if (!rows.length) await pool.query(`ALTER TABLE producto_bodegas_visibilidad ADD COLUMN visible TINYINT(1) NOT NULL DEFAULT 1 AFTER id_bodega`);
}

export { ensureUserPermissionsTable, ensureUserWarehouseAccessTable, ensureProductWarehouseVisibilityTable };
