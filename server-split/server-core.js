// server-core.js  |  Lines 1-2567  |  Express setup, middleware, shared utils
// -------------------------------------------------------
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import "dotenv/config";
import { pool } from "./db.js";

const app = express();
const httpServer = createServer(app);
const HOST = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001) || 3001;
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

const corsOriginResolver = (origin, callback) => {
  if (!origin) return callback(null, true);
  // Do not throw 500 for disallowed browser origins; just omit CORS headers.
  if (!allowedOrigins.size || allowedOrigins.has(origin)) return callback(null, true);
  return callback(null, false);
};

const corsOptions = {
  origin: corsOriginResolver,
  credentials: true,
};

const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.use("/imagenes", express.static(path.join(__dirname, "imagenes")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

const OPS_ALERT_WINDOW_MS = 5 * 60 * 1000;
const OPS_PIN_WINDOW_MS = 15 * 60 * 1000;
const OPS_BACKUP_AUTO_ENABLED = String(process.env.BACKUP_AUTO_ENABLED || "1") !== "0";
const OPS_BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000));
const OPS_BACKUP_BASE_DIR = path.join(__dirname, "backups", "daily");
const OPS_RECOVERY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_WINDOW_MS = Math.max(3000, Number(process.env.IDEMPOTENCY_WINDOW_MS || 15000));
const recentRequestSignatures = new Map();

const opsMetrics = {
  started_at: new Date().toISOString(),
  api: {
    total: 0,
    errors_4xx: 0,
    errors_5xx: 0,
    total_latency_ms: 0,
    max_latency_ms: 0,
    recent: [],
  },
  db: {
    total_queries: 0,
    failures: 0,
    total_latency_ms: 0,
    max_latency_ms: 0,
    recent_failures: [],
    last_error: null,
  },
  pin_failures: {
    order: [],
    supervisor: [],
  },
  sensitive_actions: {
    approved_by_special_permission: 0,
    approved_by_supervisor_pin: 0,
    blocked: 0,
  },
};

function trimOldEvents(arr, windowMs) {
  const minTs = Date.now() - Number(windowMs || 0);
  while (arr.length && Number(arr[0]?.ts || 0) < minTs) arr.shift();
}

function pushTimedEvent(arr, payload, maxKeep = 400) {
  arr.push({ ...payload, ts: Date.now() });
  if (arr.length > maxKeep) arr.splice(0, arr.length - maxKeep);
}

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map((item) => stableSortObject(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const k of Object.keys(value).sort()) {
    const v = value[k];
    if (typeof v === "undefined") continue;
    out[k] = stableSortObject(v);
  }
  return out;
}

function cleanupIdempotencySignatures(nowTs = Date.now()) {
  for (const [sig, expireAt] of recentRequestSignatures.entries()) {
    if (Number(expireAt || 0) <= nowTs) recentRequestSignatures.delete(sig);
  }
}

function buildRequestSignature(req, pathKey = null) {
  const actorUserId = Number(req.user?.id_user || 0);
  const method = String(req.method || "POST").toUpperCase();
  const routePath = String(pathKey || req.path || "");
  const bodySorted = stableSortObject(req.body || {});
  const bodyHash = crypto.createHash("sha256").update(JSON.stringify(bodySorted)).digest("hex");
  return `${actorUserId}|${method}|${routePath}|${bodyHash}`;
}

function beginIdempotentRequest(req, res, opts = {}) {
  const nowTs = Date.now();
  const windowMs = Math.max(1000, Number(opts.windowMs || IDEMPOTENCY_WINDOW_MS));
  const signature = buildRequestSignature(req, opts.pathKey || null);
  cleanupIdempotencySignatures(nowTs);
  const existingUntil = Number(recentRequestSignatures.get(signature) || 0);
  if (existingUntil > nowTs) return false;
  recentRequestSignatures.set(signature, nowTs + windowMs);

  let finalized = false;
  const releaseOnFailure = () => {
    if (finalized) return;
    finalized = true;
    if (!res.writableEnded || Number(res.statusCode || 500) >= 400) {
      recentRequestSignatures.delete(signature);
    }
  };

  res.once("finish", releaseOnFailure);
  res.once("close", releaseOnFailure);
  return true;
}

function trackPinFailure(type, meta = {}) {
  const bucket = type === "supervisor" ? opsMetrics.pin_failures.supervisor : opsMetrics.pin_failures.order;
  pushTimedEvent(bucket, meta, 600);
}

function wrapQueryWithMetrics(fn, src) {
  return async (...args) => {
    const t0 = Date.now();
    try {
      const out = await fn(...args);
      const ms = Date.now() - t0;
      opsMetrics.db.total_queries += 1;
      opsMetrics.db.total_latency_ms += ms;
      opsMetrics.db.max_latency_ms = Math.max(opsMetrics.db.max_latency_ms, ms);
      return out;
    } catch (e) {
      const ms = Date.now() - t0;
      opsMetrics.db.total_queries += 1;
      opsMetrics.db.failures += 1;
      pushTimedEvent(opsMetrics.db.recent_failures, { source: src, code: e?.code || null, message: String(e?.message || e) }, 300);
      opsMetrics.db.last_error = {
        source: src,
        code: e?.code || null,
        message: String(e?.message || e),
        at: new Date().toISOString(),
      };
      opsMetrics.db.total_latency_ms += ms;
      opsMetrics.db.max_latency_ms = Math.max(opsMetrics.db.max_latency_ms, ms);
      throw e;
    }
  };
}

const originalPoolQuery = pool.query.bind(pool);
pool.query = wrapQueryWithMetrics(originalPoolQuery, "pool");
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async (...args) => {
  const conn = await originalGetConnection(...args);
  if (!conn.__opsMetricsWrapped) {
    conn.query = wrapQueryWithMetrics(conn.query.bind(conn), "connection");
    conn.__opsMetricsWrapped = 1;
  }
  return conn;
};

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - t0;
    opsMetrics.api.total += 1;
    opsMetrics.api.total_latency_ms += ms;
    opsMetrics.api.max_latency_ms = Math.max(opsMetrics.api.max_latency_ms, ms);
    if (res.statusCode >= 500) opsMetrics.api.errors_5xx += 1;
    else if (res.statusCode >= 400) opsMetrics.api.errors_4xx += 1;
    pushTimedEvent(opsMetrics.api.recent, { status: res.statusCode, ms, method: req.method, path: req.path }, 700);
  });
  next();
});
// Back-compat: redirect legacy /public/login.html to the new static root path.
app.get("/public/login.html", (req, res) => {
  res.redirect(301, "/login.html");
});

let printLogoDataUriCache = null;
async function getPrintLogoDataUri() {
  if (printLogoDataUriCache) return printLogoDataUriCache;
  try {
    const logoPath = path.join(__dirname, "imagenes", "JDL_negro.png");
    const buf = await fs.readFile(logoPath);
    printLogoDataUriCache = `data:image/png;base64,${buf.toString("base64")}`;
    return printLogoDataUriCache;
  } catch {
    return "/imagenes/JDL_negro.png";
  }
}

async function ensureWarehouseLogoTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS bodega_logo (
      id_bodega INT NOT NULL,
      logo_data LONGTEXT NULL,
      logo_app_data LONGTEXT NULL,
      logo_print_data LONGTEXT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_bodega),
      CONSTRAINT fk_bodega_logo FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME='bodega_logo'`
  );
  const colSet = new Set((cols || []).map((r) => String(r.COLUMN_NAME || "").trim().toLowerCase()));
  if (!colSet.has("logo_app_data")) {
    await pool.query(`ALTER TABLE bodega_logo ADD COLUMN logo_app_data LONGTEXT NULL`);
  }
  if (!colSet.has("logo_print_data")) {
    await pool.query(`ALTER TABLE bodega_logo ADD COLUMN logo_print_data LONGTEXT NULL`);
  }
}

async function ensureBodegaContactColumns() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS col
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='bodegas'
       AND COLUMN_NAME IN ('telefono_contacto', 'direccion_contacto')`
  );
  const colSet = new Set((rows || []).map((r) => String(r?.col || "").toLowerCase()));
  if (!colSet.has("telefono_contacto")) {
    await pool.query(`ALTER TABLE bodegas ADD COLUMN telefono_contacto VARCHAR(40) NULL`);
  }
  if (!colSet.has("direccion_contacto")) {
    await pool.query(`ALTER TABLE bodegas ADD COLUMN direccion_contacto VARCHAR(255) NULL`);
  }
}

async function ensureWarehouseCountOutColumn() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='configuracion_bodega'
       AND COLUMN_NAME='permite_salida_conteo_final'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE configuracion_bodega
       ADD COLUMN permite_salida_conteo_final TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
}

async function ensureWarehouseSalidaPriceRequirementColumn() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='configuracion_bodega'
       AND COLUMN_NAME='requiere_precio_salida'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE configuracion_bodega
       ADD COLUMN requiere_precio_salida TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
}

