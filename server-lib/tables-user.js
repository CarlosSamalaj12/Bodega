// server-lib/tables-user.js  —  User-related table/column creation functions
import { pool } from "./core.js";

async function ensureUserAvatarTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_avatar (id_usuario INT NOT NULL, avatar_data LONGTEXT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureUserOrderPinTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_pin_pedido (id_usuario INT NOT NULL, pin_hash VARCHAR(255) NOT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario), CONSTRAINT fk_usuario_pin_pedido_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureSupervisorPinTable() { await pool.query(`CREATE TABLE IF NOT EXISTS usuario_pin_supervisor (id_usuario INT NOT NULL, pin_hash VARCHAR(255) NOT NULL, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id_usuario), CONSTRAINT fk_usuario_pin_supervisor_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); }
async function ensureUsersNoAutoLogoutColumn() { const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios' AND COLUMN_NAME='no_auto_logout'`); if (!(Number(rows?.[0]?.c || 0) > 0)) await pool.query(`ALTER TABLE usuarios ADD COLUMN no_auto_logout TINYINT(1) NOT NULL DEFAULT 0`); }

export { ensureUserAvatarTable, ensureUserOrderPinTable, ensureSupervisorPinTable, ensureUsersNoAutoLogoutColumn };