async function ensureMovimientoDetallePrecioSalidaColumn() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='movimiento_detalle'
       AND COLUMN_NAME='precio_salida'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE movimiento_detalle
       ADD COLUMN precio_salida DECIMAL(12,2) NULL AFTER costo_unitario`
    );
  }
}

async function ensureMovimientoDashboardColumn() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='movimiento_encabezado'
       AND COLUMN_NAME='no_contar_dashboard'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE movimiento_encabezado
       ADD COLUMN no_contar_dashboard TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
}

async function ensureMovimientoPastUpdateTrigger() {
  await pool.query(`DROP TRIGGER IF EXISTS trg_me_no_update_pasado`);
  await pool.query(`
    CREATE TRIGGER trg_me_no_update_pasado
    BEFORE UPDATE ON movimiento_encabezado
    FOR EACH ROW
    BEGIN
      IF DATE(OLD.creado_en) <> CURDATE()
         AND NOT (
           COALESCE(@allow_dashboard_flag_past_update, 0) = 1
           AND COALESCE(OLD.no_contar_dashboard, 0) <> COALESCE(NEW.no_contar_dashboard, 0)
           AND COALESCE(OLD.tipo_movimiento, '') = COALESCE(NEW.tipo_movimiento, '')
           AND COALESCE(OLD.id_motivo, 0) = COALESCE(NEW.id_motivo, 0)
           AND COALESCE(OLD.id_bodega_origen, 0) = COALESCE(NEW.id_bodega_origen, 0)
           AND COALESCE(OLD.id_bodega_destino, 0) = COALESCE(NEW.id_bodega_destino, 0)
           AND COALESCE(OLD.id_proveedor, 0) = COALESCE(NEW.id_proveedor, 0)
           AND COALESCE(OLD.no_documento, '') = COALESCE(NEW.no_documento, '')
           AND COALESCE(OLD.observaciones, '') = COALESCE(NEW.observaciones, '')
           AND COALESCE(OLD.creado_por, 0) = COALESCE(NEW.creado_por, 0)
           AND COALESCE(OLD.confirmado_en, '1000-01-01 00:00:00') = COALESCE(NEW.confirmado_en, '1000-01-01 00:00:00')
           AND COALESCE(OLD.estado, '') = COALESCE(NEW.estado, '')
           AND COALESCE(OLD.creado_en, '1000-01-01 00:00:00') = COALESCE(NEW.creado_en, '1000-01-01 00:00:00')
         )
      THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'No se puede modificar un movimiento de fecha anterior.';
      END IF;
    END
  `);
}

async function ensureCuadreCajaTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cuadre_caja (
      id_cuadre INT NOT NULL AUTO_INCREMENT,
      fecha DATE NOT NULL,
      id_bodega INT NOT NULL,
      sede VARCHAR(120) NULL,
      responsable VARCHAR(120) NULL,
      payload_json LONGTEXT NOT NULL,
      total_efectivo DECIMAL(14,2) NOT NULL DEFAULT 0,
      total_cobro DECIMAL(14,2) NOT NULL DEFAULT 0,
      total_venta_ambiente DECIMAL(14,2) NOT NULL DEFAULT 0,
      gran_total_reporte DECIMAL(14,2) NOT NULL DEFAULT 0,
      creado_por INT NULL,
      actualizado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_cuadre),
      UNIQUE KEY uq_cuadre_caja_fecha_bodega (fecha, id_bodega),
      KEY idx_cuadre_caja_bodega_fecha (id_bodega, fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}
async function getWarehouseCustomLogoRow(id_bodega) {
  const idBodega = Number(id_bodega || 0);
  if (idBodega <= 0) return null;
  try {
    await ensureWarehouseLogoTable();
    const [[row]] = await pool.query(
      `SELECT logo_data, logo_app_data, logo_print_data
       FROM bodega_logo
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: idBodega }
    );
    const legacy = normalizeLogoData(row?.logo_data);
    return {
      legacy,
      app: normalizeLogoData(row?.logo_app_data) || null,
      print: normalizeLogoData(row?.logo_print_data) || legacy || null,
    };
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
  const picked = candidates.find(
    (x) => x && (String(x.telefono_contacto || "").trim() || String(x.direccion_contacto || "").trim())
  );
  const tel = String(picked?.telefono_contacto || "").trim();
  const dir = String(picked?.direccion_contacto || "").trim();
  const lines = [];
  if (tel) lines.push(`Tel: ${tel}`);
  if (dir) lines.push(`Direccion: ${dir}`);
  return lines.join("<br/>");
}

function signToken(user) {
  return jwt.sign(
    { id_user: user.id_user, id_role: user.id_role, id_warehouse: user.id_warehouse, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const qt = req.query && req.query.token ? String(req.query.token) : "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (qt || null);
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido" });
  }
}

io.use((socket, next) => {
  try {
    const authToken = socket.handshake?.auth?.token ? String(socket.handshake.auth.token) : "";
    const queryToken = socket.handshake?.query?.token ? String(socket.handshake.query.token) : "";
    const token = authToken || queryToken;
    if (!token) return next(new Error("No token"));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error("Token invalido"));
  }
});

io.on("connection", (socket) => {
  const idWarehouse = Number(socket.user?.id_warehouse || 0);
  if (idWarehouse > 0) {
    socket.join(`warehouse:${idWarehouse}`);
  }
});

function emitPedidoChanged(payload) {
  const reqWh = Number(payload?.requester_warehouse_id || 0);
  const fromWh = Number(payload?.requested_from_warehouse_id || 0);
  const envelope = {
    id_pedido: Number(payload?.id_pedido || 0),
    requester_warehouse_id: reqWh || null,
    requested_from_warehouse_id: fromWh || null,
    status: String(payload?.status || "").toUpperCase() || null,
    action: payload?.action || "updated",
    at: new Date().toISOString(),
  };
  if (reqWh > 0) io.to(`warehouse:${reqWh}`).emit("pedido:changed", envelope);
  if (fromWh > 0) io.to(`warehouse:${fromWh}`).emit("pedido:changed", envelope);
}

function buildTokenizedLikeFilter(rawInput, columns = [], paramPrefix = "qtk") {
  const safeCols = Array.isArray(columns) ? columns.filter((c) => typeof c === "string" && c.trim()) : [];
  const raw = String(rawInput || "").trim();
  if (!raw || !safeCols.length) {
    return { clause: "1=1", params: {}, hasTokens: false };
  }
  const normalizeSearchToken = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u00f1\u00d1]/g, "n")
      .toLowerCase()
      .trim();
  const normalizedSqlExpr = (col) =>
    `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '\u00e1','a'), '\u00e9','e'), '\u00ed','i'), '\u00f3','o'), '\u00fa','u'), '\u00c1','a'), '\u00c9','e'), '\u00cd','i'), '\u00d3','o'), '\u00da','u'), '\u00f1','n'), '\u00d1','n'))`;
  const tokens = raw
    .split(/\s+/)
    .map((t) => normalizeSearchToken(t))
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) {
    return { clause: "1=1", params: {}, hasTokens: false };
  }

  const params = {};
  const groups = tokens.map((token, idx) => {
    const key = `${paramPrefix}${idx}`;
    params[key] = `%${token}%`;
    const orCols = safeCols.map((col) => `${normalizedSqlExpr(col)} LIKE :${key}`).join(" OR ");
    return `(${orCols})`;
  });

  return {
    clause: groups.join(" AND "),
    params,
    hasTokens: true,
  };
}

const PERM_CATALOG = [
  { key: "section.view.home", label: "Ver modulo Inicio", group: "Secciones" },
  { key: "section.view.entradas", label: "Ver modulo Entradas", group: "Secciones" },
  { key: "section.view.salidas", label: "Ver modulo Salidas", group: "Secciones" },
  { key: "section.view.ajustes", label: "Ver modulo Ajustes", group: "Secciones" },
  { key: "section.view.pedidos", label: "Ver modulo Realizar pedidos", group: "Secciones" },
  { key: "section.view.pedidos-despachar", label: "Ver modulo Pedidos x Despachar", group: "Secciones" },
  { key: "section.view.cuadre-caja", label: "Ver modulo Cuadre de Caja", group: "Secciones" },
  { key: "section.view.categorias", label: "Ver modulo Categorias", group: "Secciones" },
  { key: "section.view.subcategorias", label: "Ver modulo Subcategorias", group: "Secciones" },
  { key: "section.view.motivos-movimiento", label: "Ver modulo Motivo movimiento", group: "Secciones" },
  { key: "section.view.proveedores", label: "Ver modulo Proveedores", group: "Secciones" },
  { key: "section.view.productos", label: "Ver modulo Productos", group: "Secciones" },
  { key: "section.view.limites", label: "Ver modulo Minimos/Maximos", group: "Secciones" },
  { key: "section.view.reglas-subcategorias", label: "Ver modulo Reglas subcategorias", group: "Secciones" },
  { key: "section.view.usuarios", label: "Ver modulo Usuarios", group: "Secciones" },
  { key: "section.view.bodegas", label: "Ver modulo Bodegas", group: "Secciones" },
  { key: "section.view.r-existencias", label: "Ver Reporte Existencias", group: "Reportes" },
  { key: "section.view.r-corte-diario", label: "Ver Reporte Corte Diario", group: "Reportes" },
  { key: "section.view.r-entradas", label: "Ver Reporte Entradas", group: "Reportes" },
  { key: "section.view.r-salidas", label: "Ver Reporte Salidas", group: "Reportes" },
  { key: "section.view.r-pedidos", label: "Ver Reporte Pedidos", group: "Reportes" },
  { key: "section.view.r-transferencias", label: "Ver Reporte Kardex", group: "Reportes" },
  { key: "section.view.r-auditoria-sensibles", label: "Ver Reporte Auditoria sensible", group: "Reportes" },
  { key: "action.filter", label: "Usar filtros y busquedas", group: "Acciones" },
  { key: "action.export_excel", label: "Exportar reportes a Excel", group: "Acciones" },
  { key: "action.create_update", label: "Crear y editar registros", group: "Acciones" },
  { key: "action.delete", label: "Eliminar / desactivar registros", group: "Acciones" },
  { key: "action.dispatch", label: "Despachar pedidos", group: "Acciones" },
  { key: "action.sensitive_approve", label: "Aprobar acciones sensibles", group: "Acciones", default_active: 0 },
  { key: "action.manage_permissions", label: "Administrar permisos de usuarios", group: "Acciones" },
];

async function ensureUserPermissionsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_permisos (
      id_usuario INT NOT NULL,
      permiso VARCHAR(120) NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario, permiso)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureUserWarehouseAccessTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_bodegas_acceso (
      id_usuario INT NOT NULL,
      id_bodega INT NOT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario, id_bodega),
      KEY idx_uba_bodega (id_bodega),
      CONSTRAINT fk_uba_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
      CONSTRAINT fk_uba_bodega FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureProductWarehouseVisibilityTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS producto_bodegas_visibilidad (
      id_producto INT NOT NULL,
      id_bodega INT NOT NULL,
      visible TINYINT(1) NOT NULL DEFAULT 1,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_producto, id_bodega),
      KEY idx_pbv_bodega (id_bodega),
      CONSTRAINT fk_pbv_producto FOREIGN KEY (id_producto) REFERENCES productos(id_producto) ON DELETE CASCADE,
      CONSTRAINT fk_pbv_bodega FOREIGN KEY (id_bodega) REFERENCES bodegas(id_bodega) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [rows] = await pool.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME='producto_bodegas_visibilidad'
       AND COLUMN_NAME='visible'
     LIMIT 1`
  );
  if (!rows.length) {
    await pool.query(
      `ALTER TABLE producto_bodegas_visibilidad
       ADD COLUMN visible TINYINT(1) NOT NULL DEFAULT 1 AFTER id_bodega`
    );
  }
}

function normalizeWarehouseIdList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((x) => Number(x || 0))
        .filter((x) => Number.isInteger(x) && x > 0)
    )
  );
}

async function getUserWarehouseAccessIds(idUsuario) {
  await ensureUserWarehouseAccessTable();
  const [rows] = await pool.query(
    `SELECT id_bodega
     FROM usuario_bodegas_acceso
     WHERE id_usuario=:id_usuario
     ORDER BY id_bodega ASC`,
    { id_usuario: idUsuario }
  );
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

function buildProductWarehouseVisibilityClause(productExpr, warehouseParamName) {
  return `(
    :${warehouseParamName} IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM producto_bodegas_visibilidad pbv_all
      WHERE pbv_all.id_producto=${productExpr}
    )
    OR EXISTS (
      SELECT 1
      FROM producto_bodegas_visibilidad pbv_allow
      WHERE pbv_allow.id_producto=${productExpr}
        AND pbv_allow.id_bodega=:${warehouseParamName}
        AND pbv_allow.visible=1
    )
  )`;
}

async function areWarehouseIdsValid(conn, ids) {
  const list = normalizeWarehouseIdList(ids);
  if (!list.length) return true;
  const inClause = buildNamedInClause(list, "pbv");
  const [rows] = await conn.query(
    `SELECT id_bodega
     FROM bodegas
     WHERE activo=1
       AND id_bodega IN (${inClause.sql})`,
    { ...inClause.params }
  );
  const validIds = normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
  return validIds.length === list.length;
}

async function getProductVisibleWarehouseIds(idProducto) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  if (!id_producto) return [];
  const [rows] = await pool.query(
    `SELECT id_bodega
     FROM producto_bodegas_visibilidad
     WHERE id_producto=:id_producto
       AND visible=1
     ORDER BY id_bodega ASC`,
    { id_producto }
  );
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

async function saveProductVisibleWarehouseIds(conn, idProducto, ids) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  if (!id_producto) return;
  const visibleIds = normalizeWarehouseIdList(ids);
  await conn.query(
    `DELETE FROM producto_bodegas_visibilidad
     WHERE id_producto=:id_producto`,
    { id_producto }
  );
  for (const id_bodega of visibleIds) {
    await conn.query(
      `INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
       VALUES (:id_producto, :id_bodega, 1)`,
      { id_producto, id_bodega }
    );
  }
}

async function isProductVisibleInWarehouse(conn, idProducto, idBodega) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  const id_bodega = Number(idBodega || 0);
  if (!id_producto || !id_bodega) return false;
  const [[row]] = await conn.query(
    `SELECT EXISTS(
        SELECT 1
        FROM producto_bodegas_visibilidad pbv
        WHERE pbv.id_producto=:id_producto
      ) AS restricted,
      EXISTS(
        SELECT 1
        FROM producto_bodegas_visibilidad pbv
        WHERE pbv.id_producto=:id_producto
          AND pbv.id_bodega=:id_bodega
          AND pbv.visible=1
      ) AS allowed`,
    { id_producto, id_bodega }
  );
  const restricted = Number(row?.restricted || 0) === 1;
  const allowed = Number(row?.allowed || 0) === 1;
  return !restricted || allowed;
}

async function getActiveWarehouseIds(conn) {
  const [rows] = await conn.query(
    `SELECT id_bodega
     FROM bodegas
     WHERE activo=1
     ORDER BY id_bodega ASC`
  );
  return normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega));
}

async function setProductWarehouseVisibility(conn, idProducto, idBodega, visible) {
  await ensureProductWarehouseVisibilityTable();
  const id_producto = Number(idProducto || 0);
  const id_bodega = Number(idBodega || 0);
  const nextVisible = Number(visible) ? 1 : 0;
  if (!id_producto || !id_bodega) {
    throw new Error("Producto o bodega invalida");
  }

  const [[productRow]] = await conn.query(
    `SELECT id_producto
     FROM productos
     WHERE id_producto=:id_producto
     LIMIT 1`,
    { id_producto }
  );
  if (!productRow) {
    const err = new Error("Producto no existe");
    err.status = 404;
    throw err;
  }

  const [[warehouseRow]] = await conn.query(
    `SELECT id_bodega
     FROM bodegas
     WHERE id_bodega=:id_bodega
       AND activo=1
     LIMIT 1`,
    { id_bodega }
  );
  if (!warehouseRow) {
    const err = new Error("Bodega no existe o esta inactiva");
    err.status = 400;
    throw err;
  }

  const [currentRows] = await conn.query(
    `SELECT id_bodega, visible
     FROM producto_bodegas_visibilidad
     WHERE id_producto=:id_producto`,
    { id_producto }
  );

  if (!currentRows.length) {
    if (nextVisible) return;
    const activeWarehouseIds = await getActiveWarehouseIds(conn);
    for (const wid of activeWarehouseIds) {
      await conn.query(
        `INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
         VALUES (:id_producto, :id_bodega, :visible)`,
        {
          id_producto,
          id_bodega: wid,
          visible: wid === id_bodega ? 0 : 1,
        }
      );
    }
    return;
  }

  await conn.query(
    `INSERT INTO producto_bodegas_visibilidad (id_producto, id_bodega, visible)
     VALUES (:id_producto, :id_bodega, :visible)
     ON DUPLICATE KEY UPDATE visible=VALUES(visible), actualizado_en=CURRENT_TIMESTAMP`,
    { id_producto, id_bodega, visible: nextVisible }
  );

  const activeWarehouseIds = await getActiveWarehouseIds(conn);
  const [visibleRows] = await conn.query(
    `SELECT id_bodega
     FROM producto_bodegas_visibilidad
     WHERE id_producto=:id_producto
       AND visible=1
     ORDER BY id_bodega ASC`,
    { id_producto }
  );
  const visibleIds = normalizeWarehouseIdList((visibleRows || []).map((r) => r.id_bodega));
  if (
    activeWarehouseIds.length &&
    visibleIds.length === activeWarehouseIds.length &&
    visibleIds.every((id, idx) => id === activeWarehouseIds[idx])
  ) {
    await conn.query(
      `DELETE FROM producto_bodegas_visibilidad
       WHERE id_producto=:id_producto`,
      { id_producto }
    );
  }
}

function buildNamedInClause(values, prefix) {
  const ids = normalizeWarehouseIdList(values);
  if (!ids.length) return { sql: "NULL", params: {}, ids };
  const params = {};
  const placeholders = ids.map((id, idx) => {
    const key = `${prefix}${idx}`;
    params[key] = id;
    return `:${key}`;
  });
  return {
    sql: placeholders.join(", "),
    params,
    ids,
  };
}

function getScopedWarehouseFilter(scope, requestedWarehouse, opts = {}) {
  const fallbackToDefault = Boolean(opts.fallbackToDefault);
  const requested = Number(requestedWarehouse || 0) || null;
  const restrictedIds = normalizeWarehouseIdList(scope?.allowed_warehouse_ids || []);
  if (requested) {
    if (restrictedIds.length && !restrictedIds.includes(requested)) {
      return { denied: true, selected: null, restrictedIds };
    }
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

async function ensureDashboardCacheTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS dashboard_cache_resumen (
      scope_key VARCHAR(80) NOT NULL,
      id_bodega INT NULL,
      dias INT NOT NULL,
      mov_days INT NOT NULL,
      payload_json LONGTEXT NOT NULL,
      generado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scope_key),
      KEY idx_cache_generado (generado_en),
      KEY idx_cache_bodega (id_bodega)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureUserAvatarTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_avatar (
      id_usuario INT NOT NULL,
      avatar_data LONGTEXT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureUserOrderPinTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_pin_pedido (
      id_usuario INT NOT NULL,
      pin_hash VARCHAR(255) NOT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario),
      CONSTRAINT fk_usuario_pin_pedido_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureSupervisorPinTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS usuario_pin_supervisor (
      id_usuario INT NOT NULL,
      pin_hash VARCHAR(255) NOT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id_usuario),
      CONSTRAINT fk_usuario_pin_supervisor_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureUsersNoAutoLogoutColumn() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='usuarios'
       AND COLUMN_NAME='no_auto_logout'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE usuarios
       ADD COLUMN no_auto_logout TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
}

async function ensureDailyCloseTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cierre_dia (
      id_cierre BIGINT NOT NULL AUTO_INCREMENT,
      id_bodega INT NOT NULL,
      fecha_cierre DATE NOT NULL,
      total_entradas DECIMAL(18,3) NOT NULL DEFAULT 0,
      total_salidas DECIMAL(18,3) NOT NULL DEFAULT 0,
      total_existencia_cierre DECIMAL(18,3) NOT NULL DEFAULT 0,
      creado_por INT NULL,
      origen ENUM('MANUAL','AUTO') NOT NULL DEFAULT 'MANUAL',
      observaciones VARCHAR(255) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_cierre),
      UNIQUE KEY uq_cierre_bodega_fecha (id_bodega, fecha_cierre),
      KEY idx_cierre_bodega_fecha (id_bodega, fecha_cierre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS cierre_dia_detalle (
      id_cierre_detalle BIGINT NOT NULL AUTO_INCREMENT,
      id_cierre BIGINT NOT NULL,
      id_producto INT NOT NULL,
      sku VARCHAR(80) NULL,
      nombre_producto VARCHAR(180) NULL,
      existencia_inicial DECIMAL(18,3) NOT NULL DEFAULT 0,
      entradas_dia DECIMAL(18,3) NOT NULL DEFAULT 0,
      salidas_dia DECIMAL(18,3) NOT NULL DEFAULT 0,
      existencia_cierre DECIMAL(18,3) NOT NULL DEFAULT 0,
      PRIMARY KEY (id_cierre_detalle),
      KEY idx_detalle_cierre (id_cierre),
      KEY idx_detalle_producto (id_producto),
      CONSTRAINT fk_cierre_detalle_cierre
        FOREIGN KEY (id_cierre) REFERENCES cierre_dia(id_cierre)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureOpsAuditTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS backup_audit (
      id_backup BIGINT NOT NULL AUTO_INCREMENT,
      backup_date DATE NOT NULL,
      trigger_type VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL,
      file_path VARCHAR(500) NULL,
      bytes_written BIGINT NULL,
      creado_por INT NULL,
      error_message VARCHAR(500) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finalizado_en DATETIME NULL,
      PRIMARY KEY (id_backup),
      KEY idx_backup_date (backup_date, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS recovery_test_audit (
      id_test BIGINT NOT NULL AUTO_INCREMENT,
      trigger_type VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL,
      source_file VARCHAR(500) NULL,
      summary_json LONGTEXT NULL,
      creado_por INT NULL,
      error_message VARCHAR(500) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finalizado_en DATETIME NULL,
      PRIMARY KEY (id_test),
      KEY idx_recovery_status (status, creado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureSensitiveActionAuditTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS auditoria_accion_sensible (
      id_auditoria BIGINT NOT NULL AUTO_INCREMENT,
      action_key VARCHAR(80) NOT NULL,
      action_label VARCHAR(180) NOT NULL,
      endpoint VARCHAR(180) NULL,
      http_method VARCHAR(12) NULL,
      id_usuario_actor INT NOT NULL,
      actor_nombre VARCHAR(160) NULL,
      id_bodega_actor INT NULL,
      id_usuario_supervisor INT NULL,
      supervisor_usuario VARCHAR(80) NULL,
      supervisor_nombre VARCHAR(160) NULL,
      approval_method VARCHAR(40) NULL,
      reference_type VARCHAR(40) NULL,
      reference_id BIGINT NULL,
      detail_json LONGTEXT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_auditoria),
      KEY idx_auditoria_fecha (creado_en),
      KEY idx_auditoria_accion (action_key, creado_en),
      KEY idx_auditoria_actor (id_usuario_actor, creado_en),
      KEY idx_auditoria_supervisor (id_usuario_supervisor, creado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureOrderDispatchColumns() {
  const [estadoRows] = await pool.query(
    `SELECT COLUMN_TYPE AS column_type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_encabezado'
       AND COLUMN_NAME='estado'
     LIMIT 1`
  );
  const estadoType = String(estadoRows?.[0]?.column_type || "").toLowerCase();
  if (estadoType.startsWith("enum(") && !estadoType.includes("completado_justificado")) {
    const values = [];
    estadoType.replace(/'([^']*)'/g, (_, v) => {
      values.push(String(v || "").toUpperCase());
      return "";
    });
    if (!values.length) {
      values.push("PENDIENTE", "APROBADO", "PARCIAL", "COMPLETADO", "CANCELADO");
    }
    if (!values.includes("COMPLETADO_JUSTIFICADO")) {
      values.push("COMPLETADO_JUSTIFICADO");
    }
    const enumSql = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
    await pool.query(
      `ALTER TABLE pedido_encabezado
       MODIFY COLUMN estado ENUM(${enumSql}) NOT NULL DEFAULT 'PENDIENTE'`
    );
  }

  const [headRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_encabezado'
       AND COLUMN_NAME='justificacion_despacho'`
  );
  if (Number(headRows?.[0]?.c || 0) <= 0) {
    await pool.query(
      `ALTER TABLE pedido_encabezado
       ADD COLUMN justificacion_despacho TEXT NULL`
    );
  }

  const [lineStateRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_detalle'
       AND COLUMN_NAME='estado_linea'`
  );
  if (Number(lineStateRows?.[0]?.c || 0) <= 0) {
    await pool.query(
      `ALTER TABLE pedido_detalle
       ADD COLUMN estado_linea VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'`
    );
    await pool.query(
      `UPDATE pedido_detalle
       SET estado_linea = CASE
         WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 'DESPACHADO'
         ELSE 'PENDIENTE'
       END`
    );
  }

  const [lineJustRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_detalle'
       AND COLUMN_NAME='justificacion_linea'`
  );
  if (Number(lineJustRows?.[0]?.c || 0) <= 0) {
    await pool.query(
      `ALTER TABLE pedido_detalle
       ADD COLUMN justificacion_linea VARCHAR(255) NULL`
    );
  }

  const [lineCancelByRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_detalle'
       AND COLUMN_NAME='anulado_por'`
  );
  if (Number(lineCancelByRows?.[0]?.c || 0) <= 0) {
    await pool.query(
      `ALTER TABLE pedido_detalle
       ADD COLUMN anulado_por INT NULL`
    );
  }

  const [lineCancelAtRows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_detalle'
       AND COLUMN_NAME='anulado_en'`
  );
  if (Number(lineCancelAtRows?.[0]?.c || 0) <= 0) {
    await pool.query(
      `ALTER TABLE pedido_detalle
       ADD COLUMN anulado_en DATETIME NULL`
    );
  }
}

function permissionDefaults() {
  const map = {};
  PERM_CATALOG.forEach((p) => {
    map[p.key] = Number(typeof p.default_active === "number" ? p.default_active : 1) ? 1 : 0;
  });
  return map;
}

async function getUserPermissionsMap(idUsuario) {
  const base = permissionDefaults();
  const [rows] = await pool.query(
    `SELECT permiso, activo
     FROM usuario_permisos
     WHERE id_usuario=:id_usuario`,
    { id_usuario: idUsuario }
  );
  for (const r of rows || []) {
    if (Object.prototype.hasOwnProperty.call(base, r.permiso)) {
      base[r.permiso] = Number(r.activo) ? 1 : 0;
    }
  }
  return base;
}

async function canManageUserPermissions(idUsuario) {
  const map = await getUserPermissionsMap(idUsuario);
  return Number(map["action.manage_permissions"] || 0) === 1;
}

async function userHasPermission(idUsuario, permiso) {
  const map = await getUserPermissionsMap(idUsuario);
  return Number(map?.[permiso] || 0) === 1;
}

function requirePermission(permiso, etiqueta = "esta accion") {
  return async (req, res, next) => {
    try {
      const idUsuario = Number(req.user?.id_user || 0);
      if (!idUsuario) return res.status(401).json({ error: "Usuario invalido" });
      const allowed = await userHasPermission(idUsuario, permiso);
      if (!allowed) return res.status(403).json({ error: `Sin permiso para ${etiqueta}` });
      return next();
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  };
}

ensureUserPermissionsTable().catch((e) => {
  console.error("No se pudo crear tabla usuario_permisos:", e);
});
ensureUserWarehouseAccessTable().catch((e) => {
  console.error("No se pudo crear tabla usuario_bodegas_acceso:", e);
});
ensureProductWarehouseVisibilityTable().catch((e) => {
  console.error("No se pudo crear tabla producto_bodegas_visibilidad:", e);
});
ensureWarehouseLogoTable().catch((e) => {
  console.error("No se pudo crear tabla bodega_logo:", e);
});
ensureBodegaContactColumns().catch((e) => {
  console.error("No se pudo crear columnas de contacto en bodegas:", e);
});
ensureWarehouseCountOutColumn().catch((e) => {
  console.error("No se pudo crear columna configuracion_bodega.permite_salida_conteo_final:", e);
});
ensureWarehouseSalidaPriceRequirementColumn().catch((e) => {
  console.error("No se pudo crear columna configuracion_bodega.requiere_precio_salida:", e);
});
ensureMovimientoDetallePrecioSalidaColumn().catch((e) => {
  console.error("No se pudo crear columna movimiento_detalle.precio_salida:", e);
});
ensureMovimientoDashboardColumn().catch((e) => {
  console.error("No se pudo crear columna movimiento_encabezado.no_contar_dashboard:", e);
});
ensureMovimientoPastUpdateTrigger().catch((e) => {
  console.error("No se pudo actualizar trigger trg_me_no_update_pasado:", e);
});
ensureCuadreCajaTable().catch((e) => {
  console.error("No se pudo crear tabla cuadre_caja:", e);
});
ensureDashboardCacheTable().catch((e) => {
  console.error("No se pudo crear tabla dashboard_cache_resumen:", e);
});
ensureUserAvatarTable().catch((e) => {
  console.error("No se pudo crear tabla usuario_avatar:", e);
});
ensureUserOrderPinTable().catch((e) => {
  console.error("No se pudo crear tabla usuario_pin_pedido:", e);
});
ensureSupervisorPinTable().catch((e) => {
  console.error("No se pudo crear tabla usuario_pin_supervisor:", e);
});
ensureUsersNoAutoLogoutColumn().catch((e) => {
  console.error("No se pudo crear columna usuarios.no_auto_logout:", e);
});
ensureDailyCloseTables().catch((e) => {
  console.error("No se pudo crear tablas de cierre diario:", e);
});
ensureOpsAuditTables().catch((e) => {
  console.error("No se pudieron crear tablas de backup/recovery:", e);
});
ensureSensitiveActionAuditTable().catch((e) => {
  console.error("No se pudo crear tabla auditoria_accion_sensible:", e);
});
ensureOrderDispatchColumns().catch((e) => {
  console.error("No se pudo actualizar columnas de despacho en pedidos:", e);
});


function onlyToday(dateTimeStr) {
  const d = new Date(dateTimeStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function ymd(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function normalizeYmdInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  return ymd(raw) || "";
}

function addDaysYmd(baseYmd, days) {
  const d = new Date(`${baseYmd}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function dmy(value) {
  const s = ymd(value);
  if (!s) return "";
  const [yyyy, mm, dd] = s.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

const CUADRE_DENOMINACIONES = [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200];
const CUADRE_DOLAR_DENOM_USD = 1;
const CUADRE_DOLAR_TIPO_CAMBIO = 7.3;
const CUADRE_VENTAS_KEYS = ["flor_cafe", "restaurante", "nilas", "eldeck", "cactus", "gelato", "jazmin"];
const CUADRE_PAGOS_KEYS = ["visa", "bancos", "cxc_trabajadores", "cxc_habitaciones", "pase_consumible"];
const CUADRE_EXTRAS_KEYS = ["pedidos_nilas", "cortesias"];

function clampText(v, maxLen = 120) {
  return String(v || "").trim().slice(0, Math.max(0, Number(maxLen || 0)));
}

function numMoney(v) {
  if (v === null || typeof v === "undefined" || v === "") return 0;
  const raw = String(v).replace(/,/g, "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function numQty(v) {
  if (v === null || typeof v === "undefined" || v === "") return 0;
  const raw = String(v).replace(/,/g, "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function normalizeCuadreAmbienteKey(name) {
  const raw = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!raw) return null;
  if (raw.includes("flor") && raw.includes("cafe")) return "flor_cafe";
  if (raw === "restaurante") return "restaurante";
  if (raw === "nilas") return "nilas";
  if (raw === "eldeck") return "eldeck";
  if (raw === "cactus") return "cactus";
  if (raw === "gelato") return "gelato";
  if (raw === "jazmin") return "jazmin";
  return null;
}

function normalizeCuadrePayload(rawPayload = {}, fallback = {}) {
  const raw = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  const previousMonedas = previous.monedas && typeof previous.monedas === "object" ? previous.monedas : {};
  const previousPagos = previous.pagos && typeof previous.pagos === "object" ? previous.pagos : {};
  const previousVentas = previous.ventas && typeof previous.ventas === "object" ? previous.ventas : {};
  const previousVentasRows = Array.isArray(previous.ventas_rows) ? previous.ventas_rows : [];
  const previousExtras = previous.extras && typeof previous.extras === "object" ? previous.extras : {};

  const rawMonedas = raw.monedas && typeof raw.monedas === "object" ? raw.monedas : {};
  const rawPagos = raw.pagos && typeof raw.pagos === "object" ? raw.pagos : {};
  const rawVentas = raw.ventas && typeof raw.ventas === "object" ? raw.ventas : {};
  const rawVentasRows = Array.isArray(raw.ventas_rows) ? raw.ventas_rows : [];
  const rawExtras = raw.extras && typeof raw.extras === "object" ? raw.extras : {};

  const monedas = {};
  for (const d of CUADRE_DENOMINACIONES) {
    const key = String(d);
    const val = numQty(rawMonedas[key] ?? previousMonedas[key] ?? 0);
    monedas[key] = Math.max(0, val);
  }

  const pagos = {};
  for (const k of CUADRE_PAGOS_KEYS) {
    const legacyKey = k === "pase_consumible" ? "day" : null;
    pagos[k] = Math.max(0, numMoney(rawPagos[k] ?? (legacyKey ? rawPagos[legacyKey] : undefined) ?? previousPagos[k] ?? (legacyKey ? previousPagos[legacyKey] : undefined) ?? 0));
  }
  pagos.dolares_cantidad = Math.max(0, numQty(rawPagos.dolares_cantidad ?? previousPagos.dolares_cantidad ?? 0));

  const ventas = {};
  for (const k of CUADRE_VENTAS_KEYS) {
    ventas[k] = Math.max(0, numMoney(rawVentas[k] ?? previousVentas[k] ?? 0));
  }

  const ventas_rows = (rawVentasRows.length ? rawVentasRows : previousVentasRows)
    .slice(0, 250)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const ambiente = clampText(row.ambiente, 80);
      const monto = Math.max(0, numMoney(row.monto));
      if (!ambiente && !monto) return null;
      return { ambiente, monto };
    })
    .filter(Boolean);

  if (ventas_rows.length) {
    const mapped = {
      flor_cafe: 0,
      restaurante: 0,
      nilas: 0,
      eldeck: 0,
      cactus: 0,
      gelato: 0,
      jazmin: 0,
    };
    ventas_rows.forEach((row) => {
      const key = normalizeCuadreAmbienteKey(row.ambiente);
      if (!key) return;
      mapped[key] = Number(mapped[key] || 0) + Number(row.monto || 0);
    });
    for (const k of CUADRE_VENTAS_KEYS) {
      ventas[k] = Math.round(Number(mapped[k] || 0) * 100) / 100;
    }
  }

  const extras = {};
  for (const k of CUADRE_EXTRAS_KEYS) {
    extras[k] = Math.max(0, numMoney(rawExtras[k] ?? previousExtras[k] ?? 0));
  }

  const rawDetalle = Array.isArray(raw.detalle) ? raw.detalle : Array.isArray(previous.detalle) ? previous.detalle : [];
  const detalle = rawDetalle
    .slice(0, 250)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const descripcion = clampText(row.descripcion, 80);
      const nombre = clampText(row.nombre, 120);
      const monto = Math.max(0, numMoney(row.monto));
      const check_no = clampText(row.check_no, 40);
      if (!descripcion && !nombre && !monto && !check_no) return null;
      return { descripcion, nombre, monto, check_no };
    })
    .filter(Boolean);

  const legacyDolaresQuetzales = Math.max(0, numMoney(rawPagos.dolares ?? previousPagos.dolares ?? 0));
  const sede = clampText(raw.sede ?? previous.sede ?? "", 120);
  const responsable = clampText(raw.responsable ?? previous.responsable ?? "", 120);

  const totalEfectivoDenominaciones = CUADRE_DENOMINACIONES.reduce(
    (acc, d) => acc + Number(monedas[String(d)] || 0) * Number(d),
    0
  );
  const total_dolares = Math.round((Number(pagos.dolares_cantidad || 0) * CUADRE_DOLAR_DENOM_USD) * 100) / 100;
  const total_dolares_quetzales = pagos.dolares_cantidad > 0
    ? Math.round((total_dolares * CUADRE_DOLAR_TIPO_CAMBIO) * 100) / 100
    : legacyDolaresQuetzales;
  const total_efectivo = Math.round((totalEfectivoDenominaciones + total_dolares_quetzales) * 100) / 100;
  const total_cobro =
    Math.round((total_efectivo + CUADRE_PAGOS_KEYS.reduce((acc, k) => acc + Number(pagos[k] || 0), 0)) * 100) / 100;

  const total_venta_ambiente = ventas_rows.length
    ? Math.round(ventas_rows.reduce((acc, row) => acc + Number(row.monto || 0), 0) * 100) / 100
    : Math.round(CUADRE_VENTAS_KEYS.reduce((acc, k) => acc + Number(ventas[k] || 0), 0) * 100) / 100;

  const gran_total_reporte =
    Math.round((total_venta_ambiente + CUADRE_EXTRAS_KEYS.reduce((acc, k) => acc + Number(extras[k] || 0), 0)) * 100) /
    100;

  pagos.dolares_total = total_dolares;
  pagos.dolares_quetzales = total_dolares_quetzales;

  const payload = {
    sede,
    responsable,
    monedas,
    pagos,
    ventas,
    ventas_rows,
    extras,
    detalle,
  };

  return {
    payload,
    total_efectivo,
    total_cobro,
    total_venta_ambiente,
    gran_total_reporte,
  };
}
function normalizeDeviceKey(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function getSharedDeviceKeys() {
  return String(process.env.SHARED_DEVICE_KEYS || "")
    .split(",")
    .map((x) => normalizeDeviceKey(x))
    .filter(Boolean);
}

function isValidOrderPin(pin) {
  return /^\d{6,12}$/.test(String(pin || ""));
}

function isValidSupervisorPin(pin) {
  return /^\d{6,12}$/.test(String(pin || ""));
}

async function findOrderPinCollision(pin, excludeUserId = 0, conn = pool, onlyActive = false) {
  const safePin = String(pin || "").trim();
  if (!safePin) return null;
  const excluded = Number(excludeUserId || 0);
  const [rows] = await conn.query(
    `SELECT upp.id_usuario, upp.pin_hash, u.usuario, u.nombre_completo, u.activo
     FROM usuario_pin_pedido upp
     JOIN usuarios u ON u.id_usuario=upp.id_usuario
     WHERE (:exclude_id<=0 OR upp.id_usuario<>:exclude_id)`,
    { exclude_id: excluded }
  );
  for (const row of rows || []) {
    if (onlyActive && Number(row?.activo || 0) !== 1) continue;
    const ok = await bcrypt.compare(safePin, String(row?.pin_hash || ""));
    if (ok) {
      return {
        id_usuario: Number(row.id_usuario || 0),
        usuario: String(row.usuario || ""),
        nombre_completo: String(row.nombre_completo || ""),
      };
    }
  }
  return null;
}

async function verifySensitiveApproval(req, conn, actionLabel) {
  const actorUserId = Number(req.user?.id_user || 0);
  if (!actorUserId) {
    return { ok: false, status: 401, error: "Usuario invalido", code: "INVALID_USER" };
  }

  const supervisor_pin = String(req.body?.supervisor_pin || req.headers["x-supervisor-pin"] || "").trim();
  if (!supervisor_pin) {
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 409,
      error: `Debes ingresar el PIN del supervisor para ${actionLabel}.`,
      code: "SUPERVISOR_PIN_REQUIRED",
      required_fields: ["supervisor_pin"],
    };
  }
  if (!isValidSupervisorPin(supervisor_pin)) {
    trackPinFailure("supervisor", { actor_user_id: actorUserId, mode: "self_supervisor_pin" });
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 400,
      error: "El PIN de supervisor debe tener entre 6 y 12 digitos",
      code: "INVALID_SUPERVISOR_PIN_FORMAT",
    };
  }

  const [supervisors] = await conn.query(
    `SELECT u.id_usuario,
            u.usuario,
            u.nombre_completo,
            u.activo,
            COALESCE(upp.pin_hash, ups.pin_hash) AS pin_hash
     FROM usuarios u
     LEFT JOIN usuario_pin_pedido upp ON upp.id_usuario=u.id_usuario
     LEFT JOIN usuario_pin_supervisor ups ON ups.id_usuario=u.id_usuario
     WHERE u.activo=1
       AND COALESCE(upp.pin_hash, ups.pin_hash) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM usuario_permisos up
         WHERE up.id_usuario=u.id_usuario
           AND up.activo=1
           AND up.permiso='action.sensitive_approve'
       )`
  );
  if (!Array.isArray(supervisors) || !supervisors.length) {
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 503,
      error: "No hay supervisores activos con PIN configurado",
      code: "SUPERVISOR_NOT_AVAILABLE",
    };
  }

  let matchedSupervisor = null;
  for (const sup of supervisors) {
    const ok = await bcrypt.compare(supervisor_pin, String(sup.pin_hash || ""));
    if (ok) {
      matchedSupervisor = sup;
      break;
    }
  }
  if (!matchedSupervisor) {
    trackPinFailure("supervisor", { actor_user_id: actorUserId, mode: "any_supervisor_pin" });
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 401,
      error: "PIN de supervisor invalido",
      code: "INVALID_SUPERVISOR_PIN",
    };
  }

  opsMetrics.sensitive_actions.approved_by_supervisor_pin += 1;
  return {
    ok: true,
    approved_by_user_id: Number(matchedSupervisor.id_usuario || 0) || null,
    approved_by_user: matchedSupervisor.usuario || null,
    approved_by_name: matchedSupervisor.nombre_completo || matchedSupervisor.usuario || null,
    approved_by_method: "SUPERVISOR_PIN",
  };
}

function toSensitiveApprovalPayload(approval) {
  if (!approval || !approval.ok) return null;
  return {
    approved_by_user_id: Number(approval.approved_by_user_id || 0) || null,
    approved_by_user: approval.approved_by_user || null,
    approved_by_name: approval.approved_by_name || null,
    approved_by_method: approval.approved_by_method || null,
  };
}

async function writeSensitiveActionAudit({
  req,
  action_key,
  action_label,
  approval,
  reference_type = null,
  reference_id = null,
  detail = null,
}) {
  if (!approval || !approval.ok) return;
  try {
    const actorUserId = Number(req?.user?.id_user || 0);
    if (!actorUserId) return;
    await pool.query(
      `INSERT INTO auditoria_accion_sensible
       (action_key, action_label, endpoint, http_method, id_usuario_actor, actor_nombre, id_bodega_actor,
        id_usuario_supervisor, supervisor_usuario, supervisor_nombre, approval_method,
        reference_type, reference_id, detail_json)
       VALUES
       (:action_key, :action_label, :endpoint, :http_method, :id_usuario_actor, :actor_nombre, :id_bodega_actor,
        :id_usuario_supervisor, :supervisor_usuario, :supervisor_nombre, :approval_method,
        :reference_type, :reference_id, :detail_json)`,
      {
        action_key: String(action_key || "").slice(0, 80),
        action_label: String(action_label || "").slice(0, 180),
        endpoint: String(req?.originalUrl || req?.path || "").slice(0, 180) || null,
        http_method: String(req?.method || "").slice(0, 12) || null,
        id_usuario_actor: actorUserId,
        actor_nombre: String(req?.user?.full_name || "").trim() || null,
        id_bodega_actor: Number(req?.user?.id_warehouse || 0) || null,
        id_usuario_supervisor: Number(approval.approved_by_user_id || 0) || null,
        supervisor_usuario: String(approval.approved_by_user || "").trim() || null,
        supervisor_nombre: String(approval.approved_by_name || "").trim() || null,
        approval_method: String(approval.approved_by_method || "").trim() || null,
        reference_type: reference_type ? String(reference_type).slice(0, 40) : null,
        reference_id: Number(reference_id || 0) || null,
        detail_json: detail ? JSON.stringify(detail) : null,
      }
    );
  } catch (e) {
    console.error("No se pudo registrar auditoria sensible:", e);
  }
}

function requireSensitiveApproval(actionLabel = "esta accion") {
  return async (req, res, next) => {
    const conn = await pool.getConnection();
    try {
      const approval = await verifySensitiveApproval(req, conn, actionLabel);
      if (!approval.ok) return res.status(Number(approval.status || 403)).json(approval);
      req.sensitive_approval = approval;
      return next();
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    } finally {
      conn.release();
    }
  };
}

async function verifyCurrentSupervisorPin(req, conn, actionLabel) {
  const actorUserId = Number(req.user?.id_user || 0);
  if (!actorUserId) {
    return { ok: false, status: 401, error: "Usuario invalido", code: "INVALID_USER" };
  }
  const isSupervisor = await userHasPermission(actorUserId, "action.sensitive_approve");
  if (!isSupervisor) {
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 403,
      error: `Solo un usuario supervisor puede ${actionLabel}.`,
      code: "SUPERVISOR_REQUIRED",
    };
  }

  const supervisor_pin = String(req.body?.supervisor_pin || req.headers["x-supervisor-pin"] || "").trim();
  if (!supervisor_pin) {
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 409,
      error: `Debes ingresar el PIN del supervisor para ${actionLabel}.`,
      code: "SUPERVISOR_PIN_REQUIRED",
      required_fields: ["supervisor_pin"],
    };
  }
  if (!isValidSupervisorPin(supervisor_pin)) {
    trackPinFailure("supervisor", { actor_user_id: actorUserId, mode: "self_supervisor_pin" });
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 400,
      error: "El PIN del supervisor debe tener entre 6 y 12 digitos",
      code: "INVALID_SUPERVISOR_PIN_FORMAT",
    };
  }

  const [[row]] = await conn.query(
    `SELECT upp.pin_hash
     FROM usuario_pin_pedido upp
     WHERE upp.id_usuario=:id_usuario
     LIMIT 1`,
    { id_usuario: actorUserId }
  );
  if (!row?.pin_hash) {
    trackPinFailure("supervisor", { actor_user_id: actorUserId, mode: "self_supervisor_pin" });
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 400,
      error: "El supervisor no tiene PIN de pedidos configurado",
      code: "SUPERVISOR_PIN_NOT_CONFIGURED",
    };
  }

  const pinOk = await bcrypt.compare(supervisor_pin, String(row.pin_hash || ""));
  if (!pinOk) {
    trackPinFailure("supervisor", { actor_user_id: actorUserId, mode: "self_supervisor_pin" });
    opsMetrics.sensitive_actions.blocked += 1;
    return {
      ok: false,
      status: 401,
      error: "PIN de supervisor invalido",
      code: "INVALID_SUPERVISOR_PIN",
    };
  }

  opsMetrics.sensitive_actions.approved_by_supervisor_pin += 1;
  return {
    ok: true,
    approved_by_user_id: actorUserId,
    approved_by_user: req.user?.username || null,
    approved_by_name: req.user?.full_name || null,
    approved_by_method: "SUPERVISOR_SELF_PIN",
  };
}

async function ensureCatalogCanDeactivate(conn, { entity, id }) {
  if (entity === "PRODUCTO") {
    const [[openOrder]] = await conn.query(
      `SELECT pe.id_pedido
       FROM pedido_detalle pd
       JOIN pedido_encabezado pe ON pe.id_pedido=pd.id_pedido
       WHERE pd.id_producto=:id
         AND pe.estado IN ('PENDIENTE', 'PARCIAL')
       LIMIT 1`,
      { id }
    );
    if (openOrder) {
      return {
        ok: false,
        status: 409,
        error: `No se puede desactivar el producto porque existe en pedido abierto #${openOrder.id_pedido}.`,
        code: "PRODUCT_IN_OPEN_ORDER",
      };
    }
  }

  if (entity === "MOTIVO") {
    const [[openMov]] = await conn.query(
      `SELECT id_movimiento
       FROM movimiento_encabezado
       WHERE id_motivo=:id
         AND COALESCE(estado, 'PENDIENTE') NOT IN ('CONFIRMADO', 'CANCELADO', 'COMPLETADO')
       LIMIT 1`,
      { id }
    );
    if (openMov) {
      return {
        ok: false,
        status: 409,
        error: `No se puede desactivar el motivo porque tiene movimiento abierto #${openMov.id_movimiento}.`,
        code: "MOTIVO_IN_OPEN_MOVEMENT",
      };
    }
  }

  return { ok: true };
}

const BACKUP_TABLES = [
  "bodegas",
  "configuracion_bodega",
  "productos",
  "motivos_movimiento",
  "movimiento_encabezado",
  "movimiento_detalle",
  "kardex",
  "pedido_encabezado",
  "pedido_detalle",
  "cierre_dia",
  "cierre_dia_detalle",
  "categorias",
  "subcategorias",
  "proveedores",
];

function compactStamp(date = new Date()) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

async function writeBackupFile(payload) {
  const stamp = compactStamp();
  const dayDir = path.join(OPS_BACKUP_BASE_DIR, stamp.slice(0, 8));
  await fs.mkdir(dayDir, { recursive: true });
  const filePath = path.join(dayDir, `backup_${stamp}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
  const stat = await fs.stat(filePath);
  return { filePath, bytes: Number(stat.size || 0) };
}

async function createLogicalBackup({ trigger = "AUTO", createdBy = null } = {}) {
  const conn = await pool.getConnection();
  let auditId = 0;
  try {
    const [ins] = await conn.query(
      `INSERT INTO backup_audit (backup_date, trigger_type, status, creado_por)
       VALUES (CURDATE(), :trigger_type, 'RUNNING', :creado_por)`,
      { trigger_type: String(trigger || "AUTO").slice(0, 30), creado_por: createdBy || null }
    );
    auditId = Number(ins.insertId || 0);

    const payload = {
      generated_at: new Date().toISOString(),
      trigger: String(trigger || "AUTO"),
      database: process.env.DB_NAME || null,
      host: process.env.DB_HOST || null,
      tables: {},
    };
    for (const table of BACKUP_TABLES) {
      const [rows] = await conn.query(`SELECT * FROM ${table}`);
      payload.tables[table] = rows || [];
    }

    const { filePath, bytes } = await writeBackupFile(payload);
    await conn.query(
      `UPDATE backup_audit
       SET status='SUCCESS',
           file_path=:file_path,
           bytes_written=:bytes_written,
           finalizado_en=NOW()
       WHERE id_backup=:id_backup`,
      {
        id_backup: auditId,
        file_path: filePath,
        bytes_written: bytes,
      }
    );
    return { ok: true, id_backup: auditId, file_path: filePath, bytes_written: bytes };
  } catch (e) {
    if (auditId) {
      await conn.query(
        `UPDATE backup_audit
         SET status='FAILED',
             error_message=:error_message,
             finalizado_en=NOW()
         WHERE id_backup=:id_backup`,
        {
          id_backup: auditId,
          error_message: String(e.message || e).slice(0, 500),
        }
      );
    }
    return { ok: false, error: String(e.message || e) };
  } finally {
    conn.release();
  }
}

async function runRecoveryDryTest({ trigger = "AUTO", createdBy = null } = {}) {
  const conn = await pool.getConnection();
  let testId = 0;
  try {
    const [ins] = await conn.query(
      `INSERT INTO recovery_test_audit (trigger_type, status, creado_por)
       VALUES (:trigger_type, 'RUNNING', :creado_por)`,
      { trigger_type: String(trigger || "AUTO").slice(0, 30), creado_por: createdBy || null }
    );
    testId = Number(ins.insertId || 0);

    const [[latest]] = await conn.query(
      `SELECT id_backup, file_path
       FROM backup_audit
       WHERE status='SUCCESS'
       ORDER BY finalizado_en DESC, id_backup DESC
       LIMIT 1`
    );
    if (!latest?.file_path || !fsSync.existsSync(String(latest.file_path))) {
      throw new Error("No existe un backup exitoso para validar recovery");
    }
    const raw = await fs.readFile(String(latest.file_path), "utf8");
    const parsed = JSON.parse(raw);
    const tables = parsed?.tables && typeof parsed.tables === "object" ? parsed.tables : {};
    const summary = [];
    for (const table of BACKUP_TABLES) {
      const backupRows = Array.isArray(tables[table]) ? tables[table].length : 0;
      const [[liveCount]] = await conn.query(`SELECT COUNT(*) AS c FROM ${table}`);
      summary.push({
        table,
        backup_rows: backupRows,
        live_rows: Number(liveCount?.c || 0),
      });
    }

    await conn.query(
      `UPDATE recovery_test_audit
       SET status='SUCCESS',
           source_file=:source_file,
           summary_json=:summary_json,
           finalizado_en=NOW()
       WHERE id_test=:id_test`,
      {
        id_test: testId,
        source_file: String(latest.file_path),
        summary_json: JSON.stringify({
          validated_at: new Date().toISOString(),
          mode: "DRY_RUN",
          latest_backup_id: Number(latest.id_backup || 0),
          checks: summary,
        }),
      }
    );
    return { ok: true, id_test: testId };
  } catch (e) {
    if (testId) {
      await conn.query(
        `UPDATE recovery_test_audit
         SET status='FAILED',
             error_message=:error_message,
             finalizado_en=NOW()
         WHERE id_test=:id_test`,
        {
          id_test: testId,
          error_message: String(e.message || e).slice(0, 500),
        }
      );
    }
    return { ok: false, error: String(e.message || e) };
  } finally {
    conn.release();
  }
}

async function maybeRunMonthlyRecoveryTest() {
  const [[last]] = await pool.query(
    `SELECT creado_en
     FROM recovery_test_audit
     WHERE status='SUCCESS'
     ORDER BY creado_en DESC
     LIMIT 1`
  );
  const lastDate = last?.creado_en ? new Date(last.creado_en) : null;
  const ageMs = lastDate ? Date.now() - lastDate.getTime() : Number.MAX_SAFE_INTEGER;
  if (ageMs >= 30 * 24 * 60 * 60 * 1000) {
    await runRecoveryDryTest({ trigger: "MONTHLY_AUTO" });
  }
}

function buildOperationalAlerts() {
  trimOldEvents(opsMetrics.api.recent, OPS_ALERT_WINDOW_MS);
  trimOldEvents(opsMetrics.db.recent_failures, OPS_ALERT_WINDOW_MS);
  trimOldEvents(opsMetrics.pin_failures.order, OPS_PIN_WINDOW_MS);
  trimOldEvents(opsMetrics.pin_failures.supervisor, OPS_PIN_WINDOW_MS);

  const apiRecent = opsMetrics.api.recent;
  const n = apiRecent.length || 1;
  const avgMs = apiRecent.reduce((a, x) => a + Number(x.ms || 0), 0) / n;
  const api5xx = apiRecent.filter((x) => Number(x.status || 0) >= 500).length;
  const pinFails = opsMetrics.pin_failures.order.length + opsMetrics.pin_failures.supervisor.length;
  const alerts = [];
  if (avgMs > 1200) {
    alerts.push({ level: "WARN", code: "API_LATENCY_HIGH", message: `Latencia promedio alta (${Math.round(avgMs)} ms, ultimos 5 min)` });
  }
  if (api5xx >= 8) {
    alerts.push({ level: "ERROR", code: "API_ERRORS_HIGH", message: `Errores 5xx elevados (${api5xx} en ultimos 5 min)` });
  }
  if (opsMetrics.db.recent_failures.length >= 3) {
    alerts.push({
      level: "ERROR",
      code: "DB_FAILURES",
      message: `Fallos DB detectados (${opsMetrics.db.recent_failures.length} en ultimos 5 min)`,
    });
  }
  if (pinFails >= 5) {
    alerts.push({
      level: "WARN",
      code: "PIN_FAILURES",
      message: `Intentos PIN fallidos elevados (${pinFails} en ultimos 15 min)`,
    });
  }
  return alerts;
}

async function buildDailyCloseRows(conn, id_bodega, fecha_cierre) {
  const nextDay = addDaysYmd(fecha_cierre, 1);
  const [rows] = await conn.query(
    `SELECT p.id_producto,
            p.sku,
            p.nombre_producto,
            COALESCE(SUM(CASE WHEN k.creado_en < :fecha_cierre THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_inicial,
            COALESCE(SUM(CASE WHEN DATE(k.creado_en) = :fecha_cierre AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_dia,
            COALESCE(SUM(CASE WHEN DATE(k.creado_en) = :fecha_cierre AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_dia,
            COALESCE(SUM(CASE WHEN k.creado_en < :next_day THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_cierre
     FROM productos p
     LEFT JOIN kardex k
       ON k.id_producto = p.id_producto
      AND k.id_bodega = :id_bodega
     WHERE p.activo = 1
     GROUP BY p.id_producto, p.sku, p.nombre_producto
     HAVING ABS(existencia_inicial) > 0
         OR ABS(entradas_dia) > 0
         OR ABS(salidas_dia) > 0
         OR ABS(existencia_cierre) > 0
     ORDER BY p.nombre_producto ASC`,
    { id_bodega, fecha_cierre, next_day: nextDay }
  );
  return rows || [];
}

async function createDailyCloseForDate(conn, { id_bodega, fecha_cierre, creado_por, origen = "MANUAL", observaciones = null }) {
  const [[already]] = await conn.query(
    `SELECT id_cierre, fecha_cierre
     FROM cierre_dia
     WHERE id_bodega=:id_bodega AND fecha_cierre=:fecha_cierre
     LIMIT 1`,
    { id_bodega, fecha_cierre }
  );
  if (already) {
    const [existingRows] = await conn.query(
      `SELECT id_producto, sku, nombre_producto, existencia_inicial, entradas_dia, salidas_dia, existencia_cierre
       FROM cierre_dia_detalle
       WHERE id_cierre=:id_cierre
       ORDER BY nombre_producto ASC`,
      { id_cierre: already.id_cierre }
    );
    return {
      id_cierre: already.id_cierre,
      fecha_cierre: ymd(already.fecha_cierre),
      already_exists: true,
      rows: existingRows || [],
    };
  }

  const rows = await buildDailyCloseRows(conn, id_bodega, fecha_cierre);
  const total_entradas = rows.reduce((acc, r) => acc + Number(r.entradas_dia || 0), 0);
  const total_salidas = rows.reduce((acc, r) => acc + Number(r.salidas_dia || 0), 0);
  const total_existencia_cierre = rows.reduce((acc, r) => acc + Number(r.existencia_cierre || 0), 0);

  const [ins] = await conn.query(
    `INSERT INTO cierre_dia
      (id_bodega, fecha_cierre, total_entradas, total_salidas, total_existencia_cierre, creado_por, origen, observaciones)
     VALUES
      (:id_bodega, :fecha_cierre, :total_entradas, :total_salidas, :total_existencia_cierre, :creado_por, :origen, :observaciones)`,
    {
      id_bodega,
      fecha_cierre,
      total_entradas,
      total_salidas,
      total_existencia_cierre,
      creado_por: creado_por || null,
      origen,
      observaciones: observaciones || null,
    }
  );
  const id_cierre = Number(ins.insertId || 0);

  for (const r of rows) {
    await conn.query(
      `INSERT INTO cierre_dia_detalle
        (id_cierre, id_producto, sku, nombre_producto, existencia_inicial, entradas_dia, salidas_dia, existencia_cierre)
       VALUES
        (:id_cierre, :id_producto, :sku, :nombre_producto, :existencia_inicial, :entradas_dia, :salidas_dia, :existencia_cierre)`,
      {
        id_cierre,
        id_producto: r.id_producto,
        sku: r.sku || null,
        nombre_producto: r.nombre_producto || null,
        existencia_inicial: Number(r.existencia_inicial || 0),
        entradas_dia: Number(r.entradas_dia || 0),
        salidas_dia: Number(r.salidas_dia || 0),
        existencia_cierre: Number(r.existencia_cierre || 0),
      }
    );
  }

  return {
    id_cierre,
    fecha_cierre,
    already_exists: false,
    rows,
    total_entradas,
    total_salidas,
    total_existencia_cierre,
  };
}

async function enforceDailyCloseBeforeMutations(req, res, next) {
  let scope = null;
  try {
    scope = await resolveStockScope(req.user);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
  if (!scope?.is_bodeguero) return next();

  const id_bodega = Number(req.user?.id_warehouse || 0);
  if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    const [[dates]] = await conn.query(`SELECT CURDATE() AS hoy, DATE_SUB(CURDATE(), INTERVAL 1 DAY) AS ayer`);
    const hoy = ymd(dates?.hoy);
    const ayer = ymd(dates?.ayer);
    const [[todayClose]] = await conn.query(
      `SELECT c.id_cierre, c.fecha_cierre, c.creado_por, u.nombre_completo AS creado_por_nombre
       FROM cierre_dia c
       LEFT JOIN usuarios u ON u.id_usuario=c.creado_por
       WHERE c.id_bodega=:id_bodega
         AND c.fecha_cierre=CURDATE()
       LIMIT 1`,
      { id_bodega }
    );
    if (todayClose) {
      const cierreFecha = dmy(todayClose.fecha_cierre);
      const cierreUserId = Number(todayClose.creado_por || 0) || null;
      const cierreNombre = String(todayClose.creado_por_nombre || "").trim() || "Usuario no identificado";
      return res.status(409).json({
        error: `El usuario #${cierreUserId || "N/A"} (${cierreNombre}) ya realizo el cierre para el dia de hoy (${cierreFecha}).`,
        code: "DAY_ALREADY_CLOSED",
        fecha_cierre: ymd(todayClose.fecha_cierre),
        cerrado_por_id: cierreUserId,
        cerrado_por_nombre: cierreNombre,
      });
    }

    const [[lastClose]] = await conn.query(
      `SELECT MAX(fecha_cierre) AS last_closed_date
       FROM cierre_dia
       WHERE id_bodega=:id_bodega`,
      { id_bodega }
    );
    const lastClosedDate = ymd(lastClose?.last_closed_date);
    if (ayer && (!lastClosedDate || lastClosedDate < ayer)) {
      const requiredCloseDate = lastClosedDate ? addDaysYmd(lastClosedDate, 1) : ayer;
      return res.status(409).json({
        error: `No se ha realizado el cierre manual pendiente para la bodega ${id_bodega}. Debes cerrar la fecha ${dmy(requiredCloseDate)} para continuar.`,
        code: "PENDING_PREVIOUS_DAY_CLOSE",
        required_close_date: requiredCloseDate,
        last_closed_date: lastClosedDate,
        fecha_hoy: hoy,
      });
    }

    return next();
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
}

function withTimeout(promise, ms, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), ms);
    }),
  ]);
}

function normalizeAvatarData(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\\r\\n]+$/i.test(s)) return null;
  if (s.length > 1_400_000) return null;
  return s;
}

function normalizeLogoData(value) {
  return normalizeAvatarData(value);
}

function isAvatarTableMissingError(e) {
  return e && (e.code === "ER_NO_SUCH_TABLE" || String(e.message || "").includes("usuario_avatar"));
}

function isWarehouseLogoTableMissingError(e) {
  return e && (e.code === "ER_NO_SUCH_TABLE" || String(e.message || "").includes("bodega_logo"));
}

const DASHBOARD_CACHE_TTL_SEC = 300;
const dashboardRefreshInFlight = new Set();

function dashboardScopeKey(id_bodega, days, mov_days) {
  return `${Number(id_bodega || 0)}:${Number(days || 0)}:${Number(mov_days || 0)}`;
}

async function readDashboardResumenCache(scope_key) {
  const [[row]] = await pool.query(
    `SELECT scope_key, payload_json, generado_en,
            TIMESTAMPDIFF(SECOND, generado_en, NOW()) AS age_sec
     FROM dashboard_cache_resumen
     WHERE scope_key=:scope_key
     LIMIT 1`,
    { scope_key }
  );
  if (!row) return null;
  let payload = null;
  try {
    payload = JSON.parse(String(row.payload_json || "{}"));
  } catch {
    payload = null;
  }
  return {
    payload,
    generado_en: row.generado_en,
    age_sec: Number(row.age_sec || 0),
  };
}

async function writeDashboardResumenCache({ scope_key, id_bodega, days, mov_days, payload }) {
  await pool.query(
    `INSERT INTO dashboard_cache_resumen
      (scope_key, id_bodega, dias, mov_days, payload_json)
     VALUES (:scope_key, :id_bodega, :dias, :mov_days, :payload_json)
     ON DUPLICATE KEY UPDATE
      id_bodega=VALUES(id_bodega),
      dias=VALUES(dias),
      mov_days=VALUES(mov_days),
      payload_json=VALUES(payload_json),
      generado_en=CURRENT_TIMESTAMP`,
    {
      scope_key,
      id_bodega: id_bodega || null,
      dias: days,
      mov_days,
      payload_json: JSON.stringify(payload || {}),
    }
  );
}

function emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }) {
  return {
    scope: {
      id_bodega,
      bodega_nombre,
      can_all_bodegas: scope.can_all_bodegas,
      bodega_usuario: scope.id_bodega,
    },
    params: { days, mov_days },
    resumen: {
      productos_vigentes: 0,
      productos_vencidos: 0,
      productos_proximos: 0,
      productos_bajo_minimo: 0,
      productos_proximo_minimo: 0,
      productos_entre_minimo_ideal: 0,
      cantidad_vigente: 0,
      cantidad_vencida: 0,
      cantidad_proxima: 0,
      total_dinero: 0,
    },
    mas_movimiento: null,
    menos_movimiento: null,
  };
}

async function triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days }) {
  if (dashboardRefreshInFlight.has(scope_key)) return;
  dashboardRefreshInFlight.add(scope_key);
  try {
    const fresh = await buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days });
    await writeDashboardResumenCache({
      scope_key,
      id_bodega,
      days,
      mov_days,
      payload: fresh,
    });
  } catch (e) {
    console.error("No se pudo refrescar cache dashboard:", e);
  } finally {
    dashboardRefreshInFlight.delete(scope_key);
  }
}

async function buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days }) {
  const sumPromise = pool.query(
    `SELECT
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
          THEN v.id_producto
          ELSE NULL
        END) AS productos_vigentes,
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE())
          THEN v.id_producto
          ELSE NULL
        END) AS productos_vencidos,
        COUNT(DISTINCT CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)
          THEN v.id_producto
          ELSE NULL
        END) AS productos_proximos,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE()) THEN v.stock ELSE 0
        END) AS cantidad_vigente,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE()) THEN v.stock ELSE 0
        END) AS cantidad_vencida,
        SUM(CASE
          WHEN (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)
          THEN v.stock ELSE 0
        END) AS cantidad_proxima
     FROM v_stock_por_lote v
     WHERE v.stock > 0
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)`,
    { id_bodega, days }
  );

  const moneyPromise = pool.query(
    `SELECT
        SUM(
          vs.stock * COALESCE(
            (
              SELECT k1.costo_unitario
              FROM kardex k1
              LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
              WHERE k1.id_bodega=vs.id_bodega
                AND k1.id_producto=vs.id_producto
                AND k1.delta_cantidad > 0
                AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                AND COALESCE(me1.no_contar_dashboard, 0) = 0
              ORDER BY k1.creado_en DESC, k1.id_kardex DESC
              LIMIT 1
            ),
            (
              SELECT k2.costo_unitario
              FROM kardex k2
              WHERE k2.id_bodega=vs.id_bodega
                AND k2.id_producto=vs.id_producto
                AND k2.delta_cantidad > 0
              ORDER BY k2.creado_en DESC, k2.id_kardex DESC
              LIMIT 1
            ),
            0
          )
        ) AS total_dinero
     FROM v_stock_resumen vs
     WHERE vs.stock > 0
       AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)`,
    { id_bodega }
  );

  const stockLevelPromise = pool.query(
    `SELECT
        COUNT(DISTINCT CASE
          WHEN COALESCE(lpb.activo, 1) = 1
               AND COALESCE(lpb.minimo, 0) > 0
               AND COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0)
          THEN vs.id_producto
          ELSE NULL
        END) AS productos_bajo_minimo,
        COUNT(DISTINCT CASE
          WHEN COALESCE(lpb.activo, 1) = 1
               AND COALESCE(lpb.minimo, 0) > 0
               AND COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1)
          THEN vs.id_producto
          ELSE NULL
        END) AS productos_proximo_minimo
     FROM v_stock_resumen vs
     LEFT JOIN limites_producto_bodega lpb
       ON lpb.id_bodega=vs.id_bodega
      AND lpb.id_producto=vs.id_producto
     WHERE vs.stock > 0
       AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)`,
    { id_bodega }
  );

  const topPromise = pool.query(
    `SELECT k.id_producto, p.nombre_producto, p.sku,
            SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento
     FROM kardex k
     JOIN productos p ON p.id_producto=k.id_producto
     LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
     WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
       AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
       AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
       AND COALESCE(me.no_contar_dashboard, 0) = 0
     GROUP BY k.id_producto, p.nombre_producto, p.sku
     HAVING SUM(ABS(k.delta_cantidad)) > 0
     ORDER BY cantidad_movimiento DESC, p.nombre_producto ASC
     LIMIT 1`,
    { id_bodega, mov_days }
  );

  const lowPromise = pool.query(
    `SELECT k.id_producto, p.nombre_producto, p.sku,
            SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento
     FROM kardex k
     JOIN productos p ON p.id_producto=k.id_producto
     LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
     WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
       AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
       AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
       AND COALESCE(me.no_contar_dashboard, 0) = 0
     GROUP BY k.id_producto, p.nombre_producto, p.sku
     HAVING SUM(ABS(k.delta_cantidad)) > 0
     ORDER BY cantidad_movimiento ASC, p.nombre_producto ASC
     LIMIT 1`,
    { id_bodega, mov_days }
  );

  const [sumRes, moneyRes, stockLevelRes, topRes, lowRes] = await Promise.all([
    withTimeout(sumPromise, 10000, [[]]),
    withTimeout(moneyPromise, 2500, [[]]),
    withTimeout(stockLevelPromise, 8000, [[]]),
    withTimeout(topPromise, 7000, [[]]),
    withTimeout(lowPromise, 7000, [[]]),
  ]);
  const sum = (sumRes?.[0] || [])[0] || {};
  const moneyRow = (moneyRes?.[0] || [])[0] || {};
  const stockLevelRow = (stockLevelRes?.[0] || [])[0] || {};
  const topRows = topRes?.[0] || [];
  const lowRows = lowRes?.[0] || [];

  return {
    scope: {
      id_bodega,
      bodega_nombre,
      can_all_bodegas: scope.can_all_bodegas,
      bodega_usuario: scope.id_bodega,
    },
    params: { days, mov_days },
    resumen: {
      productos_vigentes: Number(sum?.productos_vigentes || 0),
      productos_vencidos: Number(sum?.productos_vencidos || 0),
      productos_proximos: Number(sum?.productos_proximos || 0),
      productos_bajo_minimo: Number(stockLevelRow?.productos_bajo_minimo || 0),
      productos_proximo_minimo: Number(stockLevelRow?.productos_proximo_minimo || 0),
      productos_entre_minimo_ideal: Number(stockLevelRow?.productos_proximo_minimo || 0),
      cantidad_vigente: Number(sum?.cantidad_vigente || 0),
      cantidad_vencida: Number(sum?.cantidad_vencida || 0),
      cantidad_proxima: Number(sum?.cantidad_proxima || 0),
      total_dinero: Number(moneyRow?.total_dinero || 0),
    },
    mas_movimiento: topRows?.[0] || null,
    menos_movimiento: lowRows?.[0] || null,
  };
}

const DASHBOARD_PREWARM_MS = 5 * 60 * 1000;
const DASHBOARD_PREWARM_ENABLED = String(process.env.DASHBOARD_PREWARM || "1") !== "0";
let dashboardPrewarmRunning = false;

async function prewarmDashboardCache() {
  if (dashboardPrewarmRunning) return;
  dashboardPrewarmRunning = true;
  try {
    const days = 30;
    const mov_days = 30;
    const [bodegas] = await pool.query(
      `SELECT DISTINCT b.id_bodega, b.nombre_bodega
       FROM bodegas b
       JOIN usuarios u ON u.id_bodega=b.id_bodega
       WHERE b.activo=1
       ORDER BY b.id_bodega ASC
       LIMIT 25`
    );

    const targets = [{ id_bodega: null, bodega_nombre: null, can_all_bodegas: true }];
    for (const b of bodegas || []) {
      targets.push({
        id_bodega: Number(b.id_bodega || 0) || null,
        bodega_nombre: b.nombre_bodega || null,
        can_all_bodegas: false,
      });
    }

    for (const t of targets) {
      await triggerDashboardRefresh({
        scope_key: dashboardScopeKey(t.id_bodega, days, mov_days),
        id_bodega: t.id_bodega,
        bodega_nombre: t.bodega_nombre,
        scope: {
          can_all_bodegas: t.can_all_bodegas,
          id_bodega: t.id_bodega || 0,
        },
        days,
        mov_days,
      });
    }

    await pool.query(
      `DELETE FROM dashboard_cache_resumen
       WHERE generado_en < DATE_SUB(NOW(), INTERVAL 2 DAY)`
    );
    console.log("Dashboard cache precalentado:", targets.length, "alcances");
  } catch (e) {
    console.error("Error en prewarm dashboard cache:", e);
  } finally {
    dashboardPrewarmRunning = false;
  }
}

/* =========================
   AUTH
========================= */
