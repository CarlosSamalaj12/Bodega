import express from "express";
import ExpressLayer from "express/lib/router/layer.js";
import cors from "cors";
import compression from "compression";
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
import webpush from "web-push";
import { pool } from "./db.js";

// ── Web Push (VAPID) ───────────────────────────────────────────────
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@bodega.com").trim();
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const app = express();

// ── Compresión gzip de respuestas (reduce el payload JSON de reportes y listados) ──
app.use(compression());

// ── Parche Express 4: reenviar rechazos async al middleware de errores ──
// Express 4 no captura promesas rechazadas dentro de handlers async: sin este
// parche un error async puede tumbar el proceso y dejar al cliente colgado.
// Envuelve cada handler (menos los error-handlers de 4 args) y reenvia el
// rechazo a next(err), llegando al app.use((err, req, res, next)) global.
{
  const wrapAsync = (fn) =>
    function wrappedAsyncHandler(req, res, next) {
      const ret = fn.apply(this, arguments);
      if (ret && typeof ret.catch === "function") ret.catch(next);
      return ret;
    };
  Object.defineProperty(ExpressLayer.prototype, "handle", {
    enumerable: true,
    configurable: true,
    get() {
      return this.__handle;
    },
    set(fn) {
      if (typeof fn === "function" && fn.length <= 3) fn = wrapAsync(fn);
      this.__handle = fn;
    },
  });
}

const httpServer = createServer(app);
const HOST = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001) || 3001;
// Cookie JWT (HttpOnly + SameSite=Lax): `Secure` se activa en producción (HTTPS)
// o si se fuerza con COOKIE_SECURE=1 (p. ej. dev detrás de TLS/proxy).
const COOKIE_SECURE =
  String(process.env.COOKIE_SECURE || "").trim() === "1" ||
  String(process.env.COOKIE_SECURE || "").trim() === "true" ||
  process.env.NODE_ENV === "production";
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
// Nuevo frontend React (build de producción)
app.use(express.static(path.join(__dirname, "client", "dist")));
// Assets compartidos: SW, manifest, iconos PWA (todavía en public/)
app.use(express.static(path.join(__dirname, "public")));
app.use("/imagenes", express.static(path.join(__dirname, "imagenes")));

// SPA — React Router maneja las rutas del lado del cliente
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

const OPS_ALERT_WINDOW_MS = 5 * 60 * 1000;
const OPS_PIN_WINDOW_MS = 15 * 60 * 1000;
const OPS_BACKUP_AUTO_ENABLED = String(process.env.BACKUP_AUTO_ENABLED || "1") !== "0";
const OPS_BACKUP_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000));
const OPS_BACKUP_BASE_DIR = path.join(__dirname, "backups", "daily");
const OPS_RECOVERY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_WINDOW_MS = Math.max(3000, Number(process.env.IDEMPOTENCY_WINDOW_MS || 15000));
const recentRequestSignatures = new Map();
// Healthcheck periódico de la tabla materializada stock_actual (Fase 4): compara
// contra el agregado real de kardex, loguea y emite "stock:desync" si hay
// desviaciones. NO reconstruye automáticamente (la reparación es deliberada vía
// `npm run deploy:stock`). Configurable por env:
//   STOCK_HC_ENABLED=0         deshabilita el healthcheck
//   STOCK_HC_INTERVAL_MS=...   intervalo en ms (mínimo 1 minuto)
const STOCK_HC_ENABLED = String(process.env.STOCK_HC_ENABLED || "1") !== "0";
const STOCK_HC_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.STOCK_HC_INTERVAL_MS || 30 * 60 * 1000));
const STOCK_HC_MAX_DETAILS = 10;
// N máximas corridas guardadas en opsMetrics.stock_actual.history (para detectar
// desalineación intermitente en /api/ops/metrics).
const STOCK_HC_HISTORY_LIMIT = 50;

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
  stock_actual: {
    status: "unknown", // "ok" | "desync" | "error"
    last_check_at: null,
    expected_groups: 0,
    actual_groups: 0,
    mismatches: 0,
    last_error: null,
    history: [], // últimas STOCK_HC_HISTORY_LIMIT corridas: { at, status, mismatches, expected_groups, actual_groups, ms }
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
// NOTA: el redirect /public/login.html → /login.html se eliminó porque
// ya no existe el frontend legacy en public/ (reemplazado por React en client/dist).

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

async function ensureRecepcionConfirmacionSchema() {
  // Config por bodega: al despachar, exigir PIN del solicitante como fe de recibido
  const [[cfgCol]] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='configuracion_bodega'
       AND COLUMN_NAME='requiere_confirmacion_recepcion'`
  );
  if (!Number(cfgCol?.c || 0)) {
    await pool.query(
      `ALTER TABLE configuracion_bodega
       ADD COLUMN requiere_confirmacion_recepcion TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
  // Datos de confirmacion en el pedido (snapshot + quien/cuando confirmo)
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS col
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='pedido_encabezado'
       AND COLUMN_NAME IN ('confirmacion_requerida','confirmado_por','confirmado_en')`
  );
  const colSet = new Set((cols || []).map((r) => String(r?.col || "").toLowerCase()));
  if (!colSet.has("confirmacion_requerida")) {
    await pool.query(
      `ALTER TABLE pedido_encabezado
       ADD COLUMN confirmacion_requerida TINYINT(1) NOT NULL DEFAULT 0`
    );
  }
  if (!colSet.has("confirmado_por")) {
    await pool.query(
      `ALTER TABLE pedido_encabezado
       ADD COLUMN confirmado_por INT NULL`
    );
  }
  if (!colSet.has("confirmado_en")) {
    await pool.query(
      `ALTER TABLE pedido_encabezado
       ADD COLUMN confirmado_en DATETIME NULL`
    );
  }
}

async function ensurePerformanceIndexes() {
  // Índices compuestos para las consultas de listados/reportes más usadas.
  // Cada uno se verifica contra information_schema y se crea solo si falta,
  // para que sea idempotente entre reinicios.
  const wanted = [
    // Pedidos por despachar: p.id_bodega_surtidor=:wh ORDER BY p.creado_en DESC
    {
      name: "ix_pe_bodsurt_creado",
      sql: "ALTER TABLE pedido_encabezado ADD INDEX ix_pe_bodsurt_creado (id_bodega_surtidor, creado_en)",
    },
    // Pedidos "míos": p.id_usuario_solicita=:uid ORDER BY p.creado_en DESC
    {
      name: "ix_pe_solicita_creado",
      sql: "ALTER TABLE pedido_encabezado ADD INDEX ix_pe_solicita_creado (id_usuario_solicita, creado_en)",
    },
    // Reporte entradas: bodega destino + rango de fecha + tipo
    {
      name: "ix_me_destino_tipo_creado",
      sql: "ALTER TABLE movimiento_encabezado ADD INDEX ix_me_destino_tipo_creado (id_bodega_destino, tipo_movimiento, creado_en)",
    },
    // Reporte salidas: bodega origen + rango de fecha + tipo
    {
      name: "ix_me_origen_tipo_creado",
      sql: "ALTER TABLE movimiento_encabezado ADD INDEX ix_me_origen_tipo_creado (id_bodega_origen, tipo_movimiento, creado_en)",
    },
    // Búsquedas exactas por SKU (antes sin índice → full scan)
    {
      name: "ix_producto_sku",
      sql: "ALTER TABLE productos ADD INDEX ix_producto_sku (sku)",
    },
    // Índice covering para las vistas de stock y el derived table fecha_entrada_lote
    // (reportes de existencias/próximos a vencer): permite index-only scan del
    // GROUP BY (id_bodega, id_producto, lote, fecha_vencimiento) + SUM(delta) +
    // MIN(DATE(creado_en)) sin tocar filas de la tabla kardex (que crece sin límite).
    {
      name: "ix_kardex_covering",
      sql: "ALTER TABLE kardex ADD INDEX ix_kardex_covering (id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, creado_en)",
    },
  ];
  const [existing] = await pool.query(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE()
       AND INDEX_NAME IN ('ix_pe_bodsurt_creado','ix_pe_solicita_creado','ix_me_destino_tipo_creado','ix_me_origen_tipo_creado','ix_producto_sku','ix_kardex_covering')
     GROUP BY INDEX_NAME`
  );
  const existingSet = new Set((existing || []).map((r) => String(r?.INDEX_NAME || "")));
  for (const idx of wanted) {
    if (!existingSet.has(idx.name)) {
      try {
        await pool.query(idx.sql);
        console.log(`Índice creado: ${idx.name}`);
      } catch (e) {
        console.error(`No se pudo crear índice ${idx.name}:`, String(e?.message || e));
      }
    }
  }

  // ix_kardex_covering necesita creado_en al final para el MIN(DATE(creado_en))
  // de fecha_entrada_lote. Si existe con la definición vieja (sin creado_en),
  // se recrea; el chequeo por nombre solo no basta porque el índice ya existe.
  // El DROP se gatea por existencia previa para que, si el índice no existe en
  // absoluto, el ADD igual se ejecute (no romper en el DROP).
  const [[cov]] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='kardex'
       AND INDEX_NAME='ix_kardex_covering'
       AND COLUMN_NAME='creado_en'`
  );
  if (Number(cov?.c || 0) === 0) {
    try {
      const [[hasIdx]] = await pool.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA=DATABASE()
           AND TABLE_NAME='kardex'
           AND INDEX_NAME='ix_kardex_covering'`
      );
      if (Number(hasIdx?.c || 0) > 0) {
        await pool.query(`ALTER TABLE kardex DROP INDEX ix_kardex_covering`);
      }
      await pool.query(`ALTER TABLE kardex ADD INDEX ix_kardex_covering (id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, creado_en)`);
      console.log("Índice asegurado: ix_kardex_covering (con creado_en)");
    } catch (e) {
      console.error(`No se pudo recrear índice ix_kardex_covering:`, String(e?.message || e));
    }
  }
}

// ── Fase 4: tabla materializada stock_actual ─────────────────────────────────
// v_stock_por_lote / v_stock_resumen agregaban TODO el kardex (que crece sin
// límite) en cada consulta. Ahora el stock por (bodega, producto, lote, fecha)
// vive en stock_actual, mantenida transaccionalmente por triggers sobre kardex
// (misma transacción que el movimiento: si se revierte el movimiento, se
// revierte el efecto del trigger). Las vistas se redefinen para leer de
// stock_actual y ya no agregan kardex.
async function ensureStockActualTable() {
  // Clave NULL-safe: lote/fecha_vencimiento pueden ser NULL, y un UNIQUE con
  // columnas NULLables dejaría filas duplicadas (NULL != NULL). Se usan columnas
  // generadas STORED con prefijo 'N'/'Y' que distinguen NULL de cualquier valor.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_actual (
      id_bodega INT NOT NULL,
      id_producto INT NOT NULL,
      lote VARCHAR(60) NULL,
      fecha_vencimiento DATE NULL,
      stock DECIMAL(18,3) NOT NULL DEFAULT 0,
      fecha_entrada_lote DATE NULL,
      lote_key VARCHAR(61)
        GENERATED ALWAYS AS (CONCAT(IF(lote IS NULL, 'N', 'Y'), COALESCE(lote, ''))) STORED,
      fecha_key DATE
        GENERATED ALWAYS AS (IF(fecha_vencimiento IS NULL, '1000-01-01', fecha_vencimiento)) STORED,
      UNIQUE KEY uq_stock_actual (id_bodega, id_producto, lote_key, fecha_key),
      KEY ix_sa_base (id_bodega, id_producto, lote, fecha_vencimiento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Índice base para los lookups de los triggers (matchean por columnas base con
  // <=>). Idempotente por si la tabla ya existía sin él.
  const [saIdx] = await pool.query(`
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND INDEX_NAME='ix_sa_base'
    GROUP BY INDEX_NAME`);
  if (!saIdx.length) {
    await pool.query(`ALTER TABLE stock_actual ADD INDEX ix_sa_base (id_bodega, id_producto, lote, fecha_vencimiento)`);
  }

  // Columna materializada fecha_entrada_lote = MIN(DATE(creado_en)) de las filas
  // con delta_cantidad > 0 del lote (la usan los reportes de existencias/alertas
  // sin tener que agregar kardex por request). Idempotente por si la tabla ya
  // existía sin ella; si se añade sobre datos existentes, se fuerza el backfill.
  let forceBackfill = false;
  const [[felCol]] = await pool.query(`
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND COLUMN_NAME='fecha_entrada_lote'`);
  if (Number(felCol?.c || 0) === 0) {
    await pool.query(`ALTER TABLE stock_actual ADD COLUMN fecha_entrada_lote DATE NULL AFTER stock`);
    forceBackfill = true; // la columna es nueva: hay que repoblar la tabla completa
  }

  // Alineación de collation: stock_actual debe usar la MISMA collation que kardex
  // en la columna lote. La tabla se creó con el COLLATE por defecto de la BD
  // (en MariaDB 12.x: utf8mb4_uca1400_ai_ci), mientras kardex usa
  // utf8mb4_unicode_ci; si difieren, cualquier `<=>` entre ambas columnas lote
  // (triggers ad/au, subconsultas k2/k3 del reporte de existencias) lanza
  // ER_CANT_AGGREGATE_2COLLATIONS. Idempotente: solo actúa si hay desalineación.
  const [[kardexLote]] = await pool.query(`
    SELECT COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='kardex'
      AND COLUMN_NAME='lote'`);
  const [[stockLote]] = await pool.query(`
    SELECT COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND COLUMN_NAME='lote'`);
  const kardexCollation = kardexLote?.COLLATION_NAME || "utf8mb4_unicode_ci";
  if (stockLote?.COLLATION_NAME && stockLote.COLLATION_NAME !== kardexCollation) {
    await pool.query(`
      ALTER TABLE stock_actual
        MODIFY lote VARCHAR(60) CHARACTER SET utf8mb4 COLLATE ${kardexCollation} NULL,
        MODIFY lote_key VARCHAR(61) CHARACTER SET utf8mb4 COLLATE ${kardexCollation}
          GENERATED ALWAYS AS (CONCAT(IF(lote IS NULL, 'N', 'Y'), COALESCE(lote, ''))) STORED`);
    console.log(`stock_actual.lote alineada a collation ${kardexCollation}`);
  }

  // Triggers de mantenimiento transaccional sobre kardex.
  // IMPORTANTE: se crean ANTES del backfill. Los ensure* se lanzan fire-and-forget
  // en module-load mientras httpServer.listen arranca de inmediato; si el backfill
  // corriera antes que los triggers, una escritura de kardex en esa ventana quedaría
  // fuera de stock_actual para siempre. Con triggers primero, todo INSERT/DELETE/
  // UPDATE queda contabilizado y el backfill (bajo LOCK TABLES) rellena el
  // histórico sin huecos.
  await pool.query(`DROP TRIGGER IF EXISTS trg_kardex_stock_ai`);
  await pool.query(`
    CREATE TRIGGER trg_kardex_stock_ai
    AFTER INSERT ON kardex
    FOR EACH ROW
    BEGIN
      INSERT INTO stock_actual (id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote)
      VALUES (NEW.id_bodega, NEW.id_producto, NEW.lote, NEW.fecha_vencimiento, NEW.delta_cantidad,
              IF(NEW.delta_cantidad > 0, DATE(NEW.creado_en), NULL))
      ON DUPLICATE KEY UPDATE
        stock = stock + NEW.delta_cantidad,
        fecha_entrada_lote = IF(NEW.delta_cantidad > 0,
                                LEAST(COALESCE(fecha_entrada_lote, DATE(NEW.creado_en)), DATE(NEW.creado_en)),
                                fecha_entrada_lote);
    END
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_kardex_stock_ad`);
  await pool.query(`
    CREATE TRIGGER trg_kardex_stock_ad
    AFTER DELETE ON kardex
    FOR EACH ROW
    BEGIN
      UPDATE stock_actual
         SET stock = stock - OLD.delta_cantidad
       WHERE id_bodega = OLD.id_bodega
         AND id_producto = OLD.id_producto
         AND (lote <=> OLD.lote)
         AND (fecha_vencimiento <=> OLD.fecha_vencimiento);
      IF OLD.delta_cantidad > 0 THEN
        UPDATE stock_actual sa
           SET sa.fecha_entrada_lote = (
             SELECT MIN(DATE(k.creado_en)) FROM kardex k
              WHERE k.id_bodega = OLD.id_bodega
                AND k.id_producto = OLD.id_producto
                AND (k.lote <=> OLD.lote)
                AND (k.fecha_vencimiento <=> OLD.fecha_vencimiento)
                AND k.delta_cantidad > 0
           )
         WHERE sa.id_bodega = OLD.id_bodega
           AND sa.id_producto = OLD.id_producto
           AND (sa.lote <=> OLD.lote)
           AND (sa.fecha_vencimiento <=> OLD.fecha_vencimiento);
      END IF;
      DELETE FROM stock_actual
       WHERE id_bodega = OLD.id_bodega
         AND id_producto = OLD.id_producto
         AND (lote <=> OLD.lote)
         AND (fecha_vencimiento <=> OLD.fecha_vencimiento)
         AND stock = 0
         AND NOT EXISTS (
           SELECT 1 FROM kardex k
            WHERE k.id_bodega = OLD.id_bodega
              AND k.id_producto = OLD.id_producto
              AND (k.lote <=> OLD.lote)
              AND (k.fecha_vencimiento <=> OLD.fecha_vencimiento)
         );
    END
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_kardex_stock_au`);
  await pool.query(`
    CREATE TRIGGER trg_kardex_stock_au
    AFTER UPDATE ON kardex
    FOR EACH ROW
    BEGIN
      UPDATE stock_actual
         SET stock = stock - OLD.delta_cantidad
       WHERE id_bodega = OLD.id_bodega
         AND id_producto = OLD.id_producto
         AND (lote <=> OLD.lote)
         AND (fecha_vencimiento <=> OLD.fecha_vencimiento);
      IF OLD.delta_cantidad > 0 THEN
        UPDATE stock_actual sa
           SET sa.fecha_entrada_lote = (
             SELECT MIN(DATE(k.creado_en)) FROM kardex k
              WHERE k.id_bodega = OLD.id_bodega
                AND k.id_producto = OLD.id_producto
                AND (k.lote <=> OLD.lote)
                AND (k.fecha_vencimiento <=> OLD.fecha_vencimiento)
                AND k.delta_cantidad > 0
           )
         WHERE sa.id_bodega = OLD.id_bodega
           AND sa.id_producto = OLD.id_producto
           AND (sa.lote <=> OLD.lote)
           AND (sa.fecha_vencimiento <=> OLD.fecha_vencimiento);
      END IF;
      DELETE FROM stock_actual
       WHERE id_bodega = OLD.id_bodega
         AND id_producto = OLD.id_producto
         AND (lote <=> OLD.lote)
         AND (fecha_vencimiento <=> OLD.fecha_vencimiento)
         AND stock = 0
         AND NOT EXISTS (
           SELECT 1 FROM kardex k
            WHERE k.id_bodega = OLD.id_bodega
              AND k.id_producto = OLD.id_producto
              AND (k.lote <=> OLD.lote)
              AND (k.fecha_vencimiento <=> OLD.fecha_vencimiento)
         );
      INSERT INTO stock_actual (id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote)
      VALUES (NEW.id_bodega, NEW.id_producto, NEW.lote, NEW.fecha_vencimiento, NEW.delta_cantidad,
              IF(NEW.delta_cantidad > 0, DATE(NEW.creado_en), NULL))
      ON DUPLICATE KEY UPDATE
        stock = stock + NEW.delta_cantidad,
        fecha_entrada_lote = IF(NEW.delta_cantidad > 0,
                                LEAST(COALESCE(fecha_entrada_lote, DATE(NEW.creado_en)), DATE(NEW.creado_en)),
                                fecha_entrada_lote);
    END
  `);

  // Backfill solo si la tabla está vacía (idempotente entre reinicios). Se hace bajo
  // LOCK TABLES para que ninguna escritura de kardex quede fuera del agregado: con
  // los triggers ya activos, todo write es contabilizado, y el lock cierra la ventana
  // entre el snapshot y el cierre del INSERT...SELECT.
  const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM stock_actual`);
  if (Number(c) === 0 || forceBackfill) {
    const conn = await pool.getConnection();
    try {
      await conn.query(`LOCK TABLES kardex WRITE, stock_actual WRITE`);
      await conn.query(`DELETE FROM stock_actual`);
      await conn.query(`
        INSERT INTO stock_actual (id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote)
        SELECT k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento, SUM(k.delta_cantidad),
               MIN(IF(k.delta_cantidad > 0, DATE(k.creado_en), NULL))
        FROM kardex k
        GROUP BY k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento
      `);
    } finally {
      await conn.query(`UNLOCK TABLES`).catch(() => {});
      conn.release();
    }
  } else {
    console.warn(
      `stock_actual ya tiene ${c} filas: se omite el backfill. ` +
      `Si los datos están incorrectos, corre: node test_reconcile_stock.cjs --fix`
    );
  }

  // Vistas: ahora leen de stock_actual en lugar de agregar kardex. v_stock_disponible
  // ya lee de v_stock_por_lote, así que hereda el cambio automáticamente.
  await pool.query(`
    CREATE OR REPLACE VIEW v_stock_por_lote AS
    SELECT id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote
    FROM stock_actual
  `);
  await pool.query(`
    CREATE OR REPLACE VIEW v_stock_disponible AS
    SELECT s.*,
      CASE
        WHEN s.fecha_vencimiento IS NULL THEN 1
        WHEN s.fecha_vencimiento >= CURDATE() THEN 1
        ELSE 0
      END AS no_vencido
    FROM v_stock_por_lote s
    WHERE s.stock > 0
  `);
  await pool.query(`
    CREATE OR REPLACE VIEW v_stock_resumen AS
    SELECT id_bodega, id_producto, SUM(stock) AS stock
    FROM stock_actual
    GROUP BY id_bodega, id_producto
  `);
}

// ── Healthcheck en runtime: desalineación de stock_actual ───────────────────
// Misma lógica de comparación que test_reconcile_stock.cjs, pero corriendo en
// el servidor de forma fire-and-forget (nunca bloquea ni tira el proceso). Si
// detecta desviaciones (p.ej. un INSERT manual en kardex, un trigger roto o un
// restore de backup viejo), loguea el detalle, actualiza opsMetrics.stock_actual
// y emite un evento socket "stock:desync" para que los clientes conectados
// puedan alertar. NO reconstruye la tabla: eso queda para `npm run deploy:stock`.
const STOCK_HC_KEY_EXPR =
  "CONCAT(IF(lote IS NULL,'N','Y'),COALESCE(lote,'')) AS lote_key, " +
  "IF(fecha_vencimiento IS NULL, '1000-01-01', DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d')) AS fecha_key";
const STOCK_HC_FEL_EXPR = "COALESCE(DATE_FORMAT(fecha_entrada_lote, '%Y-%m-%d'), '')";
// Agregado esperado desde kardex (misma expresión que test_reconcile_stock.cjs).
const STOCK_HC_EXPECTED_SQL = `
  SELECT id_bodega, id_producto, ${STOCK_HC_KEY_EXPR}, SUM(delta_cantidad) AS stock,
         COALESCE(DATE_FORMAT(MIN(IF(delta_cantidad > 0, DATE(creado_en), NULL)), '%Y-%m-%d'), '') AS fel
  FROM kardex
  GROUP BY id_bodega, id_producto, lote_key, fecha_key`;
// Snapshot actual de stock_actual (misma forma que en el reconcile).
const STOCK_HC_ACTUAL_SQL = `
  SELECT id_bodega, id_producto, lote_key,
         DATE_FORMAT(fecha_key, '%Y-%m-%d') AS fecha_key, stock, ${STOCK_HC_FEL_EXPR} AS fel
  FROM stock_actual`;

// Diff 100% SQL-side: LEFT JOIN en ambas direcciones devuelve SOLO las claves
// divergentes (esperado sin actual, actual sin esperado, o stock/fel distintos).
// En estado alineado devuelve 0 filas: el agregado de kardex no viaja a JS.
const STOCK_HC_DIFF_SQL = `
  SELECT e.id_bodega, e.id_producto, e.lote_key, e.fecha_key,
         e.stock AS exp_stock, e.fel AS exp_fel,
         a.stock AS act_stock, a.fel AS act_fel
  FROM (${STOCK_HC_EXPECTED_SQL}) e
  LEFT JOIN (${STOCK_HC_ACTUAL_SQL}) a
    ON a.id_bodega = e.id_bodega AND a.id_producto = e.id_producto
   AND a.lote_key = e.lote_key AND a.fecha_key = e.fecha_key
  WHERE a.id_bodega IS NULL
     OR ABS(COALESCE(a.stock, 0) - e.stock) > 1e-9
     OR a.fel <> e.fel
  UNION ALL
  SELECT a2.id_bodega, a2.id_producto, a2.lote_key, a2.fecha_key,
         CAST(NULL AS DECIMAL(18,3)) AS exp_stock, CAST(NULL AS CHAR) AS exp_fel,
         a2.stock AS act_stock, a2.fel AS act_fel
  FROM (${STOCK_HC_ACTUAL_SQL}) a2
  LEFT JOIN (${STOCK_HC_EXPECTED_SQL}) e2
    ON e2.id_bodega = a2.id_bodega AND e2.id_producto = a2.id_producto
   AND e2.lote_key = a2.lote_key AND e2.fecha_key = a2.fecha_key
  WHERE e2.id_bodega IS NULL`;

async function checkStockActualConsistency() {
  const t0 = Date.now();
  // Medición única de duración, compartida por logs e historial: se asigna una
  // sola vez por corrida (en el try tras las queries, y en el catch hasta el fallo)
  // y tanto pushHistory como los console.* la leen. Evita que el historial use un
  // Date.now() distinto al de los logs.
  let ms = 0;
  // Registra cada corrida en opsMetrics.stock_actual.history (últimas
  // STOCK_HC_HISTORY_LIMIT) para detectar patrones de desalineación intermitente
  // en /api/ops/metrics. Definida a nivel de función para que el catch la reúse.
  const pushHistory = (status, entry = {}) => {
    opsMetrics.stock_actual.history.push({
      ...entry, // primero: permite sobrescribir campos computados por el caller si hiciera falta
      at: new Date().toISOString(),
      status,
      mismatches: opsMetrics.stock_actual.mismatches,
      expected_groups: opsMetrics.stock_actual.expected_groups,
      actual_groups: opsMetrics.stock_actual.actual_groups,
      ms,
    });
    if (opsMetrics.stock_actual.history.length > STOCK_HC_HISTORY_LIMIT) {
      opsMetrics.stock_actual.history.splice(0, opsMetrics.stock_actual.history.length - STOCK_HC_HISTORY_LIMIT);
    }
  };
  try {
    // Espera a que Fase 4 termine de arrancar (tabla + triggers + backfill) antes
    // de comparar: evita falsos desync por leer una tabla aún en backfill.
    await stockActualReadyPromise;

    // Conteos livianos (escalares, sin traer filas a JS) + diff de claves
    // divergentes, en paralelo. El agregado de kardex solo viaja en el diff
    // cuando hay desviaciones (0 filas si todo está alineado).
    const [countResults, diffResults] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM stock_actual) AS actual_groups,
          (SELECT COUNT(*) FROM (
             SELECT 1 FROM kardex
             GROUP BY id_bodega, id_producto, lote, fecha_vencimiento
           ) e) AS expected_groups
      `),
      pool.query(STOCK_HC_DIFF_SQL),
    ]);
    // pool.query() resuelve a [rows, fields]: extraemos el array de filas real.
    const [countRows] = countResults;
    const [diffRows] = diffResults;
    const [counts] = countRows; // countRows es el array de filas; su única fila es el objeto de conteos
    const actual_groups = Number(counts?.actual_groups || 0);
    const expected_groups = Number(counts?.expected_groups || 0);

    const mismatches = diffRows.map((r) => {
      const key = `${r.id_bodega}|${r.id_producto}|${r.lote_key}|${r.fecha_key}`;
      const expected =
        r.exp_stock == null ? "AUSENTE" : { stock: Number(r.exp_stock), fel: r.exp_fel };
      const actual =
        r.act_stock == null ? "AUSENTE" : { stock: Number(r.act_stock), fel: r.act_fel };
      return { key, expected, actual };
    });

    ms = Date.now() - t0;
    opsMetrics.stock_actual.last_check_at = new Date().toISOString();
    opsMetrics.stock_actual.expected_groups = expected_groups;
    opsMetrics.stock_actual.actual_groups = actual_groups;
    opsMetrics.stock_actual.mismatches = mismatches.length;
    opsMetrics.stock_actual.last_error = null;

    if (mismatches.length > 0) {
      opsMetrics.stock_actual.status = "desync";
      pushHistory("desync");
      console.warn(
        `[stock_actual] ⚠️ DESALINEACIÓN detectada: ${mismatches.length} desviación(es) ` +
        `(esperados=${expected_groups}, reales=${actual_groups}) en ${ms}ms. Reparar con: npm run deploy:stock`
      );
      for (const m of mismatches.slice(0, STOCK_HC_MAX_DETAILS)) {
        console.warn(`  - ${m.key}: esperado=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
      }
      io.emit("stock:desync", {
        at: opsMetrics.stock_actual.last_check_at,
        mismatches: mismatches.length,
        sample: mismatches.slice(0, STOCK_HC_MAX_DETAILS),
      });
    } else {
      opsMetrics.stock_actual.status = "ok";
      pushHistory("ok");
      console.log(`[stock_actual] ✅ alineada (${expected_groups} grupos) en ${ms}ms`);
    }
  } catch (e) {
    ms = Date.now() - t0; // misma medición única: tiempo transcurrido hasta el fallo
    opsMetrics.stock_actual.status = "error";
    opsMetrics.stock_actual.last_check_at = new Date().toISOString();
    opsMetrics.stock_actual.last_error = { code: e?.code || null, message: String(e?.message || e) };
    // Reúsa pushHistory: la corrida fallida se registra con los últimos conteos
    // conocidos y el mensaje de error.
    opsMetrics.stock_actual.mismatches = 0;
    pushHistory("error", { error: String(e?.message || e) });
    console.error("[stock_actual] Healthcheck falló:", e?.code || "", e?.message || e);
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

async function ensureMovimientoAnuladoColumns() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='movimiento_encabezado'
       AND COLUMN_NAME='anulado_por'`
  );
  const exists = Number(rows?.[0]?.c || 0) > 0;
  if (!exists) {
    await pool.query(
      `ALTER TABLE movimiento_encabezado
       ADD COLUMN anulado_por INT NULL`
    );
    await pool.query(
      `ALTER TABLE movimiento_encabezado
       ADD COLUMN anulado_en DATETIME NULL`
    );
  } else {
    const [rowsEn] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE()
         AND TABLE_NAME='movimiento_encabezado'
         AND COLUMN_NAME='anulado_en'`
    );
    if (Number(rowsEn?.[0]?.c || 0) <= 0) {
      await pool.query(
        `ALTER TABLE movimiento_encabezado
         ADD COLUMN anulado_en DATETIME NULL`
      );
    }
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

// Extrae cookies del header Cookie sin dependencias externas.
function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const qt = req.query && req.query.token ? String(req.query.token) : "";
  // Doble canal: header Authorization (compat), query ?token= (prints/legacy) y
  // cookie HttpOnly "token" (nuevo, no legible por JS).
  const cookieToken = parseCookies(req.headers.cookie || "").token || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (qt || cookieToken || null);
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
    // Cookie HttpOnly enviada por socket.io-client (withCredentials) en el handshake.
    const cookieToken = parseCookies(socket.handshake?.headers?.cookie || "").token || "";
    const token = authToken || queryToken || cookieToken;
    if (!token) return next(new Error("No token"));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error("Token invalido"));
  }
});

io.on("connection", (socket) => {
  const idUser = Number(socket.user?.id_user || 0);
  const idWarehouse = Number(socket.user?.id_warehouse || 0);
  // Room por usuario: para empujar cambios de permisos/estado en tiempo real.
  if (idUser > 0) {
    socket.join(`user:${idUser}`);
  }
  if (idWarehouse > 0) {
    socket.join(`warehouse:${idWarehouse}`);
  }
});

// Avisa al socket del usuario afectado que sus permisos o su cuenta cambiaron,
// para que el cliente recargue su snapshot y el Sidebar se reajuste en vivo.
function emitPermisosChanged(idUsuario, kind = "permisos") {
  const id = Number(idUsuario || 0);
  if (id > 0) {
    io.to(`user:${id}`).emit("permisos:changed", { id_usuario: id, kind });
  }
}

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

  // Push notification a la bodega que debe despachar
  const pushWh = fromWh || reqWh;
  if (pushWh > 0 && String(payload?.action || '').toLowerCase() === 'created') {
    const pushPayload = {
      type: 'pedido',
      title: '🚚 Nuevo pedido para despachar',
      body: `Pedido #${envelope.id_pedido} recibido (${envelope.status})`,
      tag: `pedido-${envelope.id_pedido}`,
      url: '/pedidos-despachar',
    };
    sendPushToWarehouse(pushWh, pushPayload).catch(() => {});
  }
}

async function pickLotsFEFO(conn, id_bodega, id_producto, qtyNeeded, opts = {}) {
  const allowExpired = opts.allowExpired !== false;
  const whereVenc = allowExpired ? "" : "AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())";
  // Serializa los consumos de stock por producto: evita race conditions entre
  // transacciones concurrentes que leerian el mismo snapshot de la vista.
  await conn.query(`SELECT id_producto FROM productos WHERE id_producto=:id_producto FOR UPDATE`, { id_producto });
  const [lots] = await conn.query(
    `
    SELECT lote, fecha_vencimiento, stock
    FROM v_stock_disponible
    WHERE id_bodega=:id_bodega
      AND id_producto=:id_producto
      ${whereVenc}
    ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC
    `,
    { id_bodega, id_producto }
  );
  const picks = [];
  let remaining = Number(qtyNeeded);
  for (const l of lots) {
    if (remaining <= 1e-9) break;
    const lotStock = Number(l.stock);
    if (!(lotStock > 0)) continue; // evita picks negativos/cero que corrompen el kardex
    const take = Math.min(remaining, lotStock);
    picks.push({ lote: l.lote, fecha_vencimiento: l.fecha_vencimiento, qty: take });
    remaining -= take;
  }
  if (remaining <= 1e-9) remaining = 0;

  if (!picks.length && allowExpired) {
    const [[r]] = await conn.query(
      `SELECT stock FROM v_stock_resumen WHERE id_bodega=:id_bodega AND id_producto=:id_producto LIMIT 1`,
      { id_bodega, id_producto }
    );
    const stock = Number(r?.stock || 0);
    if (stock > 0) {
      const take = Math.min(stock, Number(qtyNeeded));
      return { picks: [{ lote: null, fecha_vencimiento: null, qty: take }], remaining: Number(qtyNeeded) - take };
    }
  }

  return { picks, remaining };
}

async function getLastUnitCost(conn, id_bodega, id_producto, lote) {
  const [rows] = await conn.query(
    `SELECT costo_unitario
     FROM kardex
     WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote <=> :lote AND delta_cantidad > 0
     ORDER BY creado_en DESC
     LIMIT 1`,
    { id_bodega, id_producto, lote }
  );
  return rows[0]?.costo_unitario ?? 0;
}

async function recomputePedidoEstado(conn, id_pedido, opts = {}) {
  const actorUserId = Number(opts?.actorUserId || 0) || null;
  const justificacion = String(opts?.justificacion || "").trim();
  const [aggRows] = await conn.query(
    `SELECT
       COUNT(*) AS total_lineas,
       SUM(CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 1 ELSE 0 END) AS lineas_anuladas,
       SUM(CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 1 ELSE 0 END) AS lineas_completas_qty,
       SUM(CASE WHEN cantidad_surtida > 0 AND cantidad_surtida < cantidad_solicitada THEN 1 ELSE 0 END) AS lineas_parciales_qty,
       SUM(cantidad_solicitada) AS total_solicitado,
       SUM(cantidad_surtida) AS total_surtido
     FROM pedido_detalle
     WHERE id_pedido=:id_pedido`,
    { id_pedido }
  );
  const agg = aggRows?.[0] || {};
  const totalLineas = Number(agg.total_lineas || 0);
  const lineasAnuladas = Number(agg.lineas_anuladas || 0);
  const lineasCompletasQty = Number(agg.lineas_completas_qty || 0);
  const lineasParcialesQty = Number(agg.lineas_parciales_qty || 0);
  const totalSurtido = Number(agg.total_surtido || 0);
  const hasAnyJustified = lineasAnuladas > 0 || lineasParcialesQty > 0;
  const lineasResueltas = lineasAnuladas + lineasCompletasQty;

  let estado = "PENDIENTE";
  if (totalLineas > 0 && lineasResueltas >= totalLineas) {
    estado = hasAnyJustified ? "COMPLETADO_JUSTIFICADO" : "COMPLETADO";
  } else if (totalSurtido > 0 || lineasAnuladas > 0) {
    estado = "PARCIAL";
  }

  if (estado === "COMPLETADO") {
    await conn.query(
      `UPDATE pedido_encabezado
       SET estado=:estado,
           justificacion_despacho=NULL,
           aprobado_por=COALESCE(:aprobado_por, aprobado_por),
           aprobado_en=NOW()
       WHERE id_pedido=:id_pedido`,
      { estado, aprobado_por: actorUserId, id_pedido }
    );
    return { estado, justificacion_despacho: null };
  }

  if (justificacion && (estado === "PARCIAL" || estado === "COMPLETADO_JUSTIFICADO")) {
    const [[head]] = await conn.query(
      `SELECT justificacion_despacho
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       LIMIT 1`,
      { id_pedido }
    );
    const current = String(head?.justificacion_despacho || "").trim();
    const finalJust =
      !current ? justificacion : current.toLowerCase() === justificacion.toLowerCase() ? current : `${current} | ${justificacion}`;
    await conn.query(
      `UPDATE pedido_encabezado
       SET estado=:estado,
           justificacion_despacho=:justificacion,
           aprobado_por=COALESCE(:aprobado_por, aprobado_por),
           aprobado_en=NOW()
       WHERE id_pedido=:id_pedido`,
      {
        estado,
        justificacion: finalJust,
        aprobado_por: actorUserId,
        id_pedido,
      }
    );
    return { estado, justificacion_despacho: finalJust };
  }

  await conn.query(
    `UPDATE pedido_encabezado
     SET estado=:estado,
         aprobado_por=COALESCE(:aprobado_por, aprobado_por),
         aprobado_en=NOW()
     WHERE id_pedido=:id_pedido`,
    { estado, aprobado_por: actorUserId, id_pedido }
  );
  const [[head]] = await conn.query(
    `SELECT justificacion_despacho
     FROM pedido_encabezado
     WHERE id_pedido=:id_pedido
     LIMIT 1`,
    { id_pedido }
  );
  return { estado, justificacion_despacho: head?.justificacion_despacho || null };
}

function emitStockChanged(idBodega, payload = {}) {
  const idWh = Number(idBodega || 0);
  if (idWh > 0) {
    io.to(`warehouse:${idWh}`).emit("stock:changed", {
      action: payload.action || "updated",
      id_bodega: idWh,
      nombre_bodega: payload.nombre_bodega || null,
      id_movimiento: Number(payload.id_movimiento || 0),
      at: new Date().toISOString(),
    });

    // Push notification por cambios de stock
    const action = String(payload.action || '').toLowerCase();
    if (action === 'entrada' || action === 'salida' || action === 'ajuste') {
      const emoji = action === 'entrada' ? '📥' : action === 'salida' ? '📤' : '⚖️';
      const pushPayload = {
        type: 'stock',
        title: `${emoji} ${action.charAt(0).toUpperCase() + action.slice(1)} registrada`,
        body: payload.nombre_bodega
          ? `Movimiento en ${payload.nombre_bodega}`
          : `Movimiento #${payload.id_movimiento || ''} registrado`,
        tag: `stock-${payload.id_movimiento || Date.now()}`,
        url: action === 'entrada' ? '/entradas' : action === 'salida' ? '/salidas' : '/ajustes',
      };
      sendPushToWarehouse(idWh, pushPayload).catch(() => {});
    }
  }
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

// Búsqueda por prefijo (solo al inicio de la palabra) para product picker
function buildTokenizedPrefixFilter(rawInput, columns = [], paramPrefix = "qtk") {
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
    params[key] = `${token}%`;
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
  // ── Principal (Sidebar: dashboard) ──
  { key: "section.view.home", label: "Ver modulo Inicio", group: "Principal" },
  { key: "section.view.ajustes", label: "Ver modulo Ajustes", group: "Principal" },

  // ── Movimientos ──
  { key: "section.view.entradas", label: "Ver modulo Entradas", group: "Movimientos" },
  { key: "section.view.salidas", label: "Ver modulo Salidas", group: "Movimientos" },
  { key: "section.view.pedidos", label: "Ver modulo Realizar pedidos", group: "Movimientos" },
  { key: "section.view.pedidos-despachar", label: "Ver modulo Pedidos x Despachar", group: "Movimientos" },
  { key: "section.view.transferencias", label: "Ver modulo Transferencias", group: "Movimientos", default_active: 0 },

  // ── Inventario ──
  { key: "section.view.productos", label: "Ver modulo Productos", group: "Inventario" },
  { key: "section.view.existencias", label: "Ver modulo Existencias", group: "Inventario", default_active: 0 },
  { key: "section.view.alertas", label: "Ver modulo Alertas", group: "Inventario", default_active: 0 },
  { key: "section.view.conteo-ciclico", label: "Ver modulo Conteo Ciclico", group: "Inventario" },

  // ── Reportes ──
  { key: "section.view.kardex", label: "Ver modulo Kardex por producto", group: "Reportes", default_active: 0 },
  { key: "section.view.kardex-general", label: "Ver modulo Kardex general", group: "Reportes", default_active: 0 },
  { key: "section.view.tendencia-producto", label: "Ver modulo Tendencia Producto", group: "Reportes", default_active: 0 },
  { key: "section.view.cuadre-caja", label: "Ver modulo Cuadre de Caja", group: "Reportes" },
  { key: "section.view.r-existencias", label: "Ver Reporte Existencias", group: "Reportes" },
  { key: "section.view.r-corte-diario", label: "Ver Reporte Corte Diario", group: "Reportes" },
  { key: "section.view.r-entradas", label: "Ver Reporte Entradas", group: "Reportes" },
  { key: "section.view.r-salidas", label: "Ver Reporte Salidas", group: "Reportes" },
  { key: "section.view.r-pedidos", label: "Ver Reporte Pedidos", group: "Reportes" },
  { key: "section.view.r-transferencias", label: "Ver Reporte Kardex", group: "Reportes" },
  { key: "section.view.r-auditoria-sensibles", label: "Ver Reporte Auditoria sensible", group: "Reportes" },

  // ── Administración ──
  { key: "section.view.categorias", label: "Ver modulo Categorias", group: "Administración" },
  { key: "section.view.subcategorias", label: "Ver modulo Subcategorias", group: "Administración" },
  { key: "section.view.motivos-movimiento", label: "Ver modulo Motivo movimiento", group: "Administración" },
  { key: "section.view.motivos", label: "Ver modulo Motivos", group: "Administración", default_active: 0 },
  { key: "section.view.proveedores", label: "Ver modulo Proveedores", group: "Administración" },
  { key: "section.view.medidas", label: "Ver modulo Medidas", group: "Administración", default_active: 0 },
  { key: "section.view.usuarios", label: "Ver modulo Usuarios", group: "Administración" },
  { key: "section.view.bodegas", label: "Ver modulo Bodegas", group: "Administración" },
  { key: "section.view.reglas-subcategorias", label: "Ver modulo Reglas subcategorias", group: "Administración" },
  { key: "section.view.limites", label: "Ver modulo Minimos/Maximos", group: "Administración" },

  // ── Acciones (no son secciones del sidebar; capabilities) ──
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

  // ── Guarda: nunca dejar el producto con 0 bodegas visibles=1 ──
  // Si lo permitimos, queda en estado "Oculto en todas" y no se puede
  // despachar desde ningún lado (rompe el "opt-out" sano del sistema).
  if (!nextVisible) {
    const visiblesActuales = currentRows.filter((r) => Number(r.visible) === 1);
    const targetEsLaUnicaVisible =
      visiblesActuales.length === 1 &&
      Number(visiblesActuales[0].id_bodega) === id_bodega;
    if (targetEsLaUnicaVisible) {
      const err = new Error(
        "No se puede dejar el producto sin bodegas visibles. Mantene al menos una con visible=1."
      );
      err.status = 400;
      throw err;
    }
    // Sin reglas previas: si ocultamos y solo hay 1 bodega activa, el
    // resultado seria 0 visibles. Tambien lo bloqueamos.
    if (!currentRows.length) {
      const activeWarehouseIds = await getActiveWarehouseIds(conn);
      if (activeWarehouseIds.length <= 1) {
        const err = new Error(
          "No se puede ocultar el producto: el sistema solo tiene una bodega activa."
        );
        err.status = 400;
        throw err;
      }
    }
  }

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

async function ensurePushSubscriptionsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id_suscripcion INT NOT NULL AUTO_INCREMENT,
      id_usuario INT NOT NULL,
      endpoint VARCHAR(500) NOT NULL,
      auth VARCHAR(100) NOT NULL,
      p256dh VARCHAR(200) NOT NULL,
      id_bodega INT NULL,
      user_agent VARCHAR(255) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_suscripcion),
      KEY idx_push_user (id_usuario),
      KEY idx_push_bodega (id_bodega),
      CONSTRAINT fk_push_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
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


// ── Cache de permisos en memoria (30s TTL) ──
const permisosCache = new Map();
const PERMISOS_CACHE_TTL_MS = 30_000;

function clearPermisosCache(idUsuario) {
  if (idUsuario != null) {
    permisosCache.delete(Number(idUsuario));
  } else {
    permisosCache.clear();
  }
}

function getCachedPermisos(idUsuario) {
  const id = Number(idUsuario || 0);
  if (!id) return null;
  const entry = permisosCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > PERMISOS_CACHE_TTL_MS) {
    permisosCache.delete(id);
    return null;
  }
  return entry.data;
}

function setCachedPermisos(idUsuario, data) {
  const id = Number(idUsuario || 0);
  if (id) permisosCache.set(id, { ts: Date.now(), data });
}

function permissionDefaults() {
  const map = {};
  PERM_CATALOG.forEach((p) => {
    map[p.key] = Number(typeof p.default_active === "number" ? p.default_active : 1) ? 1 : 0;
  });
  return map;
}

async function getUserPermissionsMap(idUsuario) {
  const cached = getCachedPermisos(idUsuario);
  if (cached) return cached;
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
  setCachedPermisos(idUsuario, base);
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
ensureMovimientoAnuladoColumns().catch((e) => {
  console.error("No se pudo crear columnas anulado_por/anulado_en en movimiento_encabezado:", e);
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
ensurePushSubscriptionsTable().catch((e) => {
  console.error("No se pudo crear tabla push_subscriptions:", e);
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
ensureRecepcionConfirmacionSchema().catch((e) => {
  console.error("No se pudo crear esquema de confirmacion de recepcion:", e);
});
ensurePerformanceIndexes().catch((e) => {
  console.error("No se pudieron crear índices de rendimiento:", e);
});
// Promesa del arranque de Fase 4: el healthcheck en runtime la espera antes de
// comparar, para no reportar un falso desync si el backfill (fire-and-forget bajo
// LOCK TABLES) aún está en curso cuando dispara el primer check.
const stockActualReadyPromise = ensureStockActualTable().catch((e) => {
  console.error("No se pudo crear/verificar la tabla materializada stock_actual:", e);
});

async function ensureConteoCiclicoTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS conteo_ciclico (
      id_conteo INT NOT NULL AUTO_INCREMENT,
      id_bodega INT NOT NULL,
      fecha_conteo DATE NOT NULL,
      estado ENUM('BORRADOR','EN_PROGRESO','COMPLETADO','AJUSTADO') NOT NULL DEFAULT 'BORRADOR',
      observaciones VARCHAR(255) NULL,
      creado_por INT NOT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_conteo),
      KEY idx_cc_bodega (id_bodega),
      KEY idx_cc_estado (estado),
      KEY idx_cc_fecha (fecha_conteo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS conteo_ciclico_detalle (
      id_detalle INT NOT NULL AUTO_INCREMENT,
      id_conteo INT NOT NULL,
      id_producto INT NOT NULL,
      nombre_producto VARCHAR(180) NULL,
      sku VARCHAR(80) NULL,
      lote VARCHAR(80) NULL,
      cantidad_sistema DECIMAL(18,3) NOT NULL DEFAULT 0,
      cantidad_conteo DECIMAL(18,3) NULL,
      diferencia DECIMAL(18,3) NULL,
      comentario VARCHAR(255) NULL,
      PRIMARY KEY (id_detalle),
      KEY idx_ccd_conteo (id_conteo),
      KEY idx_ccd_producto (id_producto),
      CONSTRAINT fk_ccd_conteo FOREIGN KEY (id_conteo) REFERENCES conteo_ciclico(id_conteo) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

ensureConteoCiclicoTables().catch((e) => {
  console.error("No se pudo crear tablas de conteo ciclico:", e);
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

// Fecha local en formato YYYY-MM-DD (consistente con CURDATE() de MySQL).
// Las columnas DATE llegan como objetos Date; usar toISOString mezclaria UTC.
function localYmd(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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
      status: 400,
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
      status: 400,
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

/**
 * Aplica líneas de "conteo final" como salidas automáticas (movimientos AJUSTE
 * con FEFO picking). Reutilizado por:
 *   - POST /api/salidas/conteo-final  (uso independiente, sin cierre)
 *   - POST /api/cierre-dia            (cuando la bodega tiene permite_salida_conteo_final
 *                                       y el cliente envía conteosFinales en el body)
 *
 * IMPORTANTE:
 *  - El helper NO maneja la transacción: el caller (endpoint) ya debe tener
 *    `conn` dentro de un `beginTransaction()` y hacer commit/rollback fuera.
 *  - El helper NO llama a verifySensitiveApproval: el caller debe haberlo
 *    validado ANTES y pasar el resultado en `approval` (o construir un approval
 *    sintético si no se requiere PIN, p.ej. para procesos automáticos).
 *  - Las líneas con `existencia_final == existencia_actual` (o mayores) se ignoran.
 *  - Líneas con `existencia_final > existencia_actual` se RECHAZAN con error
 *    (no se permite generar entrada por sobrante en este flujo).
 *
 * @param {object} conn          - conexión mysql2 con transacción iniciada
 * @param {object} opts
 * @param {number} opts.id_bodega
 * @param {Array<{id_producto:number, existencia_final:number, observacion_linea?:string}>} opts.lines
 * @param {object} opts.motivo   - fila de motivos_movimiento (tipo AJUSTE)
 * @param {object} opts.user     - req.user (id_user)
 * @param {object} opts.approval - resultado de verifySensitiveApproval (o sintético)
 * @param {string} [opts.observaciones]
 * @param {string} [opts.fecha_cierre] - YYYY-MM-DD del día que se está cerrando. Si se omite, usa hoy.
 *                                       Se usa para backdattar creado_en del AJUSTE y del kardex,
 *                                       de modo que el conteo final aparezca en el cierre del día
 *                                       correspondiente (no del día en que se ejecuta).
 * @returns {Promise<{id_movimiento:number, appliedLines:number, affectedProducts:number, totalSalida:number}>}
 */
async function applyConteoFinalLines(conn, { id_bodega, lines, motivo, user, approval, observaciones, fecha_cierre }) {
  if (!Array.isArray(lines) || !lines.length) {
    return { id_movimiento: 0, appliedLines: 0, affectedProducts: 0, totalSalida: 0 };
  }
  if (!motivo || !motivo.id_motivo) {
    throw new Error("Motivo AJUSTE no proporcionado para conteo final");
  }
  if (!id_bodega) {
    throw new Error("id_bodega requerido para conteo final");
  }

  // Backdattamos al día que se está cerrando (no a hoy) para que las salidas
  // del conteo final aparezcan reflejadas en el cierre_dia del día correcto.
  // Hora de cierre: 23:59:59 del día seleccionado.
  const fechaCierreNorm = String(fecha_cierre || '').trim();
  const cierreTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(fechaCierreNorm)
    ? `${fechaCierreNorm} 23:59:59`
    : 'NOW()';

  const obsBase = String(observaciones || "").trim();
  const [mhRes] = await conn.query(
    `INSERT INTO movimiento_encabezado
     (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, creado_en, confirmado_en, estado)
     VALUES ('AJUSTE', :id_motivo, :id_bodega_origen, NULL, :observaciones, :creado_por, :creado_en, :confirmado_en, 'CONFIRMADO')`,
    {
      id_motivo: Number(motivo.id_motivo || 0),
      id_bodega_origen: id_bodega,
      observaciones: obsBase || `Salida automatica por conteo final de bodega #${id_bodega}`,
      creado_por: Number(user?.id_user || 0),
      creado_en: cierreTimestamp,
      confirmado_en: cierreTimestamp,
    }
  );
  const id_movimiento = Number(mhRes.insertId || 0);

  let appliedLines = 0;
  let affectedProducts = 0;
  let totalSalida = 0;

  for (const ln of lines) {
    const id_producto = Number(ln?.id_producto || 0);
    if (!id_producto) continue;
    if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega))) {
      throw new Error(`El producto #${id_producto} no esta habilitado para la bodega seleccionada`);
    }

    const existenciaFinal = Number(ln?.existencia_final);
    if (!Number.isFinite(existenciaFinal) || existenciaFinal < 0) {
      throw new Error(`Existencia final invalida para producto #${id_producto}`);
    }

    const [[stockRow]] = await conn.query(
      `SELECT COALESCE(stock, 0) AS stock
       FROM v_stock_resumen
       WHERE id_bodega=:id_bodega
         AND id_producto=:id_producto
       LIMIT 1`,
      { id_bodega, id_producto }
    );
    const existenciaActual = Number(stockRow?.stock || 0);
    if (existenciaFinal > existenciaActual) {
      throw new Error(
        `La existencia final no puede ser mayor a la existencia actual para producto #${id_producto}`
      );
    }

    const qtyRequested = existenciaActual - existenciaFinal;
    if (qtyRequested <= 0) continue;

    const { picks, remaining } = await pickLotsFEFO(conn, id_bodega, id_producto, qtyRequested);
    if (!picks.length || remaining > 0) {
      throw new Error(`Stock insuficiente para producto #${id_producto}`);
    }

    const notePrefix = `Conteo final. Sistema: ${existenciaActual}. Final: ${existenciaFinal}. Salida: ${qtyRequested}.`;
    const extraNote = String(ln?.observacion_linea || "").trim();
    for (const p of picks) {
      const costo_unitario = await getLastUnitCost(conn, id_bodega, id_producto, p.lote);
      const [d] = await conn.query(
        `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
         VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
        {
          id_movimiento,
          id_producto,
          lote: p.lote || null,
          fecha_vencimiento: p.fecha_vencimiento || null,
          cantidad: Number(p.qty || 0),
          costo_unitario,
          observacion_linea: extraNote ? `${notePrefix} ${extraNote}` : notePrefix,
        }
      );
      await conn.query(
        `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario, creado_en)
         VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario, :creado_en)`,
        {
          id_movimiento,
          id_detalle: Number(d.insertId || 0),
          id_bodega,
          id_producto,
          lote: p.lote || null,
          fecha_vencimiento: p.fecha_vencimiento || null,
          delta_cantidad: -Number(p.qty || 0),
          costo_unitario,
          creado_en: cierreTimestamp,
        }
      );
      totalSalida += Number(p.qty || 0);
    }
    appliedLines += 1;
    affectedProducts += 1;
  }

  // Audit sensible (best-effort, no rompe la operación si falla)
  if (appliedLines > 0) {
    try {
      await writeSensitiveActionAudit({
        req: { user },
        action_key: "SALIDA_AJUSTE_MANUAL",
        action_label: "Salida por conteo final",
        approval,
        reference_type: "MOVIMIENTO",
        reference_id: id_movimiento,
        detail: {
          id_bodega,
          id_motivo: Number(motivo.id_motivo || 0),
          productos: affectedProducts,
          lineas: appliedLines,
          total_salida: totalSalida,
        },
      });
    } catch (auditErr) {
      console.error("No se pudo escribir auditoria de conteo final:", auditErr);
    }
  }

  return { id_movimiento, appliedLines, affectedProducts, totalSalida };
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
  // ── Validación secuencial: si hay días anteriores a fecha_cierre sin cerrar,
  //    rechazamos. Solo se permite cerrar el siguiente día pendiente en orden.
  const [[prev]] = await conn.query(
    `SELECT MAX(fecha_cierre) AS last_closed_date
     FROM cierre_dia
     WHERE id_bodega=:id_bodega`,
    { id_bodega }
  );
  const lastClosedDate = ymd(prev?.last_closed_date);
  // Calculamos qué día debería ser el siguiente a cerrar (lastClosedDate + 1)
  // y verificamos que fecha_cierre coincida o sea anterior a ese día.
  if (lastClosedDate) {
    const requiredNext = addDaysYmd(lastClosedDate, 1);
    if (fecha_cierre > requiredNext) {
      const err = new Error(
        `No se puede cerrar ${fecha_cierre} sin haber cerrado primero ${requiredNext}. Debes cerrar los días en orden secuencial.`
      );
      err.code = "PREVIOUS_DAY_PENDING";
      err.status = 409;
      err.required_close_date = requiredNext;
      err.last_closed_date = lastClosedDate;
      throw err;
    }
  }

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

  // total_dinero con subconsultas correlacionadas (preferido + fallback).
  // NOTA: se revirtió el refactor a ROW_NUMBER() porque el benchmark con datos
  // reales (test_bench_detalle.cjs) mostró que las ventanas eran MÁS LENTAS
  // (~50-60%) en este MariaDB 12.2 con el índice actual: el filesort por
  // partición sobre todo el kardex supera a los index lookups puntuales.
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
// Cierra la sesión: elimina la cookie HttpOnly en el servidor.
// No requiere auth (un token expirado también debe poder desloguear).
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Falta usuario o contrasena" });

    // Tabla/columnas en espanol -> alias a nombres usados por la app
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT
           u.id_usuario AS id_user,
           u.usuario AS username,
           u.nombre_completo AS full_name,
           u.contrasena_hash AS pass_hash,
           u.id_rol AS id_role,
           u.id_bodega AS id_warehouse,
           u.no_auto_logout AS no_auto_logout,
           u.activo AS active,
           ua.avatar_data AS avatar_url
         FROM usuarios u
         LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
         WHERE u.usuario=:username
         LIMIT 1`,
        { username }
      );
    } catch (e) {
      if (!isAvatarTableMissingError(e)) throw e;
      [rows] = await pool.query(
        `SELECT
           u.id_usuario AS id_user,
           u.usuario AS username,
           u.nombre_completo AS full_name,
           u.contrasena_hash AS pass_hash,
           u.id_rol AS id_role,
           u.id_bodega AS id_warehouse,
           u.no_auto_logout AS no_auto_logout,
           u.activo AS active,
           '' AS avatar_url
         FROM usuarios u
         WHERE u.usuario=:username
         LIMIT 1`,
        { username }
      );
    }
    const u = rows[0];
    if (!u || !u.active) return res.status(401).json({ error: "Usuario invalido o inactivo" });

    const ok = await bcrypt.compare(password, u.pass_hash || "");
    if (!ok) return res.status(401).json({ error: "Contrasena incorrecta" });

    const token = signToken(u);
    // Sesión en cookie HttpOnly (no legible por JS): protege el JWT contra XSS.
    // SameSite=Lax evita el envío cross-site (CSRF) en peticiones de navegación.
    res.cookie("token", token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      maxAge: 12 * 60 * 60 * 1000, // 12h, igual que el JWT
      path: "/",
    });
    const permisos = await getUserPermissionsMap(u.id_user);
    res.json({
      token,
      user: {
        id_user: u.id_user,
        username: u.username,
        full_name: u.full_name,
        id_role: u.id_role,
        id_warehouse: u.id_warehouse,
        no_auto_logout: Number(u.no_auto_logout || 0),
        avatar_url: u.avatar_url || "",
        permisos,
      },
    });
  } catch (e) {
    console.error("Error en /api/auth/login:", e);
    return res.status(500).json({ error: "Error interno en login" });
  }
});

app.get("/api/auth/users", async (req, res) => {
  try {
    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT u.usuario AS username,
                u.nombre_completo AS full_name,
                ua.avatar_data AS avatar_url
         FROM usuarios u
         LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
         WHERE u.activo=1
         ORDER BY u.nombre_completo ASC`
      );
    } catch (e) {
      if (!isAvatarTableMissingError(e)) throw e;
      [rows] = await pool.query(
        `SELECT u.usuario AS username,
                u.nombre_completo AS full_name,
                '' AS avatar_url
         FROM usuarios u
         WHERE u.activo=1
         ORDER BY u.nombre_completo ASC`
      );
    }
    res.json(
      (rows || []).map((u) => ({
        username: String(u.username || ""),
        full_name: String(u.full_name || ""),
        avatar_url: String(u.avatar_url || ""),
      }))
    );
  } catch (e) {
    return res.status(500).json({ error: "No se pudo cargar usuarios para login" });
  }
});

app.get("/api/session-policy", auth, async (req, res) => {
  try {
    const headerKey = normalizeDeviceKey(req.headers["x-device-key"]);
    const sharedKeys = getSharedDeviceKeys();
    const shared = !!headerKey && sharedKeys.includes(headerKey);
    const idUser = Number(req.user?.id_user || 0);
    let userNoAutoLogout = false;
    if (idUser) {
      const [[u]] = await pool.query(
        `SELECT no_auto_logout
         FROM usuarios
         WHERE id_usuario=:id_usuario
         LIMIT 1`,
        { id_usuario: idUser }
      );
      userNoAutoLogout = Number(u?.no_auto_logout || 0) === 1;
    }
    const noAutoLogout = shared || userNoAutoLogout;
    res.json({
      shared_device: shared,
      no_auto_logout: noAutoLogout,
      inactivity_logout_ms: noAutoLogout ? 0 : 30 * 60 * 1000,
      device_key: headerKey || null,
      by_user_policy: userNoAutoLogout,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

async function resolveStockScope(user) {
  const userId = Number(user?.id_user || 0);
  const id_role = Number(user?.id_role || 0);
  const id_bodega = Number(user?.id_warehouse || 0);
  if (!id_bodega) {
    return {
      id_usuario: userId,
      id_bodega: null,
      maneja_stock: false,
      is_principal: false,
      is_bodeguero: false,
      is_report_role: false,
      is_admin_role: false,
      can_view_existencias: false,
      can_all_bodegas: false,
      has_warehouse_restrictions: false,
      allowed_warehouse_ids: [],
    };
  }

  const [[roleRow]] = await pool.query(
    `SELECT nombre_rol
     FROM roles
     WHERE id_rol=:id_rol
     LIMIT 1`,
    { id_rol: id_role }
  );
  const roleName = String(roleRow?.nombre_rol || "")
    .trim()
    .toUpperCase();
  const is_bodeguero = roleName.includes("BODEGUERO");
  const is_report_role = roleName.includes("REPORTE");
  const is_admin_role = roleName.includes("ADMIN");
  const configuredWarehouseIds =
    is_report_role && !is_admin_role && userId > 0 ? await getUserWarehouseAccessIds(userId) : [];
  const allowedWarehouseIds = configuredWarehouseIds.length ? configuredWarehouseIds : [];
  const hasWarehouseRestrictions = allowedWarehouseIds.length > 0;

  const [[bodRow]] = await pool.query(
    `SELECT b.tipo_bodega,
            b.nombre_bodega,
            COALESCE(cb.maneja_stock, 0) AS maneja_stock
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE b.id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );
  const tipoBodega = String(bodRow?.tipo_bodega || "").trim().toUpperCase();
  const nombreBodega = String(bodRow?.nombre_bodega || "").trim().toUpperCase();
  const is_principal = tipoBodega === "PRINCIPAL" || nombreBodega === "BODEGA PRINCIPAL";
  const maneja_stock = Number(bodRow?.maneja_stock || 0) === 1;

  const can_view_existencias = is_bodeguero || is_report_role || is_admin_role;

  return {
    id_usuario: userId,
    id_bodega,
    maneja_stock,
    is_principal,
    is_bodeguero,
    is_report_role,
    is_admin_role,
    can_view_existencias,
    can_all_bodegas: is_report_role || is_admin_role,
    has_warehouse_restrictions: hasWarehouseRestrictions,
    allowed_warehouse_ids: allowedWarehouseIds,
  };
}

/* =========================
   PRODUCTOS (BUSQUEDA)
========================= */
app.get("/api/productos/search", auth, async (req, res) => {
  await ensureProductWarehouseVisibilityTable();
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const id_bodega = Number(req.query.warehouse || 0) || null;
  const qf = buildTokenizedLikeFilter(q, ["nombre_producto", "sku"], "psq");
  const visibilityClause = buildProductWarehouseVisibilityClause("p.id_producto", "id_bodega");
  const [rows] = await pool.query(
    `SELECT p.id_producto, p.nombre_producto, p.sku,
            p.id_categoria, c.nombre_categoria,
            p.id_medida, m.nombre_medida
     FROM productos p
     JOIN medidas m ON m.id_medida=p.id_medida
     JOIN categorias c ON c.id_categoria=p.id_categoria
     WHERE p.activo=1
       AND ${visibilityClause}
       AND ${qf.clause}
     ORDER BY p.nombre_producto ASC
     LIMIT 20`,
    { id_bodega, ...qf.params }
  );
  res.json(rows);
});

app.get("/api/productos", auth, async (req, res) => {
  var all = String(req.query.all || "") === "1";
  var qRaw = String(req.query.q || "").trim();
  var qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "pq");
  var defaultLimit = qRaw ? 5 : 50;
  var limit = Math.max(1, Math.min(5000, Number(req.query.limit || defaultLimit)));
  var page = Math.max(1, Number(req.query.page || 1));
  var offset = (page - 1) * limit;
  var id_categoria = Number(req.query.categoria || 0) || null;
  var id_subcategoria = Number(req.query.subcategoria || 0) || null;
  var id_medida = Number(req.query.medida || 0) || null;
  var id_bodega_usuario = Number(req.user?.id_warehouse || 0) || null;

  var countSql =
    "SELECT COUNT(*) AS total FROM productos p JOIN medidas m ON m.id_medida=p.id_medida JOIN categorias c ON c.id_categoria=p.id_categoria WHERE (:all=1 OR p.activo=1) AND "
    + qf.clause
    + " AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)"
    + " AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)"
    + " AND (:id_medida IS NULL OR p.id_medida=:id_medida)";

  var sql = "SELECT p.id_producto,"
    + " p.nombre_producto, p.sku,"
    + " p.id_medida, p.id_categoria, p.id_subcategoria, p.activo,"
    + " m.nombre_medida, c.nombre_categoria, s.nombre_subcategoria,"
    + " COALESCE(pwv.total_bodegas_visibles, 0) AS total_bodegas_visibles,"
    + " COALESCE(pwv.total_reglas, 0) AS total_reglas,"
    + " COALESCE(pwv.nombres_bodegas_visibles, '') AS nombres_bodegas_visibles,"
    + " CASE WHEN :id_bodega_usuario IS NULL THEN 1 WHEN NOT EXISTS (SELECT 1 FROM producto_bodegas_visibilidad pbv_all WHERE pbv_all.id_producto=p.id_producto) THEN 1 WHEN EXISTS (SELECT 1 FROM producto_bodegas_visibilidad pbv_me WHERE pbv_me.id_producto=p.id_producto AND pbv_me.id_bodega=:id_bodega_usuario AND pbv_me.visible=1) THEN 1 ELSE 0 END AS visible_en_bodega_usuario"
    + " FROM productos p";
  sql += " JOIN medidas m ON m.id_medida=p.id_medida";
  sql += " JOIN categorias c ON c.id_categoria=p.id_categoria";
  sql += " LEFT JOIN subcategorias s ON s.id_subcategoria=p.id_subcategoria";
  sql += " LEFT JOIN (SELECT pbv.id_producto, SUM(pbv.visible=1) AS total_bodegas_visibles, COUNT(*) AS total_reglas, GROUP_CONCAT(b.nombre_bodega ORDER BY b.nombre_bodega ASC SEPARATOR ', ') AS nombres_bodegas_visibles FROM producto_bodegas_visibilidad pbv JOIN bodegas b ON b.id_bodega=pbv.id_bodega GROUP BY pbv.id_producto) pwv ON pwv.id_producto=p.id_producto";
  sql += " WHERE (:all=1 OR p.activo=1)";
  sql += " AND " + qf.clause;
  sql += " AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)";
  sql += " AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)";
  sql += " AND (:id_medida IS NULL OR p.id_medida=:id_medida)";
  sql += " ORDER BY p.nombre_producto ASC";
  sql += " LIMIT " + limit + " OFFSET " + offset;

  // COUNT y SELECT en paralelo (antes secuenciales → el listado tardaba el doble).
  var params = { all: all ? 1 : 0, id_bodega_usuario, id_categoria, id_subcategoria, id_medida, ...qf.params };
  var [[countRows], [rows]] = await Promise.all([
    pool.query(countSql, params),
    pool.query(sql, params),
  ]);
  var total = countRows?.[0]?.total || 0;

  res.json({
    rows,
    total: Number(total),
    page,
    limit,
    totalPages: Math.ceil(Number(total) / Math.max(1, limit)),
  });
});

app.post("/api/productos", auth, requirePermission("action.create_update", "crear productos"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      nombre_producto,
      sku = null,
      id_medida,
      id_categoria,
      id_subcategoria = null,
      activo = 1,
      id_bodegas_visibles = [],
    } = req.body || {};

    if (!nombre_producto) return res.status(400).json({ error: "Falta nombre del producto" });
    if (!id_medida) return res.status(400).json({ error: "Falta medida" });
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const visibleWarehouseIds = normalizeWarehouseIdList(id_bodegas_visibles);

    await conn.beginTransaction();
    if (!(await areWarehouseIdsValid(conn, visibleWarehouseIds))) {
      await conn.rollback();
      return res.status(400).json({ error: "Una o mas bodegas visibles no son validas o no estan activas" });
    }

    const [r] = await conn.query(
      `INSERT INTO productos
       (nombre_producto, sku, id_medida, id_categoria, id_subcategoria, activo)
       VALUES (:nombre_producto, :sku, :id_medida, :id_categoria, :id_subcategoria, :activo)`,
      {
        nombre_producto,
        sku: sku || null,
        id_medida,
        id_categoria,
        id_subcategoria: id_subcategoria || null,
        activo: activo ? 1 : 0,
      }
    );
    await saveProductVisibleWarehouseIds(conn, r.insertId, visibleWarehouseIds);
    await conn.commit();
    res.json({ ok: true, id_producto: r.insertId });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El producto ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.patch("/api/productos/:id", auth, requirePermission("action.create_update", "editar productos"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_producto = Number(req.params.id || 0);
    const {
      nombre_producto,
      sku = null,
      id_medida,
      id_categoria,
      id_subcategoria = null,
      activo = 1,
      id_bodegas_visibles = [],
    } = req.body || {};

    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    if (!nombre_producto) return res.status(400).json({ error: "Falta nombre del producto" });
    if (!id_medida) return res.status(400).json({ error: "Falta medida" });
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const visibleWarehouseIds = normalizeWarehouseIdList(id_bodegas_visibles);
    if (!Number(activo)) {
      const chk = await ensureCatalogCanDeactivate(conn, { entity: "PRODUCTO", id: id_producto });
      if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    }
    if (!(await areWarehouseIdsValid(conn, visibleWarehouseIds))) {
      return res.status(400).json({ error: "Una o mas bodegas visibles no son validas o no estan activas" });
    }

    const [r] = await conn.query(
      `UPDATE productos
       SET nombre_producto=:nombre_producto,
           sku=:sku,
           id_medida=:id_medida,
           id_categoria=:id_categoria,
           id_subcategoria=:id_subcategoria,
           activo=:activo
       WHERE id_producto=:id_producto`,
      {
        id_producto,
        nombre_producto,
        sku: sku || null,
        id_medida,
        id_categoria,
        id_subcategoria: id_subcategoria || null,
        activo: activo ? 1 : 0,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Producto no existe" });
    await saveProductVisibleWarehouseIds(conn, id_producto, visibleWarehouseIds);
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El producto ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/productos/:id/bodegas-visibles", auth, async (req, res) => {
  try {
    const id_producto = Number(req.params.id || 0);
    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    await ensureProductWarehouseVisibilityTable();
    const ids = await getProductVisibleWarehouseIds(id_producto);
    const [bodegas] = await pool.query(
      `SELECT pbv.id_bodega, b.nombre_bodega
       FROM producto_bodegas_visibilidad pbv
       JOIN bodegas b ON b.id_bodega=pbv.id_bodega
       WHERE pbv.id_producto=:id_producto
         AND pbv.visible=1
       ORDER BY b.nombre_bodega ASC, pbv.id_bodega ASC`,
      { id_producto }
    );
    res.json({
      id_producto,
      ids,
      bodegas: bodegas || [],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/productos/:id/visibilidad-mi-bodega", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_producto = Number(req.params.id || 0);
    const id_bodega = Number(req.user?.id_warehouse || 0);
    const visible = Number(req.body?.visible) ? 1 : 0;
    if (!id_producto) return res.status(400).json({ error: "Falta producto" });
    if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega asignada" });

    await conn.beginTransaction();
    await setProductWarehouseVisibility(conn, id_producto, id_bodega, visible);
    await conn.commit();
    const visibleEnBodega = await isProductVisibleInWarehouse(pool, id_producto, id_bodega);
    res.json({ ok: true, id_producto, id_bodega, visible: visibleEnBodega ? 1 : 0 });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    res.status(Number(e?.status || 500)).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/medidas", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_medida, nombre_medida
     FROM medidas
     WHERE activo=1
     ORDER BY nombre_medida ASC`
  );
  res.json(rows);
});

app.patch("/api/medidas/:id", auth, requirePermission("action.create_update", "actualizar medidas"), async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "ID invalido" });
    const body = req.body || {};
    const nombre_medida = String(body.nombre_medida || "").trim();
    const activo = body.activo === undefined ? null : (Number(body.activo) ? 1 : 0);
    if (!nombre_medida) return res.status(400).json({ error: "Falta nombre de la medida" });
    const [[existing]] = await pool.query(
      `SELECT id_medida FROM medidas WHERE id_medida=:id LIMIT 1`,
      { id }
    );
    if (!existing) return res.status(404).json({ error: "Medida no existe" });
    const fields = ["nombre_medida=:nombre_medida"];
    const params = { id, nombre_medida };
    if (activo !== null) {
      fields.push("activo=:activo");
      params.activo = activo;
    }
    await pool.query(
      `UPDATE medidas SET ${fields.join(", ")} WHERE id_medida=:id`,
      params
    );
    res.json({ ok: true, id_medida: id });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/categorias", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT id_categoria, nombre_categoria, activo
     FROM categorias
     WHERE (:all=1 OR activo=1)
     ORDER BY nombre_categoria ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/categorias", auth, requirePermission("action.create_update", "crear categorias"), async (req, res) => {
  try {
    const nombre_categoria = String(req.body?.nombre_categoria || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;
    if (!nombre_categoria) return res.status(400).json({ error: "Falta nombre de categoria" });

    const [r] = await pool.query(
      `INSERT INTO categorias (nombre_categoria, activo)
       VALUES (:nombre_categoria, :activo)`,
      { nombre_categoria, activo }
    );
    res.json({ ok: true, id_categoria: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La categoria ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/categorias/:id_categoria", auth, requirePermission("action.create_update", "editar categorias"), async (req, res) => {
  try {
    const id_categoria = Number(req.params.id_categoria || 0);
    const rawNombre = req.body?.nombre_categoria;
    const nombre_categoria = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (nombre_categoria !== null && !nombre_categoria) {
      return res.status(400).json({ error: "Falta nombre de categoria" });
    }
    if (nombre_categoria === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE categorias
       SET nombre_categoria=COALESCE(:nombre_categoria, nombre_categoria),
           activo=COALESCE(:activo, activo)
       WHERE id_categoria=:id_categoria`,
      { id_categoria, nombre_categoria, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Categoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La categoria ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/categorias/:id_categoria/deactivate", auth, requirePermission("action.delete", "desactivar categorias"), async (req, res) => {
  try {
    const id_categoria = Number(req.params.id_categoria || 0);
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    const [r] = await pool.query(
      `UPDATE categorias
       SET activo=0
       WHERE id_categoria=:id_categoria`,
      { id_categoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Categoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/categorias/:id_categoria", auth, requirePermission("action.delete", "eliminar categorias"), async (req, res) => {
  try {
    const id_categoria = Number(req.params.id_categoria || 0);
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });

    const [[inUseProd]] = await pool.query(
      `SELECT COUNT(*) AS n FROM productos WHERE id_categoria=:id_categoria`,
      { id_categoria }
    );
    if (Number(inUseProd?.n || 0) > 0) {
      return res.status(409).json({ error: "No se puede eliminar: la categoria tiene productos asociados. Desactivala en su lugar." });
    }
    const [[inUseSub]] = await pool.query(
      `SELECT COUNT(*) AS n FROM subcategorias WHERE id_categoria=:id_categoria`,
      { id_categoria }
    );
    if (Number(inUseSub?.n || 0) > 0) {
      return res.status(409).json({ error: "No se puede eliminar: la categoria tiene subcategorias asociadas. Elimina o reasigna las subcategorias primero." });
    }

    const [r] = await pool.query(
      `DELETE FROM categorias WHERE id_categoria=:id_categoria`,
      { id_categoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Categoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/subcategorias", auth, async (req, res) => {
  const id_categoria = Number(req.query.categoria || 0) || null;
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT s.id_subcategoria,
            s.id_categoria,
            s.nombre_subcategoria,
            s.activo,
            c.nombre_categoria
     FROM subcategorias s
     JOIN categorias c ON c.id_categoria=s.id_categoria
     WHERE (:all=1 OR s.activo=1)
       AND (:id_categoria IS NULL OR s.id_categoria=:id_categoria)
     ORDER BY c.nombre_categoria ASC, s.nombre_subcategoria ASC`,
    { id_categoria, all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/subcategorias", auth, requirePermission("action.create_update", "crear subcategorias"), async (req, res) => {
  try {
    const id_categoria = Number(req.body?.id_categoria || 0);
    const nombre_subcategoria = String(req.body?.nombre_subcategoria || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;
    if (!id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (!nombre_subcategoria) return res.status(400).json({ error: "Falta nombre de subcategoria" });

    const [r] = await pool.query(
      `INSERT INTO subcategorias (id_categoria, nombre_subcategoria, activo)
       VALUES (:id_categoria, :nombre_subcategoria, :activo)`,
      { id_categoria, nombre_subcategoria, activo }
    );
    res.json({ ok: true, id_subcategoria: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La subcategoria ya existe en esa categoria" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/subcategorias/:id_subcategoria", auth, requirePermission("action.create_update", "editar subcategorias"), async (req, res) => {
  try {
    const id_subcategoria = Number(req.params.id_subcategoria || 0);
    const id_categoria =
      typeof req.body?.id_categoria === "undefined" || req.body?.id_categoria === null
        ? null
        : Number(req.body.id_categoria || 0);
    const rawNombre = req.body?.nombre_subcategoria;
    const nombre_subcategoria = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_subcategoria) return res.status(400).json({ error: "Falta subcategoria" });
    if (id_categoria !== null && !id_categoria) return res.status(400).json({ error: "Falta categoria" });
    if (nombre_subcategoria !== null && !nombre_subcategoria) {
      return res.status(400).json({ error: "Falta nombre de subcategoria" });
    }
    if (id_categoria === null && nombre_subcategoria === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE subcategorias
       SET id_categoria=COALESCE(:id_categoria, id_categoria),
           nombre_subcategoria=COALESCE(:nombre_subcategoria, nombre_subcategoria),
           activo=COALESCE(:activo, activo)
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria, id_categoria, nombre_subcategoria, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "La subcategoria ya existe en esa categoria" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/subcategorias/:id_subcategoria/deactivate", auth, requirePermission("action.delete", "desactivar subcategorias"), async (req, res) => {
  try {
    const id_subcategoria = Number(req.params.id_subcategoria || 0);
    if (!id_subcategoria) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE subcategorias
       SET activo=0
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/subcategorias/:id_subcategoria", auth, requirePermission("action.delete", "eliminar subcategorias"), async (req, res) => {
  try {
    const id_subcategoria = Number(req.params.id_subcategoria || 0);
    if (!id_subcategoria) return res.status(400).json({ error: "Falta subcategoria" });

    const [[inUseProd]] = await pool.query(
      `SELECT COUNT(*) AS n FROM productos WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria }
    );
    if (Number(inUseProd?.n || 0) > 0) {
      return res.status(409).json({ error: "No se puede eliminar: la subcategoria tiene productos asociados. Desactivala en su lugar." });
    }

    const [r] = await pool.query(
      `DELETE FROM subcategorias WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Subcategoria no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/limites", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const limit = Math.max(1, Math.min(5000, Number(req.query.limit || 1000)));
  const [rows] = await pool.query(
    `SELECT l.id_bodega,
            l.id_producto,
            l.minimo,
            l.maximo,
            l.activo,
            b.nombre_bodega,
            p.nombre_producto,
            p.sku
     FROM limites_producto_bodega l
     JOIN bodegas b ON b.id_bodega=l.id_bodega
     JOIN productos p ON p.id_producto=l.id_producto
     WHERE (:all=1 OR l.activo=1)
     ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC
     LIMIT ${limit}`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/limites", auth, requirePermission("action.create_update", "crear limites"), async (req, res) => {
  try {
    const { id_bodega, id_producto, minimo = 0, maximo = 0, activo = 1 } = req.body || {};
    const idB = Number(id_bodega || 0);
    const idP = Number(id_producto || 0);
    const min = Number(minimo || 0);
    const max = Number(maximo || 0);
    const isActive = Number(activo) ? 1 : 0;
    if (!idB) return res.status(400).json({ error: "Falta bodega" });
    if (!idP) return res.status(400).json({ error: "Falta producto" });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return res.status(400).json({ error: "Minimo y maximo deben ser numericos" });
    if (min < 0 || max < 0) return res.status(400).json({ error: "Minimo y maximo no pueden ser negativos" });
    if (max > 0 && min > max) return res.status(400).json({ error: "Minimo mayor que maximo" });

    await pool.query(
      `INSERT INTO limites_producto_bodega (id_bodega, id_producto, minimo, maximo, activo)
       VALUES (:id_bodega, :id_producto, :minimo, :maximo, :activo)
       ON DUPLICATE KEY UPDATE
         minimo=VALUES(minimo),
         maximo=VALUES(maximo),
         activo=VALUES(activo)`,
      { id_bodega: idB, id_producto: idP, minimo: min, maximo: max, activo: isActive }
    );
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/limites/:id_bodega/:id_producto", auth, requirePermission("action.create_update", "editar limites"), async (req, res) => {
  try {
    const idB = Number(req.params.id_bodega || 0);
    const idP = Number(req.params.id_producto || 0);
    const min = Number(req.body?.minimo || 0);
    const max = Number(req.body?.maximo || 0);
    const isActive = Number(req.body?.activo) ? 1 : 0;
    if (!idB || !idP) return res.status(400).json({ error: "Faltan llaves del limite" });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return res.status(400).json({ error: "Minimo y maximo deben ser numericos" });
    if (min < 0 || max < 0) return res.status(400).json({ error: "Minimo y maximo no pueden ser negativos" });
    if (max > 0 && min > max) return res.status(400).json({ error: "Minimo mayor que maximo" });
    const [r] = await pool.query(
      `UPDATE limites_producto_bodega
       SET minimo=:minimo, maximo=:maximo, activo=:activo
       WHERE id_bodega=:id_bodega AND id_producto=:id_producto`,
      { id_bodega: idB, id_producto: idP, minimo: min, maximo: max, activo: isActive }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Limite no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/limites/:id_bodega/:id_producto/deactivate", auth, requirePermission("action.delete", "desactivar limites"), async (req, res) => {
  try {
    const idB = Number(req.params.id_bodega || 0);
    const idP = Number(req.params.id_producto || 0);
    if (!idB || !idP) return res.status(400).json({ error: "Faltan llaves del limite" });
    const [r] = await pool.query(
      `UPDATE limites_producto_bodega
       SET activo=0
       WHERE id_bodega=:id_bodega AND id_producto=:id_producto`,
      { id_bodega: idB, id_producto: idP }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Limite no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reglas-subcategorias", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT r.id_subcategoria,
            r.max_dias_vida,
            r.dias_alerta_antes,
            r.activo,
            s.nombre_subcategoria,
            c.nombre_categoria
     FROM reglas_subcategoria r
     JOIN subcategorias s ON s.id_subcategoria=r.id_subcategoria
     JOIN categorias c ON c.id_categoria=s.id_categoria
     WHERE (:all=1 OR r.activo=1)
     ORDER BY c.nombre_categoria ASC, s.nombre_subcategoria ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/reglas-subcategorias", auth, requirePermission("action.create_update", "crear reglas de subcategorias"), async (req, res) => {
  try {
    const { id_subcategoria, max_dias_vida = 0, dias_alerta_antes = 0, activo = 1 } = req.body || {};
    const idSub = Number(id_subcategoria || 0);
    const max = Math.max(0, Number(max_dias_vida || 0));
    const alert = Math.max(0, Number(dias_alerta_antes || 0));
    const isActive = Number(activo) ? 1 : 0;
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });

    await pool.query(
      `INSERT INTO reglas_subcategoria (id_subcategoria, max_dias_vida, dias_alerta_antes, activo)
       VALUES (:id_subcategoria, :max_dias_vida, :dias_alerta_antes, :activo)
       ON DUPLICATE KEY UPDATE
         max_dias_vida=VALUES(max_dias_vida),
         dias_alerta_antes=VALUES(dias_alerta_antes),
         activo=VALUES(activo)`,
      { id_subcategoria: idSub, max_dias_vida: max, dias_alerta_antes: alert, activo: isActive }
    );
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/reglas-subcategorias/:id_subcategoria", auth, requirePermission("action.create_update", "editar reglas de subcategorias"), async (req, res) => {
  try {
    const idSub = Number(req.params.id_subcategoria || 0);
    const max = Math.max(0, Number(req.body?.max_dias_vida || 0));
    const alert = Math.max(0, Number(req.body?.dias_alerta_antes || 0));
    const isActive = Number(req.body?.activo) ? 1 : 0;
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE reglas_subcategoria
       SET max_dias_vida=:max_dias_vida, dias_alerta_antes=:dias_alerta_antes, activo=:activo
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria: idSub, max_dias_vida: max, dias_alerta_antes: alert, activo: isActive }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Regla no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/reglas-subcategorias/:id_subcategoria/deactivate", auth, requirePermission("action.delete", "desactivar reglas de subcategorias"), async (req, res) => {
  try {
    const idSub = Number(req.params.id_subcategoria || 0);
    if (!idSub) return res.status(400).json({ error: "Falta subcategoria" });
    const [r] = await pool.query(
      `UPDATE reglas_subcategoria
       SET activo=0
       WHERE id_subcategoria=:id_subcategoria`,
      { id_subcategoria: idSub }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Regla no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   PROVEEDORES
========================= */
app.get("/api/proveedores", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT id_proveedor, nombre_proveedor, telefono, direccion, activo
     FROM proveedores
     WHERE (:all=1 OR activo=1)
     ORDER BY nombre_proveedor ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/proveedores", auth, requirePermission("action.create_update", "crear proveedores"), async (req, res) => {
  try {
    const nombre_proveedor = String(req.body?.nombre_proveedor || "").trim();
    const telefonoRaw = String(req.body?.telefono || "").trim();
    const direccionRaw = String(req.body?.direccion || "").trim();
    const activo = Number(req.body?.activo) ? 1 : 0;

    if (!nombre_proveedor) return res.status(400).json({ error: "Falta nombre de proveedor" });

    const [r] = await pool.query(
      `INSERT INTO proveedores (nombre_proveedor, telefono, direccion, activo)
       VALUES (:nombre_proveedor, :telefono, :direccion, :activo)`,
      {
        nombre_proveedor,
        telefono: telefonoRaw || null,
        direccion: direccionRaw || null,
        activo,
      }
    );
    res.json({ ok: true, id_proveedor: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El proveedor ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/proveedores/:id_proveedor", auth, requirePermission("action.create_update", "editar proveedores"), async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    const rawNombre = req.body?.nombre_proveedor;
    const nombre_proveedor = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const telefono =
      typeof req.body?.telefono === "undefined" || req.body?.telefono === null
        ? null
        : String(req.body.telefono || "").trim();
    const direccion =
      typeof req.body?.direccion === "undefined" || req.body?.direccion === null
        ? null
        : String(req.body.direccion || "").trim();
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;

    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    if (nombre_proveedor !== null && !nombre_proveedor) {
      return res.status(400).json({ error: "Falta nombre de proveedor" });
    }
    if (nombre_proveedor === null && telefono === null && direccion === null && activo === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }

    const [r] = await pool.query(
      `UPDATE proveedores
       SET nombre_proveedor=COALESCE(:nombre_proveedor, nombre_proveedor),
           telefono=CASE WHEN :telefono IS NULL THEN telefono ELSE :telefono END,
           direccion=CASE WHEN :direccion IS NULL THEN direccion ELSE :direccion END,
           activo=COALESCE(:activo, activo)
       WHERE id_proveedor=:id_proveedor`,
      {
        id_proveedor,
        nombre_proveedor,
        telefono,
        direccion,
        activo,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El proveedor ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/proveedores/:id_proveedor/deactivate", auth, requirePermission("action.delete", "desactivar proveedores"), async (req, res) => {
  try {
    const id_proveedor = Number(req.params.id_proveedor || 0);
    if (!id_proveedor) return res.status(400).json({ error: "Falta proveedor" });
    const [r] = await pool.query(
      `UPDATE proveedores
       SET activo=0
       WHERE id_proveedor=:id_proveedor`,
      { id_proveedor }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Proveedor no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   MOTIVOS (LISTA)
========================= */
app.get("/api/motivos", auth, async (req, res) => {
  const tipo = String(req.query.tipo || "").toUpperCase();
  const all = String(req.query.all || "") === "1";
  const whereTipo = tipo ? "AND tipo_movimiento=:tipo" : "";
  const [rows] = await pool.query(
    `SELECT id_motivo, nombre_motivo, tipo_movimiento, signo_cantidad, activo
     FROM motivos_movimiento
     WHERE (:all=1 OR activo=1)
     ${whereTipo}
     ORDER BY nombre_motivo ASC`,
    tipo ? { tipo, all: all ? 1 : 0 } : { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.post("/api/motivos", auth, requirePermission("action.create_update", "crear motivos"), async (req, res) => {
  try {
    const nombre_motivo = String(req.body?.nombre_motivo || "").trim();
    const tipo_movimiento = String(req.body?.tipo_movimiento || "").trim().toUpperCase();
    const activo = Number(req.body?.activo) ? 1 : 0;
    const rawSigno = Number(req.body?.signo_cantidad);
    if (!nombre_motivo) return res.status(400).json({ error: "Falta nombre de motivo" });
    if (!["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) {
      return res.status(400).json({ error: "Tipo de movimiento invalido" });
    }
    const signo_cantidad = rawSigno === -1 ? -1 : 1;

    const [r] = await pool.query(
      `INSERT INTO motivos_movimiento (nombre_motivo, tipo_movimiento, signo_cantidad, activo)
       VALUES (:nombre_motivo, :tipo_movimiento, :signo_cantidad, :activo)`,
      { nombre_motivo, tipo_movimiento, signo_cantidad, activo }
    );
    res.json({ ok: true, id_motivo: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El motivo ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/motivos/:id_motivo", auth, requirePermission("action.create_update", "editar motivos"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_motivo = Number(req.params.id_motivo || 0);
    if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });

    const rawNombre = req.body?.nombre_motivo;
    const nombre_motivo = typeof rawNombre === "string" ? rawNombre.trim() : null;
    const tipo_movimiento =
      typeof req.body?.tipo_movimiento === "string" && req.body.tipo_movimiento.trim()
        ? String(req.body.tipo_movimiento || "").trim().toUpperCase()
        : null;
    const activo =
      typeof req.body?.activo === "undefined" || req.body?.activo === null ? null : Number(req.body.activo) ? 1 : 0;
    const signo_cantidad =
      typeof req.body?.signo_cantidad === "undefined" || req.body?.signo_cantidad === null
        ? null
        : Number(req.body.signo_cantidad) === -1
          ? -1
          : 1;

    if (nombre_motivo !== null && !nombre_motivo) return res.status(400).json({ error: "Falta nombre de motivo" });
    if (tipo_movimiento && !["ENTRADA", "SALIDA", "TRANSFERENCIA", "AJUSTE"].includes(tipo_movimiento)) {
      return res.status(400).json({ error: "Tipo de movimiento invalido" });
    }
    if (nombre_motivo === null && tipo_movimiento === null && activo === null && signo_cantidad === null) {
      return res.status(400).json({ error: "Sin cambios para actualizar" });
    }
    if (activo === 0) {
      const chk = await ensureCatalogCanDeactivate(conn, { entity: "MOTIVO", id: id_motivo });
      if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    }

    const [r] = await conn.query(
      `UPDATE motivos_movimiento
       SET nombre_motivo=COALESCE(:nombre_motivo, nombre_motivo),
           tipo_movimiento=COALESCE(:tipo_movimiento, tipo_movimiento),
           signo_cantidad=COALESCE(:signo_cantidad, signo_cantidad),
           activo=COALESCE(:activo, activo)
       WHERE id_motivo=:id_motivo`,
      { id_motivo, nombre_motivo, tipo_movimiento, signo_cantidad, activo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Motivo no existe" });
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El motivo ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/motivos/:id_motivo/deactivate", auth, requirePermission("action.delete", "desactivar motivos"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_motivo = Number(req.params.id_motivo || 0);
    if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });
    const chk = await ensureCatalogCanDeactivate(conn, { entity: "MOTIVO", id: id_motivo });
    if (!chk.ok) return res.status(Number(chk.status || 409)).json(chk);
    const [r] = await conn.query(
      `UPDATE motivos_movimiento
       SET activo=0
       WHERE id_motivo=:id_motivo`,
      { id_motivo }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Motivo no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   STOCK ACTUAL POR PRODUCTO
========================= */
app.get("/api/productos/:id/stock", auth, async (req, res) => {
  const id_producto = Number(req.params.id);
  const id_bodega = Number(req.query.warehouse || req.user.id_warehouse || 0);
  if (!id_producto) return res.status(400).json({ error: "Falta producto" });
  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  if (!(await isProductVisibleInWarehouse(pool, id_producto, id_bodega))) {
    return res.status(404).json({ error: "Producto no disponible para esa bodega" });
  }

  const [rows] = await pool.query(
    `SELECT stock
     FROM v_stock_resumen
     WHERE id_bodega=:id_bodega AND id_producto=:id_producto
     LIMIT 1`,
    { id_bodega, id_producto }
  );
  const [priceRows] = await pool.query(
    `SELECT k.costo_unitario
     FROM kardex k
     WHERE k.id_bodega=:id_bodega
       AND k.id_producto=:id_producto
       AND k.delta_cantidad > 0
     ORDER BY k.creado_en DESC, k.id_kardex DESC
     LIMIT 1`,
    { id_bodega, id_producto }
  );

  // Último precio al que se SACÓ este producto en esta bodega (ventas,
  // transferencias, etc.). Sirve como referencia para salidas manuales.
  const [salidaRows] = await pool.query(
    `SELECT md.precio_salida
     FROM movimiento_detalle md
     JOIN movimiento_encabezado me ON me.id_movimiento=md.id_movimiento
     WHERE md.id_producto=:id_producto
       AND me.id_bodega_origen=:id_bodega
       AND md.precio_salida IS NOT NULL
       AND md.precio_salida > 0
       AND me.estado <> 'ANULADO'
       AND me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
     ORDER BY me.creado_en DESC, md.id_detalle DESC
     LIMIT 1`,
    { id_bodega, id_producto }
  );

  res.json({
    stock: rows[0]?.stock ?? 0,
    precio_sugerido: Number(priceRows[0]?.costo_unitario || 0),
    ultimo_precio_salida: Number(salidaRows[0]?.precio_salida || 0),
  });
});

/* =========================
   BODEGA DEL USUARIO
========================= */
app.get("/api/bodegas", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  const [rows] = await pool.query(
    `SELECT b.id_bodega,
            b.nombre_bodega,
            b.tipo_bodega,
            b.activo,
            b.telefono_contacto,
            b.direccion_contacto,
            cb.maneja_stock,
            cb.puede_recibir,
            cb.puede_despachar,
            cb.modo_despacho_auto,
            cb.id_bodega_destino_default,
            cb.permite_salida_conteo_final,
            cb.requiere_precio_salida,
            cb.requiere_confirmacion_recepcion
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE (:all=1 OR b.activo=1)
     ORDER BY b.nombre_bodega ASC`,
    { all: all ? 1 : 0 }
  );
  res.json(rows);
});

app.get("/api/bodegas/:id", auth, requirePermission("section.view.ajustes", "ver modulo de ajustes"), async (req, res) => {
  const id_bodega = Number(req.params.id);
  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  const [rows] = await pool.query(
    `SELECT b.id_bodega,
            b.nombre_bodega,
            b.tipo_bodega,
            b.telefono_contacto,
            b.direccion_contacto,
            cb.maneja_stock,
            cb.permite_salida_conteo_final,
            cb.requiere_precio_salida,
            cb.puede_despachar,
            cb.puede_recibir,
            cb.modo_despacho_auto
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE b.id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );
  if (!rows.length) return res.status(404).json({ error: "No existe bodega" });
  res.json(rows[0]);
});

app.get("/api/bodegas/:id/logo", auth, requirePermission("section.view.ajustes", "ver modulo de ajustes"), async (req, res) => {
  try {
    const id_bodega = Number(req.params.id || 0);
    if (!id_bodega) return res.status(400).json({ error: "Bodega invalida" });
    const row = await getWarehouseCustomLogoRow(id_bodega);
    const effective_logo_data = (row?.print || await getPrintLogoDataUri());
    res.json({
      id_bodega,
      logo_data: row?.legacy || "",
      logo_app_data: row?.app || "",
      logo_print_data: row?.print || "",
      effective_logo_data,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/bodegas/:id/logo", auth, requirePermission("action.create_update", "actualizar logo de bodega"), async (req, res) => {
  try {
    const id_bodega = Number(req.params.id || 0);
    if (!id_bodega) return res.status(400).json({ error: "Bodega invalida" });
    await ensureWarehouseLogoTable();

    const legacyLogo = normalizeLogoData(req.body?.logo_data);
    const hasApp = Object.prototype.hasOwnProperty.call(req.body || {}, "logo_app_data");
    const hasPrint = Object.prototype.hasOwnProperty.call(req.body || {}, "logo_print_data");
    const logo_app_data = hasApp ? normalizeLogoData(req.body?.logo_app_data) : legacyLogo;
    const logo_print_data = hasPrint ? normalizeLogoData(req.body?.logo_print_data) : legacyLogo;
    if (logo_app_data || logo_print_data || legacyLogo) {
      await pool.query(
        `INSERT INTO bodega_logo (id_bodega, logo_data, logo_app_data, logo_print_data)
         VALUES (:id_bodega, :logo_data, :logo_app_data, :logo_print_data)
         ON DUPLICATE KEY UPDATE
           logo_data=VALUES(logo_data),
           logo_app_data=VALUES(logo_app_data),
           logo_print_data=VALUES(logo_print_data)`,
        {
          id_bodega,
          logo_data: legacyLogo,
          logo_app_data,
          logo_print_data,
        }
      );
    } else {
      await pool.query(
        `DELETE FROM bodega_logo
         WHERE id_bodega=:id_bodega`,
        { id_bodega }
      );
    }

    res.json({ ok: true, id_bodega });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   ENTRADAS -> MOVIMIENTOS + KARDEX
========================= */
app.post("/api/entradas", auth, requirePermission("action.create_update", "registrar entradas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const {
    id_motivo,
    id_proveedor = null,
    no_documento = null,
    observaciones = null,
    pagado = null,
    lines = [],
  } = req.body || {};

  if (!id_motivo) return res.status(400).json({ error: "Falta motivo" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas" });

  const id_bodega_destino = Number(req.user.id_warehouse || 0);
  if (!id_bodega_destino) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/entradas" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const obsFinal =
    pagado ? `${observaciones ? `${observaciones} | ` : ""}Pagado: ${String(pagado)}` : observaciones;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let sensitiveApproval = null;
    const [[mot]] = await conn.query(
      `SELECT id_motivo, tipo_movimiento, nombre_motivo
       FROM motivos_movimiento
       WHERE id_motivo=:id_motivo
       LIMIT 1`,
      { id_motivo: Number(id_motivo || 0) }
    );
    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo no existe" });
    }
    const motType = String(mot.tipo_movimiento || "").toUpperCase();
    if (!["ENTRADA", "AJUSTE"].includes(motType)) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo invalido para entrada" });
    }
    if (motType === "AJUSTE") {
      const approval = await verifySensitiveApproval(req, conn, "ajuste manual de entrada");
      if (!approval.ok) {
        await conn.rollback();
        return res.status(Number(approval.status || 403)).json(approval);
      }
      sensitiveApproval = approval;
    }

    const [r] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_destino, id_proveedor, no_documento, observaciones, creado_por)
       VALUES ('ENTRADA', :id_motivo, :id_bodega_destino, :id_proveedor, :no_documento, :observaciones, :creado_por)`,
      {
        id_motivo,
        id_bodega_destino,
        id_proveedor: id_proveedor || null,
        no_documento: no_documento || null,
        observaciones: obsFinal || null,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento = r.insertId;

    for (const ln of lines) {
      if (!ln.id_producto) throw new Error("Linea sin producto");
      if (!(await isProductVisibleInWarehouse(conn, ln.id_producto, id_bodega_destino))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${ln.id_producto} no esta habilitado para la bodega destino` });
      }
      const cantidad = Number(ln.cantidad || ln.qty || ln.qty_requested || 0);
      if (!cantidad || cantidad <= 0) continue;
      const costo_unitario = Number(ln.precio || ln.costo_unitario || 0);

      const [d] = await conn.query(
        `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
         VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
        {
          id_movimiento,
          id_producto: ln.id_producto,
          lote: ln.lote || null,
          fecha_vencimiento: ln.caducidad || null,
          cantidad,
          costo_unitario,
          observacion_linea: ln.observacion_linea || null,
        }
      );
      const id_detalle = d.insertId;

      await conn.query(
        `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
         VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
        {
          id_movimiento,
          id_detalle,
          id_bodega: id_bodega_destino,
          id_producto: ln.id_producto,
          lote: ln.lote || null,
          fecha_vencimiento: ln.caducidad || null,
          delta_cantidad: cantidad,
          costo_unitario,
        }
      );
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "ENTRADA_AJUSTE_MANUAL",
      action_label: "Ajuste manual en entrada",
      approval: sensitiveApproval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { id_motivo: Number(id_motivo || 0), lineas: Number(lines.length || 0) },
    });
    res.json({ ok: true, id_movimiento, sensitive_approval: toSensitiveApprovalPayload(sensitiveApproval) });
    emitStockChanged(id_bodega_destino, {
      action: "entrada",
      id_movimiento,
      nombre_bodega: "",
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/entradas/existe-documento", auth, async (req, res) => {
  try {
    const no_documento = String(req.query.no_documento || "").trim();
    if (!no_documento) return res.status(400).json({ error: "Falta no_documento" });
    const id_bodega = Number(req.user?.id_warehouse || 0);
    const id_usuario = Number(req.user?.id_user || 0);
    if (!id_bodega || !id_usuario) return res.status(400).json({ error: "Usuario sin bodega" });

    const [[row]] = await pool.query(
      `SELECT id_movimiento, creado_en
       FROM movimiento_encabezado
       WHERE tipo_movimiento='ENTRADA'
         AND id_bodega_destino=:id_bodega
         AND creado_por=:id_usuario
         AND no_documento=:no_documento
         AND DATE(creado_en)=CURDATE()
       ORDER BY id_movimiento DESC
       LIMIT 1`,
      { id_bodega, id_usuario, no_documento }
    );
    if (!row?.id_movimiento) return res.json({ exists: false });
    return res.json({ exists: true, id_movimiento: Number(row.id_movimiento || 0), creado_en: row.creado_en || null });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/ajustes", auth, requirePermission("action.create_update", "registrar ajustes"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { direccion = "", id_motivo, observaciones = null, lines = [], id_bodega: id_bodega_input = null } = req.body || {};
  const dir = String(direccion || "").trim().toUpperCase();
  if (!["ENTRADA", "SALIDA"].includes(dir)) return res.status(400).json({ error: "Direccion invalida: ENTRADA o SALIDA" });
  if (!id_motivo) return res.status(400).json({ error: "Falta motivo de ajuste" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas de ajuste" });

  const scope = await resolveStockScope(req.user);
  const requestedWarehouse = Number(id_bodega_input || 0);
  const id_bodega = scope.can_all_bodegas ? (requestedWarehouse > 0 ? requestedWarehouse : scope.id_bodega) : scope.id_bodega;
  if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/ajustes" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[warehouseRow]] = await conn.query(
      `SELECT id_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
         AND activo=1
       LIMIT 1`,
      { id_bodega }
    );
    if (!warehouseRow) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega no valida para ajuste" });
    }

    const [[motivo]] = await conn.query(
      `SELECT id_motivo, tipo_movimiento, nombre_motivo, activo
       FROM motivos_movimiento
       WHERE id_motivo=:id_motivo
       LIMIT 1`,
      { id_motivo: Number(id_motivo || 0) }
    );
    if (!motivo || Number(motivo.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Motivo no disponible" });
    }
    if (String(motivo.tipo_movimiento || "").toUpperCase() !== "AJUSTE") {
      await conn.rollback();
      return res.status(400).json({ error: "El motivo seleccionado no es de tipo AJUSTE" });
    }

    const approval = await verifySensitiveApproval(req, conn, `ajuste ${dir.toLowerCase()}`);
    if (!approval.ok) {
      await conn.rollback();
      return res.status(Number(approval.status || 403)).json(approval);
    }

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('AJUSTE', :id_motivo, :id_bodega_origen, :id_bodega_destino, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        id_motivo: Number(id_motivo || 0),
        id_bodega_origen: dir === "SALIDA" ? id_bodega : null,
        id_bodega_destino: dir === "ENTRADA" ? id_bodega : null,
        observaciones: String(observaciones || "").trim() || `Ajuste ${dir}`,
        creado_por: Number(req.user?.id_user || 0),
      }
    );
    const id_movimiento = Number(mhRes.insertId || 0);
    let appliedLines = 0;

    for (const ln of lines) {
      const id_producto = Number(ln?.id_producto || 0);
      const qtyRequested = Number(ln?.cantidad || 0);
      if (!id_producto || qtyRequested <= 0) continue;
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega seleccionada` });
      }

      if (dir === "ENTRADA") {
        const lote = String(ln?.lote || "").trim() || null;
        const fecha_vencimiento = String(ln?.caducidad || "").trim() || null;
        const costo_unitario = Number(ln?.costo_unitario || 0);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
          {
            id_movimiento,
            id_producto,
            lote,
            fecha_vencimiento,
            cantidad: qtyRequested,
            costo_unitario,
            observacion_linea: String(ln?.observacion_linea || "").trim() || null,
          }
        );
        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
          {
            id_movimiento,
            id_detalle: Number(d.insertId || 0),
            id_bodega,
            id_producto,
            lote,
            fecha_vencimiento,
            delta_cantidad: qtyRequested,
            costo_unitario,
          }
        );
        appliedLines += 1;
        continue;
      }

      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega, id_producto, qtyRequested);
      if (!picks.length || remaining > 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para producto #${id_producto}` });
      }

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, id_bodega, id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
          {
            id_movimiento,
            id_producto,
            lote: p.lote || null,
            fecha_vencimiento: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo_unitario,
            observacion_linea: String(ln?.observacion_linea || "").trim() || null,
          }
        );
        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
          {
            id_movimiento,
            id_detalle: Number(d.insertId || 0),
            id_bodega,
            id_producto,
            lote: p.lote || null,
            fecha_vencimiento: p.fecha_vencimiento || null,
            delta_cantidad: -Number(p.qty || 0),
            costo_unitario,
          }
        );
      }
      appliedLines += 1;
    }

    if (!appliedLines) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin lineas validas para ajuste" });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: dir === "ENTRADA" ? "ENTRADA_AJUSTE_MANUAL" : "SALIDA_AJUSTE_MANUAL",
      action_label: dir === "ENTRADA" ? "Ajuste manual en entrada" : "Ajuste manual en salida",
      approval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { direccion: dir, id_motivo: Number(id_motivo || 0), lineas: appliedLines },
    });
    res.json({
      ok: true,
      id_movimiento,
      tipo_movimiento: "AJUSTE",
      direccion: dir,
      sensitive_approval: toSensitiveApprovalPayload(approval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   SALIDAS DIRECTAS (MOVIMIENTOS + KARDEX)
========================= */
app.post("/api/salidas", auth, requirePermission("action.create_update", "registrar salidas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_motivo = null, id_bodega_destino = null, observaciones = null, lines = [] } = req.body || {};

  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas" });

  const id_bodega_origen = Number(req.user.id_warehouse || 0);
  if (!id_bodega_origen) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/salidas" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }
  // id_bodega_destino es opcional. Si no se envía, se asume la misma bodega
  // del usuario como destino => salida normal (consumo interno, merma, etc.).
  // La lógica useTransfer más abajo ya detecta transferencias cuando
  // destino != origen y el destino puede recibir stock.
  const idDestino = Number(id_bodega_destino || id_bodega_origen || 0);
  if (!idDestino) return res.status(400).json({ error: "Bodega destino invalida" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let sensitiveApproval = null;

    const [[cfg]] = await conn.query(
      `SELECT cb.puede_despachar, cb.requiere_precio_salida
       FROM configuracion_bodega cb
       WHERE cb.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: id_bodega_origen }
    );
    if (cfg && Number(cfg.puede_despachar || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Tu bodega no puede despachar" });
    }

    const [[dst]] = await conn.query(
      `SELECT b.id_bodega, b.activo, b.tipo_bodega, cb.maneja_stock, cb.puede_recibir, cb.modo_despacho_auto
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: idDestino }
    );
    if (!dst || Number(dst.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega destino no disponible" });
    }

    const useTransfer =
      idDestino !== id_bodega_origen &&
      Number(dst.maneja_stock || 0) === 1 &&
      Number(dst.puede_recibir || 0) === 1 &&
      (String(dst.modo_despacho_auto || "").toUpperCase() === "TRANSFERENCIA" ||
        String(dst.tipo_bodega || "").toUpperCase() === "RECEPTORA");
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";

    let mot = null;
    if (id_motivo) {
      const [[motById]] = await conn.query(
        `SELECT id_motivo, nombre_motivo, tipo_movimiento
         FROM motivos_movimiento
         WHERE id_motivo=:id_motivo
         LIMIT 1`,
        { id_motivo: Number(id_motivo || 0) }
      );
      mot = motById || null;
      if (mot) {
        // El motivo debe coincidir con el tipo del movimiento, O ser AJUSTE
        // (los ajustes manuales son válidos tanto en entradas como en salidas
        // porque son movimientos de corrección).
        const motType = String(mot.tipo_movimiento || "").toUpperCase();
        if (motType !== tipo_mov && motType !== "AJUSTE") {
          mot = null;
        }
      }
    }

    if (!mot) {
      const [[autoMot]] = await conn.query(
        `SELECT id_motivo, nombre_motivo, tipo_movimiento
         FROM motivos_movimiento
         WHERE tipo_movimiento=:tipo
         ORDER BY (nombre_motivo='Transferencia') DESC, id_motivo ASC
         LIMIT 1`,
        { tipo: tipo_mov }
      );
      mot = autoMot || null;
    }

    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: `No existe motivo para tipo ${tipo_mov}` });
    }
    if (String(mot.tipo_movimiento || "").toUpperCase() === "AJUSTE") {
      const approval = await verifySensitiveApproval(req, conn, "ajuste manual de salida");
      if (!approval.ok) {
        await conn.rollback();
        return res.status(Number(approval.status || 403)).json(approval);
      }
      sensitiveApproval = approval;
    }

    const [[corrPed]] = await conn.query(
      `SELECT COALESCE(MAX(id_pedido), 0) AS correlativo
       FROM pedido_encabezado`
    );
    const correlativoPedido = Number(corrPed?.correlativo || 0);
    const no_documento = correlativoPedido > 0 ? String(correlativoPedido) : null;

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, no_documento, observaciones, creado_por, confirmado_en, estado)
       VALUES (:tipo_movimiento, :id_motivo, :id_bodega_origen, :id_bodega_destino, :no_documento, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        tipo_movimiento: tipo_mov,
        id_motivo: mot.id_motivo,
        id_bodega_origen,
        id_bodega_destino: idDestino,
        no_documento: no_documento || null,
        observaciones: observaciones || null,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento = mhRes.insertId;

    let anyOut = false;
    const normalize = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
    const motNameNorm = normalize(mot?.nombre_motivo || "");
    const allowExpiredWriteoff = motNameNorm.includes("MERMA") || motNameNorm.includes("DESCOMPOSICION");
    const todayStr = localYmd(new Date());
    const requierePrecioSalida = Number(cfg?.requiere_precio_salida || 0) === 1;

    for (const ln of lines) {
      const id_producto = Number(ln.id_producto || 0);
      const qtyRequested = Number(ln.cantidad || ln.qty || 0);
      // Aceptar tanto `precio_salida` (forma correcta) como `precio` (legacy)
      // para mantener compatibilidad con clientes que aún mandan el nombre viejo.
      const precioSalida = Number(ln.precio_salida || ln.precio || 0);
      if (!id_producto || qtyRequested <= 0) continue;
      if (requierePrecioSalida && precioSalida <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: `El precio de salida es obligatorio para producto #${id_producto}` });
      }
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_bodega_origen))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega origen` });
      }
      if (useTransfer && !(await isProductVisibleInWarehouse(conn, id_producto, idDestino))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega destino` });
      }

      // Si el motivo NO es merma/descomposicion, FEFO excluye lotes vencidos.
      const { picks, remaining } = await pickLotsFEFO(conn, id_bodega_origen, id_producto, qtyRequested, {
        allowExpired: allowExpiredWriteoff,
      });
      if (!picks.length || remaining > 0) {
        await conn.rollback();
        return res.status(400).json({
          error: allowExpiredWriteoff
            ? `Stock insuficiente para producto #${id_producto}`
            : `Stock insuficiente (vigente) para producto #${id_producto}. Si es merma usa un motivo de Merma o Descomposicion.`,
        });
      }

      // Red de seguridad: nunca despachar lotes vencidos salvo merma/descomposicion.
      const hasExpiredPick = picks.some((p) => p.fecha_vencimiento && localYmd(p.fecha_vencimiento) < todayStr);
      if (hasExpiredPick && !allowExpiredWriteoff) {
        await conn.rollback();
        return res.status(400).json({
          error: "No puedes dar salida a producto vencido con ese motivo. Usa Merma o Descomposicion.",
        });
      }

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, id_bodega_origen, id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, precio_salida, observacion_linea)
           VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:precio_salida,:obs)`,
          {
            id_movimiento,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo: costo_unitario,
            precio_salida: precioSalida > 0 ? precioSalida : null,
            obs: ln.observacion_linea || null,
          }
        );
        const id_detalle = d.insertId;

        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: id_bodega_origen,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: -p.qty,
            costo: costo_unitario,
          }
        );
        if (useTransfer) {
          await conn.query(
            `INSERT INTO kardex
             (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
             VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            {
              id_movimiento,
              id_detalle,
              id_bodega: idDestino,
              id_producto,
              lote: p.lote || null,
              fecha: p.fecha_vencimiento || null,
              delta: +p.qty,
              costo: costo_unitario,
            }
          );
        }
        anyOut = true;
      }
    }

    if (!anyOut) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin lineas validas para salida" });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "SALIDA_AJUSTE_MANUAL",
      action_label: "Ajuste manual en salida",
      approval: sensitiveApproval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { id_motivo: Number(id_motivo || 0), lineas: Number(lines.length || 0) },
    });
    res.json({
      ok: true,
      id_movimiento,
      tipo_movimiento: tipo_mov,
      correlativo_pedido: correlativoPedido,
      sensitive_approval: toSensitiveApprovalPayload(sensitiveApproval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   SALIDAS POR CONTEO FINAL
========================= */
app.post("/api/salidas/conteo-final", auth, requirePermission("action.create_update", "registrar salidas por conteo final"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_bodega: id_bodega_input = null, observaciones = null, lines = [] } = req.body || {};
  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: "Sin lineas para procesar" });
  }
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/salidas/conteo-final" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const scope = await resolveStockScope(req.user);
  const requestedWarehouse = Number(id_bodega_input || 0);
  if (requestedWarehouse <= 0) {
    return res.status(400).json({ error: "Debes seleccionar una bodega especifica" });
  }
  const warehouseScope = getScopedWarehouseFilter(scope, requestedWarehouse);
  if (warehouseScope.denied || !warehouseScope.selected) {
    return res.status(400).json({ error: "Bodega no valida para conteo final" });
  }
  const id_bodega = scope.can_all_bodegas ? warehouseScope.selected : scope.id_bodega;
  if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[warehouseRow]] = await conn.query(
      `SELECT b.id_bodega, b.nombre_bodega, b.activo, cb.maneja_stock, cb.permite_salida_conteo_final
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );
    if (!warehouseRow || Number(warehouseRow.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega no disponible" });
    }
    if (Number(warehouseRow.maneja_stock || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega seleccionada no maneja stock" });
    }
    if (Number(warehouseRow.permite_salida_conteo_final || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega seleccionada no tiene habilitada la salida por conteo final" });
    }

    const [[motivo]] = await conn.query(
      `SELECT id_motivo, nombre_motivo, tipo_movimiento, activo
       FROM motivos_movimiento
       WHERE tipo_movimiento='AJUSTE'
         AND activo=1
       ORDER BY
         (UPPER(nombre_motivo) LIKE '%CONTEO%') DESC,
         (UPPER(nombre_motivo) LIKE '%INVENTARIO%') DESC,
         id_motivo ASC
       LIMIT 1`
    );
    if (!motivo) {
      await conn.rollback();
      return res.status(400).json({ error: "No existe un motivo activo de AJUSTE para registrar el conteo final" });
    }

    const approval = await verifySensitiveApproval(req, conn, "salida por conteo final");
    if (!approval.ok) {
      await conn.rollback();
      return res.status(Number(approval.status || 403)).json(approval);
    }

    const result = await applyConteoFinalLines(conn, {
      id_bodega,
      lines,
      motivo,
      user: req.user,
      approval,
      observaciones: observaciones || `Salida automatica por conteo final de ${warehouseRow.nombre_bodega || `bodega #${id_bodega}`}`,
    });

    if (!result.appliedLines) {
      await conn.rollback();
      return res.status(400).json({ error: "No hay diferencias para generar salidas" });
    }

    await conn.commit();
    res.json({
      ok: true,
      id_movimiento: result.id_movimiento,
      tipo_movimiento: "AJUSTE",
      direccion: "SALIDA",
      id_bodega,
      total_productos: result.affectedProducts,
      total_salida: result.totalSalida,
      sensitive_approval: toSensitiveApprovalPayload(approval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   BODEGAS (CREAR)
========================= */
app.post("/api/bodegas", auth, requirePermission("action.manage_permissions", "crear bodegas"), async (req, res) => {
  const {
    nombre_bodega,
    tipo_bodega,
    activo = 1,
    maneja_stock = 1,
    puede_recibir = 1,
    puede_despachar = 1,
    modo_despacho_auto = "SALIDA",
    id_bodega_destino_default = null,
    permite_salida_conteo_final = 0,
    requiere_precio_salida = 0,
    telefono_contacto = null,
    direccion_contacto = null,
  } = req.body || {};

  if (!nombre_bodega) return res.status(400).json({ error: "Falta nombre" });
  if (!tipo_bodega) return res.status(400).json({ error: "Falta tipo" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO bodegas (nombre_bodega, tipo_bodega, activo, telefono_contacto, direccion_contacto)
       VALUES (:nombre_bodega, :tipo_bodega, :activo, :telefono_contacto, :direccion_contacto)`,
      {
        nombre_bodega,
        tipo_bodega,
        activo: activo ? 1 : 0,
        telefono_contacto: String(telefono_contacto || "").trim() || null,
        direccion_contacto: String(direccion_contacto || "").trim() || null,
      }
    );
    const id_bodega = r.insertId;

    await conn.query(
      `INSERT INTO configuracion_bodega
       (id_bodega, maneja_stock, puede_recibir, puede_despachar, modo_despacho_auto, id_bodega_destino_default, permite_salida_conteo_final, requiere_precio_salida)
       VALUES (:id_bodega, :maneja_stock, :puede_recibir, :puede_despachar, :modo_despacho_auto, :id_bodega_destino_default, :permite_salida_conteo_final, :requiere_precio_salida)`,
      {
        id_bodega,
        maneja_stock: maneja_stock ? 1 : 0,
        puede_recibir: puede_recibir ? 1 : 0,
        puede_despachar: puede_despachar ? 1 : 0,
        modo_despacho_auto,
        id_bodega_destino_default: id_bodega_destino_default || null,
        permite_salida_conteo_final: permite_salida_conteo_final ? 1 : 0,
        requiere_precio_salida: requiere_precio_salida ? 1 : 0,
      }
    );

    await conn.commit();
    res.json({ ok: true, id_bodega });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   STOCK (solo con stock + no vencido opcional)
========================= */
app.get("/api/stock", auth, async (req, res) => {
  try {
    const id_warehouse = Number(req.query.warehouse || req.user.id_warehouse || 0);
    const onlyWithStock = String(req.query.onlyWithStock || "1") === "1";
    const includeLots = String(req.query.includeLots || "1") === "1";
    const notExpiredOnly = String(req.query.notExpiredOnly || "1") === "1";

    if (!id_warehouse) return res.status(400).json({ error: "Falta bodega" });

    if (includeLots) {
      const [rows] = await pool.query(
        `SELECT v.id_bodega,
                v.id_producto,
                p.nombre_producto,
                p.sku,
                v.lote,
                v.fecha_vencimiento,
                v.stock
         FROM v_stock_por_lote v
         JOIN productos p ON p.id_producto=v.id_producto
         WHERE v.id_bodega=:id_warehouse
           ${onlyWithStock ? "AND v.stock > 0" : ""}
           ${notExpiredOnly ? "AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())" : ""}
         ORDER BY p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC`,
        { id_warehouse }
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT v.id_bodega,
              v.id_producto,
              p.nombre_producto,
              p.sku,
              SUM(v.stock) AS stock
       FROM v_stock_por_lote v
       JOIN productos p ON p.id_producto=v.id_producto
       WHERE v.id_bodega=:id_warehouse
         ${notExpiredOnly ? "AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())" : ""}
       GROUP BY v.id_bodega, v.id_producto, p.nombre_producto, p.sku
       ${onlyWithStock ? "HAVING SUM(v.stock) > 0" : ""}
       ORDER BY p.nombre_producto ASC`,
      { id_warehouse }
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   REPORTE EXISTENCIAS + ALERTAS
========================= */
app.get("/api/reportes/existencias", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.json([]);
  if (!scope.can_all_bodegas && !scope.maneja_stock) return res.json([]);

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
  if (warehouseScope.denied) return res.json([]);
  let id_bodega = warehouseScope.selected;
  if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
  const accessFilter =
    warehouseScope.restrictedIds.length && !id_bodega
      ? buildNamedInClause(warehouseScope.restrictedIds, "rexw")
      : null;

  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "rexq");
  const from_date = String(req.query.from || "").trim() || null;
  const to_date = String(req.query.to || "").trim() || null;
  const id_categoria = Number(req.query.categoria || 0) || null;
  const id_subcategoria = Number(req.query.subcategoria || 0) || null;
  const show_zero = String(req.query.show_zero || "").trim() === "1";
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
  const page = Math.max(1, Number(req.query.page || 1));
  const offset = (page - 1) * limit;

  const existenciasParams = {
    id_bodega,
    from_date,
    to_date,
    id_categoria,
    id_subcategoria,
    ...(accessFilter?.params || {}),
    ...qf.params,
  };

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM v_stock_por_lote v
     JOIN bodegas b ON b.id_bodega=v.id_bodega
     JOIN productos p ON p.id_producto=v.id_producto
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     LEFT JOIN limites_producto_bodega lpb ON lpb.id_producto=v.id_producto AND lpb.id_bodega=v.id_bodega
     WHERE ${show_zero ? "v.stock >= 0" : "v.stock > 0"}
       AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
       AND ${qf.clause}
       AND (:from_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= :from_date)
       AND (:to_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento <= :to_date)
       AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
       AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)`,
    existenciasParams
  );
  const total = Number(countRow?.total || 0);
const [rows] = await pool.query(
    `SELECT v.id_bodega,
            b.nombre_bodega,
            v.id_producto,
            p.nombre_producto,
            p.sku,
            p.id_subcategoria,
            sc.nombre_subcategoria,
            COALESCE(lpb.minimo, 0) AS minimo_stock,
            COALESCE(lpb.maximo, 0) AS maximo_stock,
            v.lote,
            v.fecha_vencimiento,
            v.stock,
            CASE
              WHEN v.fecha_vencimiento IS NULL THEN NULL
              ELSE DATEDIFF(v.fecha_vencimiento, CURDATE())
            END AS dias_para_vencer,
            rs.max_dias_vida,
            rs.dias_alerta_antes,
            v.fecha_entrada_lote,
            CASE
              WHEN v.fecha_entrada_lote IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), v.fecha_entrada_lote)
            END AS dias_en_bodega,
            CASE
              WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR v.fecha_entrada_lote IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), v.fecha_entrada_lote)
            END AS dias_restantes_regla
            ,
            (
              COALESCE(
                (
                  SELECT k2.costo_unitario
                  FROM kardex k2
                  WHERE k2.id_bodega=v.id_bodega
                    AND k2.id_producto=v.id_producto
                    AND (k2.lote <=> v.lote)
                    AND (k2.fecha_vencimiento <=> v.fecha_vencimiento)
                    AND k2.delta_cantidad > 0
                  ORDER BY k2.creado_en DESC
                  LIMIT 1
                ),
                (
                  SELECT k2b.costo_unitario
                  FROM kardex k2b
                  WHERE k2b.id_bodega=v.id_bodega
                    AND k2b.id_producto=v.id_producto
                    AND k2b.delta_cantidad > 0
                  ORDER BY k2b.creado_en DESC
                  LIMIT 1
                ),
                0
              )
            ) AS costo_unitario_ref,
            (
              v.stock * COALESCE(
                (
                  SELECT k3.costo_unitario
                  FROM kardex k3
                  WHERE k3.id_bodega=v.id_bodega
                    AND k3.id_producto=v.id_producto
                    AND (k3.lote <=> v.lote)
                    AND (k3.fecha_vencimiento <=> v.fecha_vencimiento)
                    AND k3.delta_cantidad > 0
                  ORDER BY k3.creado_en DESC
                  LIMIT 1
                ),
                (
                  SELECT k3b.costo_unitario
                  FROM kardex k3b
                  WHERE k3b.id_bodega=v.id_bodega
                    AND k3b.id_producto=v.id_producto
                    AND k3b.delta_cantidad > 0
                  ORDER BY k3b.creado_en DESC
                  LIMIT 1
                ),
                0
              )
            ) AS total_linea
     FROM v_stock_por_lote v
     JOIN bodegas b ON b.id_bodega=v.id_bodega
     JOIN productos p ON p.id_producto=v.id_producto
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     LEFT JOIN limites_producto_bodega lpb
            ON lpb.id_bodega=v.id_bodega
           AND lpb.id_producto=v.id_producto
           AND lpb.activo=1
     LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
     WHERE ${show_zero ? "v.stock >= 0" : "v.stock > 0"}
       AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
       AND ${qf.clause}
       AND (:from_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= :from_date)
       AND (:to_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento <= :to_date)
       AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
       AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
     ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
     LIMIT ${limit} OFFSET ${offset}`,
    { id_bodega, from_date, to_date, id_categoria, id_subcategoria, ...(accessFilter?.params || {}), ...qf.params }
  );
    res.json({
    rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / Math.max(1, limit)),
  });
});

// ── Stock de un producto en la bodega del usuario (para mostrar en formularios) ──
app.get("/api/existencias/producto/:id/stock", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias && !scope.can_all_bodegas && !scope.maneja_stock) {
    return res.status(403).json({ error: "Sin acceso a existencias" });
  }

  const id_producto = Number(req.params.id);
  if (!id_producto) return res.status(400).json({ error: "ID de producto inválido" });

  const id_bodega = scope.can_all_bodegas
    ? (Number(req.query.bodega) || scope.id_bodega)
    : scope.id_bodega;

  const [rows] = await pool.query(
    `SELECT
       COALESCE(SUM(v.stock), 0) AS stock_total,
       COUNT(DISTINCT v.lote) AS lotes
     FROM v_stock_por_lote v
     WHERE v.id_producto = ?
       AND v.id_bodega = ?
       AND v.stock > 0`,
    [id_producto, id_bodega]
  );

  const [limiteRows] = await pool.query(
    `SELECT COALESCE(l.minimo, 0) AS minimo, COALESCE(l.maximo, 0) AS maximo
     FROM limites_producto_bodega l
     WHERE l.id_producto = ? AND l.id_bodega = ?
       AND l.activo = 1`,
    [id_producto, id_bodega]
  );

  // Último precio de entrada (referencia visual para el usuario)
  const [precioRows] = await pool.query(
    `SELECT md.costo_unitario
     FROM movimiento_detalle md
     JOIN movimiento_encabezado me ON me.id_movimiento = md.id_movimiento
     JOIN motivos_movimiento mot ON mot.id_motivo = me.id_motivo
     WHERE md.id_producto = ?
       AND mot.tipo_movimiento = 'ENTRADA'
       AND md.costo_unitario > 0
     ORDER BY me.creado_en DESC
     LIMIT 1`,
    [id_producto]
  );

  res.json({
    stock_total: Number(rows[0]?.stock_total || 0),
    lotes: Number(rows[0]?.lotes || 0),
    minimo: Number(limiteRows[0]?.minimo || 0),
    maximo: Number(limiteRows[0]?.maximo || 0),
    ultimo_precio: Number(precioRows[0]?.costo_unitario || 0),
  });
});

app.get("/api/reportes/existencias/alertas", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.json([]);
  if (!scope.can_all_bodegas && !scope.maneja_stock) return res.json([]);

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
  if (warehouseScope.denied) return res.json([]);
  let id_bodega = warehouseScope.selected;
  if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
  const accessFilter =
    warehouseScope.restrictedIds.length && !id_bodega
      ? buildNamedInClause(warehouseScope.restrictedIds, "realw")
      : null;

  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "realq");
  const from_date = String(req.query.from || "").trim() || null;
  const to_date = String(req.query.to || "").trim() || null;
  const id_categoria = Number(req.query.categoria || 0) || null;
  const id_subcategoria = Number(req.query.subcategoria || 0) || null;
  const show_zero = String(req.query.show_zero || "").trim() === "1";
  const days = Math.max(1, Math.min(365, Number(req.query.days || 15)));
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

  const [rows] = await pool.query(
    `SELECT v.id_bodega,
            b.nombre_bodega,
            v.id_producto,
            p.nombre_producto,
            p.sku,
            p.id_subcategoria,
            sc.nombre_subcategoria,
            v.lote,
            v.fecha_vencimiento,
            v.stock,
            DATEDIFF(v.fecha_vencimiento, CURDATE()) AS dias_para_vencer,
            rs.max_dias_vida,
            rs.dias_alerta_antes,
            v.fecha_entrada_lote,
            CASE
              WHEN v.fecha_entrada_lote IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), v.fecha_entrada_lote)
            END AS dias_en_bodega,
            CASE
              WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR v.fecha_entrada_lote IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), v.fecha_entrada_lote)
            END AS dias_restantes_regla
     FROM v_stock_por_lote v
     JOIN bodegas b ON b.id_bodega=v.id_bodega
     JOIN productos p ON p.id_producto=v.id_producto
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
     WHERE ${show_zero ? "v.stock >= 0" : "v.stock > 0"}
       AND (
         (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) <= :days)
         OR (
           COALESCE(rs.max_dias_vida,0) > 0
           AND v.fecha_entrada_lote IS NOT NULL
           AND (rs.max_dias_vida - DATEDIFF(CURDATE(), v.fecha_entrada_lote)) <= GREATEST(COALESCE(rs.dias_alerta_antes,0),0)
         )
       )
       AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
       AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
       AND ${qf.clause}
       AND (:from_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= :from_date)
       AND (:to_date IS NULL OR v.fecha_vencimiento IS NULL OR v.fecha_vencimiento <= :to_date)
       AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
       AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
     ORDER BY DATEDIFF(v.fecha_vencimiento, CURDATE()) ASC, b.nombre_bodega ASC, p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, from_date, to_date, days, id_categoria, id_subcategoria, ...(accessFilter?.params || {}), ...qf.params }
  );
  res.json(rows);
});

// ── Alertas de stock mínimo (productos por debajo del mínimo configurado) ──
app.get("/api/reportes/existencias/stock-minimo", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.json([]);

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
  if (warehouseScope.denied) return res.json([]);
  let id_bodega = warehouseScope.selected;
  if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
  const accessFilter =
    warehouseScope.restrictedIds.length && !id_bodega
      ? buildNamedInClause(warehouseScope.restrictedIds, "mins")
      : null;

  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "minsq");
  const id_categoria = Number(req.query.categoria || 0) || null;
  const id_subcategoria = Number(req.query.subcategoria || 0) || null;
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

  try {
    const [rows] = await pool.query(
      `SELECT v.id_bodega,
              b.nombre_bodega,
              v.id_producto,
              p.nombre_producto,
              p.sku,
              v.stock,
              l.minimo,
              l.maximo,
              (l.minimo - v.stock) AS diferencia_minimo
       FROM v_stock_resumen v
       JOIN bodegas b ON b.id_bodega=v.id_bodega
       JOIN productos p ON p.id_producto=v.id_producto
       JOIN limites_producto_bodega l ON l.id_bodega=v.id_bodega AND l.id_producto=v.id_producto
       WHERE l.activo=1
         AND l.minimo > 0
         AND v.stock < l.minimo
         AND ${accessFilter ? `v.id_bodega IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
         AND ${qf.clause}
         AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)
       ORDER BY (l.minimo - v.stock) DESC, b.nombre_bodega ASC, p.nombre_producto ASC
       LIMIT ${limit}`,
      {
        id_bodega,
        id_categoria,
        id_subcategoria,
        ...(accessFilter?.params || {}),
        ...qf.params,
      }
    );
    res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/corte-diario", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

  const queryDate = String(req.query.fecha || "").trim();
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(queryDate);
  const targetDate = isValidDate ? queryDate : localYmd(new Date());

  const targetDateObj = new Date(targetDate + "T12:00:00");
  const yesterdayObj = new Date(targetDateObj.getTime() - 24 * 60 * 60 * 1000);
  const fecha_ayer = localYmd(yesterdayObj);
  const fecha_hoy = targetDate;

  if (!scope.can_view_existencias) {
    return res.json({
      bodega: null,
      fecha_ayer,
      fecha_hoy,
      rows: [],
    });
  }

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse, { fallbackToDefault: true });
  if (warehouseScope.denied || !warehouseScope.selected) {
    return res.json({
      bodega: null,
      fecha_ayer,
      fecha_hoy,
      rows: [],
    });
  }
  const id_bodega = warehouseScope.selected;
  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "rcdq");
  const show_all = String(req.query.show_all || "") === "1" ? 1 : 0;
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 1000)));

  const [[bod]] = await pool.query(
    `SELECT b.nombre_bodega, COALESCE(cb.permite_salida_conteo_final, 0) AS permite_salida_conteo_final
     FROM bodegas b
     LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
     WHERE b.id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );

  const [rows] = await pool.query(
    `SELECT p.id_producto,
            p.nombre_producto,
            p.sku,
            COALESCE(SUM(CASE WHEN k.creado_en < :target_date THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
            COALESCE(SUM(CASE WHEN k.creado_en >= :target_date AND k.creado_en < :next_date AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
            COALESCE(SUM(CASE WHEN k.creado_en >= :target_date AND k.creado_en < :next_date AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
            COALESCE(SUM(CASE WHEN k.creado_en < :next_date THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual
     FROM productos p
     LEFT JOIN (
       SELECT k.*
       FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento AND me.estado<>'ANULADO'
     ) k
       ON k.id_producto=p.id_producto
      AND k.id_bodega=:id_bodega
     WHERE p.activo=1
       AND ${qf.clause}
     GROUP BY p.id_producto, p.nombre_producto, p.sku
     HAVING (:show_all=1
             OR ABS(existencia_ayer) > 0
             OR ABS(entradas_hoy) > 0
             OR ABS(existencia_actual) > 0)
     ORDER BY p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, show_all, target_date: targetDate, next_date: addDaysYmd(targetDate, 1), ...qf.params }
  );

  res.json({
    bodega: bod?.nombre_bodega || `Bodega #${id_bodega}`,
    permite_salida_conteo_final: Number(bod?.permite_salida_conteo_final || 0) === 1,
    fecha_ayer,
    fecha_hoy,
    rows,
  });
});

function isCuadreAllWarehousesRoleName(roleName) {
  const n = String(roleName || "").trim().toUpperCase();
  return n.includes("ADMIN") || n.includes("REPORTE");
}

async function resolveCuadreScope(user) {
  const id_usuario = Number(user?.id_user || 0);
  const id_rol = Number(user?.id_role || 0);
  const id_bodega_usuario = Number(user?.id_warehouse || 0) || null;

  let roleName = "";
  if (id_rol > 0) {
    const [[roleRow]] = await pool.query(
      `SELECT nombre_rol
       FROM roles
       WHERE id_rol=:id_rol
       LIMIT 1`,
      { id_rol }
    );
    roleName = String(roleRow?.nombre_rol || "").trim();
  }

  const can_all_bodegas = isCuadreAllWarehousesRoleName(roleName);

  const [bodegas] = await pool.query(
    `SELECT id_bodega, nombre_bodega
     FROM bodegas
     WHERE activo=1
     ORDER BY nombre_bodega ASC`
  );
  const rows = Array.isArray(bodegas) ? bodegas : [];
  const ids = rows.map((b) => Number(b.id_bodega || 0)).filter((x) => x > 0);

  const id_bodega_default = id_bodega_usuario && ids.includes(id_bodega_usuario)
    ? id_bodega_usuario
    : (ids[0] || null);

  if (!can_all_bodegas) {
    if (id_bodega_usuario && ids.includes(id_bodega_usuario)) {
      return {
        id_usuario,
        can_all_bodegas,
        id_bodega_default,
        allowed_ids: [id_bodega_usuario],
        bodegas: rows.filter((b) => Number(b.id_bodega || 0) === id_bodega_usuario),
      };
    }
    return {
      id_usuario,
      can_all_bodegas,
      id_bodega_default: null,
      allowed_ids: [],
      bodegas: [],
    };
  }

  return {
    id_usuario,
    can_all_bodegas,
    id_bodega_default,
    allowed_ids: ids,
    bodegas: rows,
  };
}

app.get("/api/cuadre-caja/context", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    return res.json({
      ok: true,
      can_all_bodegas: scope.can_all_bodegas,
      id_bodega_default: scope.id_bodega_default,
      bodegas: scope.bodegas || [],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver reporte de cuadres de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    const fechaRaw = String(req.query.fecha || "").trim();
    const fecha = normalizeYmdInput(fechaRaw);
    const responsable = String(req.query.responsable || "").trim();
    const requested = Number(req.query.warehouse || 0) || 0;
    const limit = Math.max(1, Math.min(300, Number(req.query.limit || 200)));

    if (fechaRaw && !fecha) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }

    let warehouseFilter = null;
    if (scope.can_all_bodegas) {
      warehouseFilter = requested > 0 ? requested : null;
    } else {
      const allowedId = Number(scope.allowed_ids?.[0] || 0);
      if (!allowedId) return res.json({ ok: true, rows: [] });
      if (requested > 0 && requested !== allowedId) {
        return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
      }
      warehouseFilter = allowedId;
    }

    const params = { limit };
    const where = [];
    if (fecha) {
      where.push('cc.fecha=:fecha');
      params['fecha'] = fecha;
    }
    if (warehouseFilter) {
      where.push('cc.id_bodega=:id_bodega');
      params['id_bodega'] = warehouseFilter;
    }
    if (responsable) {
      where.push('cc.responsable LIKE :responsable');
      params['responsable'] = `%${responsable}%`;
    }

    const sql = `SELECT cc.fecha,
                        cc.id_bodega,
                        b.nombre_bodega,
                        cc.sede,
                        cc.responsable,
                        cc.total_efectivo,
                        cc.total_cobro,
                        cc.total_venta_ambiente,
                        cc.gran_total_reporte,
                        cc.actualizado_en
                 FROM cuadre_caja cc
                 INNER JOIN bodegas b ON b.id_bodega=cc.id_bodega
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY cc.fecha DESC, cc.actualizado_en DESC
                 LIMIT :limit`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, rows: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "ver modulo cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);

    const fechaSource = req.method === "POST" ? (req.body?.fecha || req.query.fecha) : req.query.fecha;
    const fechaRaw = String(fechaSource || "").trim();
    const fecha = normalizeYmdInput(fechaRaw) || ymd(new Date()) || "";
    if (fechaRaw && !fecha) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }

    const warehouseSource = req.method === "POST" ? (req.body?.warehouse || req.query.warehouse) : req.query.warehouse;
    const requested = Number(warehouseSource || 0) || 0;
    const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
    if (!id_bodega) return res.status(400).json({ error: "No hay bodega disponible para el usuario" });

    if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
      return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
    }

    const [[bod]] = await pool.query(
      `SELECT nombre_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );

    const [[row]] = await pool.query(
      `SELECT id_cuadre,
              fecha,
              id_bodega,
              sede,
              responsable,
              payload_json,
              total_efectivo,
              total_cobro,
              total_venta_ambiente,
              gran_total_reporte,
              creado_en,
              actualizado_en
       FROM cuadre_caja
       WHERE fecha=:fecha
         AND id_bodega=:id_bodega
       LIMIT 1`,
      { fecha, id_bodega }
    );

    let parsedPayload = {};
    if (row?.payload_json) {
      try {
        parsedPayload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        parsedPayload = {};
      }
    }

    const normalized = normalizeCuadrePayload(parsedPayload, {
      sede: row?.sede || "",
      responsable: row?.responsable || "",
    });

    return res.json({
      ok: true,
      fecha,
      id_bodega,
      bodega: bod?.nombre_bodega || `Bodega #${id_bodega}`,
      exists: Boolean(row?.id_cuadre),
      id_cuadre: Number(row?.id_cuadre || 0) || null,
      payload: normalized.payload,
      totals: {
        total_efectivo: Number(row?.total_efectivo ?? normalized.total_efectivo ?? 0),
        total_cobro: Number(row?.total_cobro ?? normalized.total_cobro ?? 0),
        total_venta_ambiente: Number(row?.total_venta_ambiente ?? normalized.total_venta_ambiente ?? 0),
        gran_total_reporte: Number(row?.gran_total_reporte ?? normalized.gran_total_reporte ?? 0),
      },
      creado_en: row?.creado_en || null,
      actualizado_en: row?.actualizado_en || null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post(
  "/api/cuadre-caja",
  auth,
  requirePermission("section.view.cuadre-caja", "usar modulo cuadre de caja"),
  requirePermission("action.create_update", "guardar cuadre de caja"),
  async (req, res) => {
    try {
      const scope = await resolveCuadreScope(req.user);
      const fechaRaw = String(req.body?.fecha || "").trim();
      const fecha = normalizeYmdInput(fechaRaw);
      if (!fecha) {
        return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
      }

      const requested = Number(req.body?.id_bodega || 0) || 0;
      const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
      if (!id_bodega) return res.status(400).json({ error: "No hay bodega disponible para el usuario" });

      if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
        return res.status(403).json({ error: "Sin acceso a la bodega solicitada" });
      }

      const normalized = normalizeCuadrePayload(req.body?.payload || {});
      const actor = Number(req.user?.id_user || 0) || null;

      await pool.query(
        `INSERT INTO cuadre_caja
          (fecha, id_bodega, sede, responsable, payload_json, total_efectivo, total_cobro, total_venta_ambiente, gran_total_reporte, creado_por, actualizado_por)
         VALUES
          (:fecha, :id_bodega, :sede, :responsable, :payload_json, :total_efectivo, :total_cobro, :total_venta_ambiente, :gran_total_reporte, :actor, :actor)
         ON DUPLICATE KEY UPDATE
          sede=VALUES(sede),
          responsable=VALUES(responsable),
          payload_json=VALUES(payload_json),
          total_efectivo=VALUES(total_efectivo),
          total_cobro=VALUES(total_cobro),
          total_venta_ambiente=VALUES(total_venta_ambiente),
          gran_total_reporte=VALUES(gran_total_reporte),
          actualizado_por=VALUES(actualizado_por),
          actualizado_en=CURRENT_TIMESTAMP`,
        {
          fecha,
          id_bodega,
          sede: normalized.payload.sede || null,
          responsable: normalized.payload.responsable || null,
          payload_json: JSON.stringify(normalized.payload || {}),
          total_efectivo: normalized.total_efectivo,
          total_cobro: normalized.total_cobro,
          total_venta_ambiente: normalized.total_venta_ambiente,
          gran_total_reporte: normalized.gran_total_reporte,
          actor,
        }
      );

      return res.json({
        ok: true,
        fecha,
        id_bodega,
        payload: normalized.payload,
        totals: {
          total_efectivo: normalized.total_efectivo,
          total_cobro: normalized.total_cobro,
          total_venta_ambiente: normalized.total_venta_ambiente,
          gran_total_reporte: normalized.gran_total_reporte,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }
);
app.all("/api/print/cuadre-caja", auth, requirePermission("section.view.cuadre-caja", "imprimir cuadre de caja"), async (req, res) => {
  try {
    const scope = await resolveCuadreScope(req.user);
    const fechaSource = req.method === "POST" ? (req.body?.fecha || req.query.fecha) : req.query.fecha;
    const fechaRaw = String(fechaSource || "").trim();
    const fecha = normalizeYmdInput(fechaRaw) || ymd(new Date()) || "";
    if (fechaRaw && !fecha) {
      return res.status(400).send("Fecha invalida. Formato esperado: YYYY-MM-DD");
    }

    const warehouseSource = req.method === "POST" ? (req.body?.warehouse || req.query.warehouse) : req.query.warehouse;
    const requested = Number(warehouseSource || 0) || 0;
    const id_bodega = requested > 0 ? requested : Number(scope.id_bodega_default || 0);
    if (!id_bodega) return res.status(400).send("No hay bodega disponible para el usuario");
    if (!scope.can_all_bodegas && !scope.allowed_ids.includes(id_bodega)) {
      return res.status(403).send("Sin acceso a la bodega solicitada");
    }

    const formatSource = req.method === "POST" ? (req.body?.format || req.query.format) : req.query.format;
    const formatRaw = String(formatSource || "carta").trim().toLowerCase();
    const format = formatRaw === "pos" ? "pos" : "carta";
    const payloadOverrideRaw = req.method === "POST"
      ? String(req.body?.payload_override || "").trim()
      : String(req.query.payload_override || "").trim();

    const [[bod]] = await pool.query(
      `SELECT nombre_bodega
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega }
    );

    const [[row]] = await pool.query(
      `SELECT id_cuadre,
              sede,
              responsable,
              payload_json,
              total_efectivo,
              total_cobro,
              total_venta_ambiente,
              gran_total_reporte,
              actualizado_en
       FROM cuadre_caja
       WHERE fecha=:fecha
         AND id_bodega=:id_bodega
       LIMIT 1`,
      { fecha, id_bodega }
    );

    let parsedPayload = {};
    if (row?.payload_json) {
      try {
        parsedPayload = JSON.parse(String(row.payload_json || "{}"));
      } catch {
        parsedPayload = {};
      }
    }

    let payloadOverride = null;
    if (payloadOverrideRaw) {
      try {
        const parsed = JSON.parse(payloadOverrideRaw);
        if (parsed && typeof parsed === "object") payloadOverride = parsed;
      } catch {}
    }

    const normalized = normalizeCuadrePayload(payloadOverride || parsedPayload, {
      sede: row?.sede || bod?.nombre_bodega || "",
      responsable: row?.responsable || "",
      payload_json: parsedPayload,
    });

    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const fmtMoney = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQty = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

    const p = normalized.payload || {};
    const monedas = p.monedas || {};
    const pagos = p.pagos || {};
    const ventas = p.ventas || {};
    const ventasRows = Array.isArray(p.ventas_rows) && p.ventas_rows.length
      ? p.ventas_rows
      : [
          { ambiente: "Flor de Cafe", monto: Number(ventas.flor_cafe || 0) },
          { ambiente: "Restaurante", monto: Number(ventas.restaurante || 0) },
          { ambiente: "Nilas", monto: Number(ventas.nilas || 0) },
          { ambiente: "ElDeck", monto: Number(ventas.eldeck || 0) },
          { ambiente: "Cactus", monto: Number(ventas.cactus || 0) },
          { ambiente: "Gelato", monto: Number(ventas.gelato || 0) },
          { ambiente: "Jazmin", monto: Number(ventas.jazmin || 0) },
        ];
    const extras = p.extras || {};
    const detalle = Array.isArray(p.detalle) ? p.detalle : [];
    const logoSrc = await getWarehouseLogoDataUri(id_bodega);

    const baseCss = format === "pos"
      ? `
        @page { size: 80mm auto; margin: 2mm; }
        body {
          width: auto;
          margin: 0;
          padding: 0 3mm 0 3mm;
          font-family: "DejaVu Sans Mono", "Consolas", "Lucida Console", monospace;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.25;
          color: #000;
          -webkit-font-smoothing: none;
          text-rendering: geometricPrecision;
        }
        h1 { font-size: 14px; margin: 2px 0 3px; text-align: center; text-transform: uppercase; letter-spacing: .5px; }
        .meta { text-align: center; font-size: 10px; margin-bottom: 4px; line-height: 1.2; }
        .line { width: 100%; border: none; border-top: 1px solid #333; margin: 4px 0; }
        .line-dash { width: 100%; border: none; border-top: 1px dashed #888; margin: 3px 0; }
        table { width: 100%; border-collapse: collapse; margin: 3px 0; }
        td { padding: 1px 1px 1px 2px; vertical-align: bottom; }
        td.n { text-align: right; white-space: nowrap; padding-right: 1px; width: 30%; }
        td.v { text-align: right; white-space: nowrap; width: 28%; }
        .sect { font-weight: 700; font-size: 11px; margin: 5px 0 1px; padding: 2px 0 1px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; text-transform: uppercase; letter-spacing: .3px; }
        .tot { font-weight: 700; border-top: 1px solid #000; }
        .tot td { padding-top: 2px; }
        .sub { font-size: 10px; color: #333; }
        .logo { display:block; margin:0 auto 2px; max-width:42mm; max-height:14mm; }
      `
      : `
        @page { size: A4 portrait; margin: 10mm; }
        body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
        h1 { font-size: 20px; margin: 6px 0 2px; text-align: center; }
        .meta { text-align: center; font-size: 12px; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d8d8d8; padding: 5px 6px; vertical-align: top; }
        th { background:#f4f4f4; text-align:left; }
        td.n { text-align: right; white-space: nowrap; }
        .section { margin-top: 12px; font-weight: bold; }
        .tot { font-weight: bold; background:#f9f9f9; }
        .logo { display:block; margin:0 auto 8px; max-width:130px; max-height:56px; }
      `;

    const hasDetalle = detalle.length > 0;
    const html = format === 'pos'
      ? `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cuadre de caja</title>
  <style>${baseCss}</style>
</head>
<body>
  <img class="logo" src="${logoSrc}" alt="Logo" />
  <h1>Cuadre de Caja</h1>
  <div class="meta">${esc(p.sede || bod?.nombre_bodega || "-")}<br/>${esc(dmy(fecha))} · ${esc(p.responsable || "-")}</div>

  <hr class="line"/>

  <div class="sect">Efectivo</div>
  <table>    ${CUADRE_DENOMINACIONES
        .filter((d) => Number(monedas[String(d)] || 0) > 0)
        .map((d) => {
          const qty = Number(monedas[String(d)]);
          return `<tr><td>Q ${fmtMoney(d)} x ${fmtQty(qty)}</td><td class="n">Q ${fmtMoney(qty * d)}</td></tr>`;
        }).join("")}
    ${(() => {
      const dc = Number(pagos.dolares_cantidad || 0);
      if (!dc) return '';
      return `<tr><td>$${fmtQty(dc)} Dolares (TC ${fmtMoney(CUADRE_DOLAR_TIPO_CAMBIO)})</td><td class="n">Q ${fmtMoney(dc * CUADRE_DOLAR_TIPO_CAMBIO)}</td></tr>`;
    })()}
    <tr class="tot"><td>Total Efectivo</td><td class="n">Q ${fmtMoney(normalized.total_efectivo)}</td></tr>
  </table>

  <hr class="line-dash"/>

  <div class="sect">Pagos</div>
  <table>
    ${(() => {
      const pLines = [];
      if (Number(pagos.visa || 0)) pLines.push(`<tr><td>Visa</td><td class="n">Q ${fmtMoney(pagos.visa)}</td></tr>`);
      if (Number(pagos.bancos || 0)) pLines.push(`<tr><td>Bancos</td><td class="n">Q ${fmtMoney(pagos.bancos)}</td></tr>`);
      if (Number(pagos.cxc_trabajadores || 0)) pLines.push(`<tr><td>CxC Trabajadores</td><td class="n">Q ${fmtMoney(pagos.cxc_trabajadores)}</td></tr>`);
      if (Number(pagos.cxc_habitaciones || 0)) pLines.push(`<tr><td>CxC Habitaciones</td><td class="n">Q ${fmtMoney(pagos.cxc_habitaciones)}</td></tr>`);
      if (Number(pagos.pase_consumible || 0)) pLines.push(`<tr><td>Pase Consumible</td><td class="n">Q ${fmtMoney(pagos.pase_consumible)}</td></tr>`);
      if (!pLines.length) pLines.push('<tr><td class="sub">Sin movimientos</td><td></td></tr>');
      return pLines.join('');
    })()}
    <tr class="tot"><td>Total Cobro</td><td class="n">Q ${fmtMoney(normalized.total_cobro)}</td></tr>
  </table>

  <hr class="line-dash"/>

  <div class="sect">Ventas por Ambiente</div>
  <table>
    ${ventasRows
      .filter((r) => Number(r.monto || 0) > 0)
      .map((r) => `<tr><td>${esc(r.ambiente || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td></tr>`)
      .join("")}
    <tr class="tot"><td>Total Ventas</td><td class="n">Q ${fmtMoney(normalized.total_venta_ambiente)}</td></tr>
  </table>

  <hr class="line-dash"/>

  <div class="sect">Extras</div>
  <table>
    ${(() => {
      const eLines = [];
      if (Number(extras.pedidos_nilas || 0)) eLines.push(`<tr><td>Pedidos Nilas</td><td class="n">Q ${fmtMoney(extras.pedidos_nilas)}</td></tr>`);
      if (Number(extras.cortesias || 0)) eLines.push(`<tr><td>Cortesias</td><td class="n">Q ${fmtMoney(extras.cortesias)}</td></tr>`);
      if (!eLines.length) eLines.push('<tr><td class="sub">Sin extras</td><td></td></tr>');
      return eLines.join('');
    })()}
  </table>

  ${hasDetalle ? `
  <hr class="line-dash"/>
  <div class="sect">Detalle</div>
  <table>
    ${detalle
      .filter((r) => Number(r.monto || 0) > 0)
      .map((r) => `<tr><td>${esc(r.descripcion || "")}${r.nombre ? ' - '+esc(r.nombre) : ''}${r.check_no ? ' #'+esc(r.check_no) : ''}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td></tr>`)
      .join("")}
  </table>
  ` : ''}

  <hr class="line"/>

  <table>
    <tr class="tot"><td>GRAN TOTAL</td><td class="n">Q ${fmtMoney(normalized.gran_total_reporte)}</td></tr>
  </table>

  <hr class="line"/>

  <div class="meta sub" style="margin-top:3px">${esc(payloadOverride ? 'Vista previa' : (row?.actualizado_en ? 'Actualizado: '+String(row.actualizado_en).slice(0,16).replace('T',' ') : ''))}</div>
  <div class="meta sub">Sistema de Inventario</div>
  <script>window.print()</script>
</body>
</html>`
      : `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Cuadre de caja</title>
  <style>${baseCss}</style>
</head>
<body>
  <img class="logo" src="${logoSrc}" alt="Logo" />
  <h1>Cuadre de Caja</h1>
  <div class="meta">${esc(p.sede || bod?.nombre_bodega || "-")} | Fecha: ${esc(dmy(fecha))} | Responsable: ${esc(p.responsable || "-")}</div>

  <div class="section">Efectivo por denominacion</div>
  <table>
    <thead><tr><th>Cantidad</th><th>Detalle</th><th class="n">Total</th></tr></thead>
    <tbody>
      ${CUADRE_DENOMINACIONES.map((d) => {
        const key = String(d);
        const qty = Number(monedas[key] || 0);
        const line = qty * Number(d);
        return `<tr><td>${fmtQty(qty)}</td><td>Q ${fmtMoney(d)}</td><td class="n">Q ${fmtMoney(line)}</td></tr>`;
      }).join("")}
      <tr><td>${fmtQty(pagos.dolares_cantidad || 0)}</td><td>$ ${fmtMoney(CUADRE_DOLAR_DENOM_USD)} x Q ${fmtMoney(CUADRE_DOLAR_TIPO_CAMBIO)}</td><td class="n">$ ${fmtMoney(pagos.dolares_total || 0)}</td></tr>
      <tr><td colspan="2">Dolares a quetzales</td><td class="n">Q ${fmtMoney(pagos.dolares_quetzales || 0)}</td></tr>
      <tr class="tot"><td colspan="2">Total efectivo</td><td class="n">Q ${fmtMoney(normalized.total_efectivo)}</td></tr>
      <tr><td colspan="2">Visa</td><td class="n">Q ${fmtMoney(pagos.visa || 0)}</td></tr>
      <tr><td colspan="2">Bancos</td><td class="n">Q ${fmtMoney(pagos.bancos || 0)}</td></tr>
      <tr><td colspan="2">CXC Trabajadores</td><td class="n">Q ${fmtMoney(pagos.cxc_trabajadores || 0)}</td></tr>
      <tr><td colspan="2">CXC Habitaciones</td><td class="n">Q ${fmtMoney(pagos.cxc_habitaciones || 0)}</td></tr>
      <tr><td colspan="2">PASE CONSUMIBLE</td><td class="n">Q ${fmtMoney(pagos.pase_consumible || 0)}</td></tr>
      <tr class="tot"><td colspan="2">TOTAL COBRO</td><td class="n">Q ${fmtMoney(normalized.total_cobro)}</td></tr>
    </tbody>
  </table>

  <div class="section">Ventas por ambiente</div>
  <table>
    <tbody>
      ${ventasRows
        .map((r) => `<tr><td>${esc(r.ambiente || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td></tr>`)
        .join("")}
      <tr class="tot"><td>TOTAL VENTA POR AMBIENTE</td><td class="n">Q ${fmtMoney(normalized.total_venta_ambiente)}</td></tr>
      <tr><td>Pedidos Nilas</td><td class="n">Q ${fmtMoney(extras.pedidos_nilas || 0)}</td></tr>
      <tr><td>Cortesias</td><td class="n">Q ${fmtMoney(extras.cortesias || 0)}</td></tr>
      <tr class="tot"><td>GRAN TOTAL DE REPORTE</td><td class="n">Q ${fmtMoney(normalized.gran_total_reporte)}</td></tr>
    </tbody>
  </table>

  <div class="section">Detalle funcionarios / cortesia</div>
  <table>
    <thead><tr><th>Descrip</th><th>Nombre</th><th class="n">Monto</th><th>Check</th></tr></thead>
    <tbody>
      ${detalle.length
        ? detalle
            .map((r) => `<tr><td>${esc(r.descripcion || "")}</td><td>${esc(r.nombre || "")}</td><td class="n">Q ${fmtMoney(r.monto || 0)}</td><td>${esc(r.check_no || "")}</td></tr>`)
            .join("")
        : `<tr><td colspan="4">Sin detalle</td></tr>`}
    </tbody>
  </table>

  <div class="meta" style="margin-top:8px">Actualizado: ${esc(payloadOverride ? "Vista previa actual" : (row?.actualizado_en ? String(row.actualizado_en) : "-"))}</div>
  <script>window.print()</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    return res.status(500).send(String(e.message || e));
  }
});
app.get("/api/print/corte-diario", auth, async (req, res) => {
  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).send("Usuario sin bodega");
  if (!scope.can_view_existencias) return res.status(403).send("Sin permiso");

  const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse, { fallbackToDefault: true });
  if (warehouseScope.denied || !warehouseScope.selected) return res.status(403).send("Sin permiso");
  const id_bodega = warehouseScope.selected;
  const printFormat = String(req.query.format || "carta").trim().toLowerCase() === "pos80" ? "pos80" : "carta";
  // Fecha del corte a imprimir. Si no se pasa, usa hoy.
  // Acepta YYYY-MM-DD. Si es inválida, cae a hoy.
  const fechaRaw = String(req.query.fecha || "").trim();
  const fechaCorte = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : null;
  const qRaw = String(req.query.q || "").trim();
  const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "pcdq");
  const show_all = String(req.query.show_all || "") === "1" ? 1 : 0;
  const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 2000)));

  const [[bod]] = await pool.query(
    `SELECT nombre_bodega
     FROM bodegas
     WHERE id_bodega=:id_bodega
     LIMIT 1`,
    { id_bodega }
  );

  // Helpers locales (no se pueden traer de otros endpoints, son scope local)
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Construimos la expresión de la fecha objetivo (CURDATE() si no se pasa).
  // Usamos DATE(k.creado_en) para que la comparación sea por día, no por timestamp.
  const fechaExpr = fechaCorte ? "DATE(:fecha_corte)" : "CURDATE()";

  const [rows] = await pool.query(
    `SELECT p.nombre_producto,
            p.sku,
            COALESCE(SUM(CASE WHEN k.creado_en < ${fechaExpr} THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
            COALESCE(SUM(CASE WHEN k.creado_en >= ${fechaExpr} AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
            COALESCE(SUM(CASE WHEN k.creado_en >= ${fechaExpr} AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
            COALESCE(SUM(k.delta_cantidad), 0) AS existencia_actual
     FROM productos p
     LEFT JOIN (
       SELECT k.*
       FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento AND me.estado<>'ANULADO'
     ) k
       ON k.id_producto=p.id_producto
      AND k.id_bodega=:id_bodega
     WHERE p.activo=1
       AND ${qf.clause}
     GROUP BY p.id_producto, p.nombre_producto, p.sku
     HAVING (:show_all=1
             OR ABS(existencia_ayer) > 0
             OR ABS(entradas_hoy) > 0
             OR ABS(salidas_hoy) > 0
             OR ABS(existencia_actual) > 0)
     ORDER BY p.nombre_producto ASC
     LIMIT ${limit}`,
    { id_bodega, show_all, fecha_corte: fechaCorte, ...qf.params }
  );

  const fmtDate = (d) => {
    if (!d) return "";
    try {
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return "";
      const dd = String(dt.getDate()).padStart(2, "0");
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    } catch {
      return "";
    }
  };
  const fmtQty = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const totalAyer = rows.reduce((a, x) => a + Number(x.existencia_ayer || 0), 0);
  const totalEnt = rows.reduce((a, x) => a + Number(x.entradas_hoy || 0), 0);
  const totalSal = rows.reduce((a, x) => a + Number(x.salidas_hoy || 0), 0);
  const totalAct = rows.reduce((a, x) => a + Number(x.existencia_actual || 0), 0);
  const logoSrc = await getWarehouseLogoDataUri(id_bodega);
  const isPos80 = printFormat === "pos80";
  const summaryHtml = isPos80
    ? `
    <div class="ticketSummary">
      <div class="ticketSummaryRow"><span>Existencia ayer</span><b>${fmtQty(totalAyer)}</b></div>
      <div class="ticketSummaryRow"><span>Entradas hoy</span><b>${fmtQty(totalEnt)}</b></div>
      <div class="ticketSummaryRow"><span>Salidas hoy</span><b>${fmtQty(totalSal)}</b></div>
      <div class="ticketSummaryRow"><span>Existencia actual</span><b>${fmtQty(totalAct)}</b></div>
    </div>
  `
    : `
    <div class="resume">
      <span>Existencia ayer: <b>${fmtQty(totalAyer)}</b></span>
      <span>Entradas hoy: <b>${fmtQty(totalEnt)}</b></span>
      <span>Salidas hoy: <b>${fmtQty(totalSal)}</b></span>
      <span>Existencia actual: <b>${fmtQty(totalAct)}</b></span>
    </div>
  `;
  const rowsHtml = isPos80
    ? `
      <div class="ticketSectionTitle">Detalle de productos</div>
      ${rows
        .map(
          (x) => `
        <div class="ticketItem">
          <div class="ticketItemName">${x.nombre_producto || ""}</div>
          <div class="ticketItemSku">SKU: ${x.sku || ""}</div>
          <div class="ticketQtyGrid">
            <div class="ticketMetric"><span>Ayer</span><b>${fmtQty(x.existencia_ayer)}</b></div>
            <div class="ticketMetric"><span>Entradas</span><b>${fmtQty(x.entradas_hoy)}</b></div>
            <div class="ticketMetric"><span>Salidas</span><b>${fmtQty(x.salidas_hoy)}</b></div>
            <div class="ticketMetric"><span>Actual</span><b>${fmtQty(x.existencia_actual)}</b></div>
          </div>
        </div>
      `
        )
        .join("")}
    `
    : `
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>SKU</th>
            <th>Existencia ayer</th>
            <th>Entradas hoy</th>
            <th>Salidas hoy</th>
            <th>Existencia actual</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (x) => `
            <tr>
              <td>${x.nombre_producto || ""}</td>
              <td>${x.sku || ""}</td>
              <td class="n">${fmtQty(x.existencia_ayer)}</td>
              <td class="n">${fmtQty(x.entradas_hoy)}</td>
              <td class="n">${fmtQty(x.salidas_hoy)}</td>
              <td class="n">${fmtQty(x.existencia_actual)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;

  const html = `
<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Corte diario — ${esc(fechaCorte || new Date().toISOString().slice(0,10))}</title>
<style>
  *{box-sizing:border-box;}
  body{
    font-family: Arial, sans-serif;
    padding:${isPos80 ? "4px" : "16px"};
    margin:0;
    color:#111;
    background:${isPos80 ? "#fff" : "#fff"};
    font-variant-numeric:tabular-nums;
  }
  .page{width:${isPos80 ? "76mm" : "100%"}; margin:0 auto;}
  .headLogo{display:block; margin:0 auto ${isPos80 ? "6px" : "10px"}; max-height:${isPos80 ? "15mm" : "64px"}; width:auto; max-width:100%; object-fit:contain;}
  .headTitle{margin:4px 0 0; text-align:center; font-size:${isPos80 ? "15px" : "22px"}; line-height:1.15;}
  .muted{color:#666; font-size:${isPos80 ? "9px" : "12px"}; text-align:center; margin-top:4px; line-height:1.25;}
  table{width:100%; border-collapse:collapse; margin-top:12px;}
  th,td{border:1px solid #ddd; padding:${isPos80 ? "3px 4px" : "4px 6px"}; font-size:${isPos80 ? "9px" : "11px"}; line-height:1.2; vertical-align:top;}
  th{background:#f5f5f5;}
  td.n{text-align:right;}
  .resume{margin-top:8px; display:flex; gap:${isPos80 ? "4px" : "10px"}; flex-wrap:wrap; justify-content:center;}
  .resume span{font-size:${isPos80 ? "9px" : "12px"}; border:1px solid #ddd; border-radius:${isPos80 ? "8px" : "999px"}; padding:${isPos80 ? "3px 6px" : "4px 10px"};}
  .ticketSummary{
    margin-top:8px;
    border-top:1px dashed #888;
    border-bottom:1px dashed #888;
    padding:6px 0;
  }
  .ticketSummaryRow{
    display:flex;
    justify-content:space-between;
    gap:8px;
    font-size:10px;
    line-height:1.35;
    padding:1px 0;
  }
  .ticketSummaryRow b{font-size:10.5px;}
  .ticketSectionTitle{
    margin-top:8px;
    padding:4px 0 5px;
    border-bottom:1px solid #222;
    font-size:10px;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:.4px;
  }
  .ticketItem{
    border-bottom:1px dashed #b9b9b9;
    padding:6px 0;
    page-break-inside:avoid;
  }
  .ticketItemName{
    font-size:10.5px;
    font-weight:700;
    line-height:1.25;
    word-break:break-word;
    margin-bottom:2px;
  }
  .ticketItemSku{
    font-size:8.5px;
    color:#555;
    margin-bottom:5px;
    word-break:break-all;
  }
  .ticketQtyGrid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:4px 8px;
  }
  .ticketMetric{
    display:flex;
    justify-content:space-between;
    gap:6px;
    min-width:0;
    font-size:9px;
    line-height:1.25;
  }
  .ticketMetric span{color:#555;}
  .ticketMetric b{
    font-size:9.5px;
    color:#000;
    white-space:nowrap;
  }
  @media print{
    @page{ size: ${isPos80 ? "80mm auto" : "letter portrait"}; margin: ${isPos80 ? "2mm" : "10mm"}; }
    body{padding:0;}
    .page{width:auto;}
  }
</style>
</head><body>
  <div class="page">
    <img class="headLogo" src="${logoSrc}" alt="Hotel Jardines del Lago" />
    <h2 class="headTitle">Corte diario de inventario</h2>
    <div class="muted"><b>Fecha del corte: ${esc(fechaCorte ? fmtDate(fechaCorte + "T00:00:00") : fmtDate(new Date()))}</b>${fechaCorte ? " — reimpresión histórica" : ""}</div>
    <div class="muted">Formato: ${isPos80 ? "POS 80 mm" : "Carta"}</div>
    <div class="muted">Bodega: ${bod?.nombre_bodega || `#${id_bodega}`}</div>
    ${summaryHtml}
    ${rowsHtml}
  </div>
  <script>
    // Esperar a que el documento esté completamente cargado y renderizado
    // antes de imprimir. Sin esto, el print() se ejecuta antes de que el
    // navegador termine de pintar y la página aparece en blanco.
    (function() {
      function doPrint() {
        try { window.print(); } catch (e) { /* ignore */ }
      }
      function ready() {
        // Doble seguro: pequeño delay para que se complete el primer paint
        setTimeout(doPrint, 400);
      }
      if (document.readyState === 'complete') {
        ready();
      } else {
        window.addEventListener('load', ready);
        // Backup por si load no dispara (raro pero pasa con algunos
        // pipelines de document.write / Blob URL en Safari)
        setTimeout(ready, 1500);
      }
      window.addEventListener('afterprint', function() { window.close(); });
    })();
  </script>
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.send(html);
});

app.get("/api/cierre-dia/estado", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.is_bodeguero && !scope.is_admin_role) {
      return res.status(403).json({ error: "Solo el rol bodeguero o admin puede consultar el cierre de dia." });
    }
    const id_bodega = Number(scope.id_bodega || 0);
    if (!id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const [[dates]] = await pool.query(`SELECT CURDATE() AS hoy, DATE_SUB(CURDATE(), INTERVAL 1 DAY) AS ayer`);
    const hoy = ymd(dates?.hoy);
    const ayer = ymd(dates?.ayer);

    const [[lc]] = await pool.query(
      `SELECT MAX(fecha_cierre) AS last_closed_date
       FROM cierre_dia
       WHERE id_bodega=:id_bodega`,
      { id_bodega }
    );
    const last_closed_date = ymd(lc?.last_closed_date);

    // Calcular TODOS los días pendientes: desde el día siguiente al último cierre hasta ayer
    const [pendingRows] = await pool.query(
      `SELECT fecha_cierre, id_cierre, creado_en, origen
       FROM cierre_dia
       WHERE id_bodega=:id_bodega
         AND fecha_cierre <= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       ORDER BY fecha_cierre ASC`,
      { id_bodega }
    );
    const closedDates = new Set((pendingRows || []).map((r) => ymd(r.fecha_cierre)));

    const pending_days = [];
    if (last_closed_date && last_closed_date < ayer) {
      let d = addDaysYmd(last_closed_date, 1);
      while (d <= ayer) {
        if (!closedDates.has(d)) pending_days.push(d);
        d = addDaysYmd(d, 1);
      }
    } else if (!last_closed_date && ayer) {
      // Nunca se cerró: los días van desde el primer movimiento hasta ayer
      const [[firstMov]] = await pool.query(
        `SELECT DATE(MIN(creado_en)) AS first_date
         FROM kardex
         WHERE id_bodega=:id_bodega`,
        { id_bodega }
      );
      const firstDate = ymd(firstMov?.first_date) || ayer;
      let d = firstDate;
      while (d <= ayer) {
        if (!closedDates.has(d)) pending_days.push(d);
        d = addDaysYmd(d, 1);
      }
    }

    const [[todayRow]] = await pool.query(
      `SELECT id_cierre, fecha_cierre, creado_en, origen
       FROM cierre_dia
       WHERE id_bodega=:id_bodega AND fecha_cierre=CURDATE()
       LIMIT 1`,
      { id_bodega }
    );
    const [[yesterdayRow]] = await pool.query(
      `SELECT id_cierre, fecha_cierre, creado_en, origen
       FROM cierre_dia
       WHERE id_bodega=:id_bodega AND fecha_cierre=DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       LIMIT 1`,
      { id_bodega }
    );

    // Mapear días ya cerrados (ayer y anteriores) para mostrarlos igual
    const closedDaysMap = {};
    for (const r of (pendingRows || [])) {
      const key = ymd(r.fecha_cierre);
      if (key) closedDaysMap[key] = {
        id_cierre: Number(r.id_cierre || 0),
        fecha_cierre: key,
        creado_en: r.creado_en,
        origen: r.origen,
      };
    }

    res.json({
      id_bodega,
      hoy,
      ayer,
      last_closed_date,
      today_closed: !!todayRow,
      yesterday_closed: !!yesterdayRow,
      pending_yesterday_close: !yesterdayRow,
      // NUEVO: información completa de días pendientes
      days_missing: pending_days.length,
      pending_days,
      required_close_date: pending_days.length > 0 ? pending_days[0] : null,
      next_pending_date: pending_days.length > 1 ? pending_days[1] : null,
      // Map de cierres cerrados (para referencia, para no romper compatibilidad)
      yesterday_close: yesterdayRow
        ? {
            id_cierre: Number(yesterdayRow.id_cierre || 0),
            fecha_cierre: ymd(yesterdayRow.fecha_cierre),
            creado_en: yesterdayRow.creado_en,
            origen: yesterdayRow.origen,
          }
        : null,
      today_close: todayRow
        ? {
            id_cierre: Number(todayRow.id_cierre || 0),
            fecha_cierre: ymd(todayRow.fecha_cierre),
            creado_en: todayRow.creado_en,
            origen: todayRow.origen,
          }
        : null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/cierre-dia", auth, requirePermission("action.create_update", "realizar cierre de dia"), async (req, res) => {
  const id_bodega = Number(req.user?.id_warehouse || 0);
  const id_usuario = Number(req.user?.id_user || 0);
  if (!id_bodega || !id_usuario) return res.status(400).json({ error: "Usuario sin bodega" });
  const scope = await resolveStockScope(req.user);
  if (!scope.is_bodeguero) {
    return res.status(403).json({ error: "Solo el rol bodeguero puede realizar el cierre de dia." });
  }

  const fecha_raw = String(req.body?.fecha || "").trim();
  const confirmar = Number(req.body?.confirmar || 0) === 1 || req.body?.confirmar === true;
  if (fecha_raw && !/^\d{4}-\d{2}-\d{2}$/.test(fecha_raw)) {
    return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[d]] = await conn.query(`SELECT CURDATE() AS hoy`);
    const hoy = ymd(d?.hoy);
    const fecha_cierre = fecha_raw || hoy;
    if (!fecha_cierre) {
      await conn.rollback();
      return res.status(400).json({ error: "No se pudo determinar fecha de cierre" });
    }
    if (fecha_cierre > hoy) {
      await conn.rollback();
      return res.status(400).json({ error: "No se puede cerrar una fecha futura" });
    }
    if (!confirmar) {
      await conn.rollback();
      return res.status(409).json({
        error: "Estas seguro de realizar el cierre de dia? Este proceso no podra revertirse.",
        code: "CLOSE_CONFIRM_REQUIRED",
        warning: "Estas seguro de realizar el cierre de dia? Este proceso no podra revertirse.",
        fecha_cierre,
      });
    }
    const approval = await verifySensitiveApproval(req, conn, "realizar cierre de dia");
    if (!approval.ok) {
      await conn.rollback();
      return res.status(Number(approval.status || 403)).json(approval);
    }

    // ── Conteo final: si la bodega lo permite y el cliente envió conteosFinales,
    //    generar las salidas automáticas ANTES del cierre (misma transacción).
    let conteoFinalResult = null;
    const conteosFinales = Array.isArray(req.body?.conteosFinales) ? req.body.conteosFinales : [];
    if (conteosFinales.length > 0) {
      const [[bodCfg]] = await conn.query(
        `SELECT COALESCE(cb.permite_salida_conteo_final, 0) AS permite_salida_conteo_final,
                b.nombre_bodega
         FROM bodegas b
         LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
         WHERE b.id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega }
      );
      if (Number(bodCfg?.permite_salida_conteo_final || 0) !== 1) {
        await conn.rollback();
        return res.status(400).json({
          error: "La bodega no tiene habilitada la salida por conteo final. Quite los conteosFinales o habilite la bodega.",
        });
      }
      const [[motivo]] = await conn.query(
        `SELECT id_motivo, nombre_motivo, tipo_movimiento, activo
         FROM motivos_movimiento
         WHERE tipo_movimiento='AJUSTE'
           AND activo=1
         ORDER BY
           (UPPER(nombre_motivo) LIKE '%CONTEO%') DESC,
           (UPPER(nombre_motivo) LIKE '%INVENTARIO%') DESC,
           id_motivo ASC
         LIMIT 1`
      );
      if (!motivo) {
        await conn.rollback();
        return res.status(400).json({ error: "No existe un motivo activo de AJUSTE para registrar el conteo final" });
      }

      try {
        conteoFinalResult = await applyConteoFinalLines(conn, {
          id_bodega,
          lines: conteosFinales,
          motivo,
          user: req.user,
          approval,
          observaciones: `Conteo final del cierre de ${fecha_cierre} - ${bodCfg?.nombre_bodega || `bodega #${id_bodega}`}`,
          fecha_cierre,
        });
      } catch (conteoErr) {
        await conn.rollback();
        return res.status(400).json({ error: String(conteoErr.message || conteoErr) });
      }
    }

    const cierre = await createDailyCloseForDate(conn, {
      id_bodega,
      fecha_cierre,
      creado_por: id_usuario,
      origen: "MANUAL",
      observaciones: String(req.body?.observaciones || "").trim() || null,
    }).catch((e) => {
      // Errores con .code/.status son errores controlados de validación
      if (e && e.code) return { _error: e };
      throw e;
    });

    if (cierre?._error) {
      await conn.rollback();
      const e = cierre._error;
      return res.status(Number(e.status || 409)).json({
        error: String(e.message || e),
        code: e.code,
        required_close_date: e.required_close_date,
        last_closed_date: e.last_closed_date,
      });
    }

    if (cierre.already_exists) {
      const [[cierreInfo]] = await conn.query(
        `SELECT c.id_cierre, c.fecha_cierre, c.creado_por, u.nombre_completo AS creado_por_nombre
         FROM cierre_dia c
         LEFT JOIN usuarios u ON u.id_usuario=c.creado_por
         WHERE c.id_bodega=:id_bodega
           AND c.fecha_cierre=:fecha_cierre
         LIMIT 1`,
        { id_bodega, fecha_cierre }
      );
      await conn.rollback();

      const cierreFecha = dmy(cierreInfo?.fecha_cierre || fecha_cierre);
      const cierreUserId = Number(cierreInfo?.creado_por || 0) || null;
      const cierreNombre = String(cierreInfo?.creado_por_nombre || "").trim() || "Usuario no identificado";

      return res.status(409).json({
        error: `El usuario #${cierreUserId || "N/A"} (${cierreNombre}) ya realizo el cierre para la fecha ${cierreFecha}.`,
        code: "DAY_ALREADY_CLOSED",
        fecha_cierre: ymd(cierreInfo?.fecha_cierre || fecha_cierre),
        cerrado_por_id: cierreUserId,
        cerrado_por_nombre: cierreNombre,
      });
    }

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "CIERRE_DIA_MANUAL",
      action_label: "Cierre manual de dia",
      approval,
      reference_type: "CIERRE_DIA",
      reference_id: cierre.id_cierre,
      detail: {
        fecha_cierre: cierre.fecha_cierre,
        total_lineas: Number(cierre.rows?.length || 0),
        conteo_final: conteoFinalResult && conteoFinalResult.appliedLines > 0
          ? {
              id_movimiento: conteoFinalResult.id_movimiento,
              productos: conteoFinalResult.affectedProducts,
              total_salida: conteoFinalResult.totalSalida,
            }
          : null,
      },
    });
    res.json({
      ok: true,
      id_cierre: cierre.id_cierre,
      fecha_cierre: cierre.fecha_cierre,
      already_exists: cierre.already_exists,
      total_lineas: Number(cierre.rows?.length || 0),
      total_entradas: Number(cierre.total_entradas || 0),
      total_salidas: Number(cierre.total_salidas || 0),
      total_existencia_cierre: Number(cierre.total_existencia_cierre || 0),
      conteo_final: conteoFinalResult && conteoFinalResult.appliedLines > 0
        ? {
            id_movimiento: conteoFinalResult.id_movimiento,
            productos: conteoFinalResult.affectedProducts,
            total_salida: conteoFinalResult.totalSalida,
          }
        : null,
      sensitive_approval: toSensitiveApprovalPayload(approval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/cierre-dia", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.status(403).json({ error: "Sin permiso para ver cierres diarios" });

    const fecha = String(req.query.fecha || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const wh = Number(req.query.warehouse || 0);
    const limit = Math.max(1, Math.min(365, Number(req.query.limit || 120)));

    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({ error: "Fecha 'from' invalida. Formato esperado: YYYY-MM-DD" });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "Fecha 'to' invalida. Formato esperado: YYYY-MM-DD" });
    }

    const fromDate = fecha || from || null;
    const toDate = fecha || to || null;
    const warehouseScope = getScopedWarehouseFilter(scope, wh);
    if (warehouseScope.denied) {
      return res.json({
        id_bodega: null,
        can_all_bodegas: scope.can_all_bodegas,
        id_bodega_default: scope.id_bodega,
        filtros: { fecha: fecha || null, from: fromDate, to: toDate, warehouse: null, limit },
        rows: [],
      });
    }
    const id_bodega = !scope.can_all_bodegas ? scope.id_bodega : warehouseScope.selected;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "cdw")
        : null;

    const [rows] = await pool.query(
      `SELECT c.id_cierre,
              c.id_bodega,
              b.nombre_bodega,
              DATE_FORMAT(c.fecha_cierre, '%Y-%m-%d') AS fecha_cierre,
              c.total_entradas,
              c.total_salidas,
              c.total_existencia_cierre,
              c.creado_por,
              u.nombre_completo AS creado_por_nombre,
              c.origen,
              c.observaciones,
              c.creado_en,
              COALESCE(d.total_lineas, 0) AS total_lineas
       FROM cierre_dia c
       JOIN bodegas b ON b.id_bodega=c.id_bodega
       LEFT JOIN usuarios u ON u.id_usuario=c.creado_por
       LEFT JOIN (
         SELECT id_cierre, COUNT(*) AS total_lineas
         FROM cierre_dia_detalle
         GROUP BY id_cierre
       ) d ON d.id_cierre=c.id_cierre
       WHERE ${accessFilter ? `c.id_bodega IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR c.id_bodega=:id_bodega)
         AND (:from_date IS NULL OR c.fecha_cierre >= :from_date)
         AND (:to_date IS NULL OR c.fecha_cierre <= :to_date)
       ORDER BY c.fecha_cierre DESC, c.id_cierre DESC
       LIMIT ${limit}`,
      {
        id_bodega,
        from_date: fromDate,
        to_date: toDate,
        ...(accessFilter?.params || {}),
      }
    );

    res.json({
      id_bodega,
      can_all_bodegas: scope.can_all_bodegas,
      id_bodega_default: scope.id_bodega,
      filtros: { fecha: fecha || null, from: fromDate, to: toDate, warehouse: id_bodega, limit },
      rows,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/cierre-dia/:fecha", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.status(403).json({ error: "Sin permiso para ver cierres diarios" });

    const fecha = String(req.params.fecha || "").trim();
    const wh = Number(req.query.warehouse || 0);
    const id_bodega = scope.can_all_bodegas ? (wh > 0 ? wh : scope.id_bodega) : scope.id_bodega;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Fecha invalida. Formato esperado: YYYY-MM-DD" });
    }

    const [[head]] = await pool.query(
      `SELECT c.id_cierre, c.id_bodega, b.nombre_bodega, c.fecha_cierre, c.total_entradas, c.total_salidas, c.total_existencia_cierre, c.creado_por, c.origen, c.observaciones, c.creado_en
       FROM cierre_dia c
       JOIN bodegas b ON b.id_bodega=c.id_bodega
       WHERE c.id_bodega=:id_bodega AND c.fecha_cierre=:fecha
       LIMIT 1`,
      { id_bodega, fecha }
    );
    if (!head) return res.status(404).json({ error: "No hay cierre para esa fecha" });

    const [rows] = await pool.query(
      `SELECT id_producto, sku, nombre_producto, existencia_inicial, entradas_dia, salidas_dia, existencia_cierre
       FROM cierre_dia_detalle
       WHERE id_cierre=:id_cierre
       ORDER BY nombre_producto ASC`,
      { id_cierre: head.id_cierre }
    );

    res.json({
      cierre: {
        id_cierre: Number(head.id_cierre || 0),
        id_bodega: Number(head.id_bodega || 0),
        nombre_bodega: head.nombre_bodega || null,
        fecha_cierre: ymd(head.fecha_cierre),
        total_entradas: Number(head.total_entradas || 0),
        total_salidas: Number(head.total_salidas || 0),
        total_existencia_cierre: Number(head.total_existencia_cierre || 0),
        creado_por: head.creado_por ? Number(head.creado_por) : null,
        origen: head.origen,
        observaciones: head.observaciones || null,
        creado_en: head.creado_en,
      },
      rows,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/stock-scope", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    let rows = [];
    if (!scope.can_view_existencias) {
      rows = [];
    } else if (scope.has_warehouse_restrictions) {
      const inClause = buildNamedInClause(scope.allowed_warehouse_ids, "sw");
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})
         ORDER BY nombre_bodega ASC`,
        inClause.params
      );
    } else if (scope.can_all_bodegas) {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE activo=1
         ORDER BY nombre_bodega ASC`
      );
    } else {
      [rows] = await pool.query(
        `SELECT id_bodega, nombre_bodega
         FROM bodegas
         WHERE id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega: scope.id_bodega }
      );
    }

    res.json({
      id_bodega_default: scope.id_bodega,
      maneja_stock: scope.maneja_stock,
      is_bodeguero: scope.is_bodeguero,
      can_close_day: scope.is_bodeguero,
      can_view_existencias: scope.can_view_existencias,
      can_all_bodegas: scope.can_all_bodegas,
      has_warehouse_restrictions: scope.has_warehouse_restrictions,
      bodegas: rows,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   DASHBOARD INICIO
========================= */
app.get("/api/dashboard/resumen", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const id_bodega = scope.can_all_bodegas ? Number(req.query.warehouse || 0) || null : scope.id_bodega;
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    const mov_days = Math.max(7, Math.min(365, Number(req.query.mov_days || 30)));
    const force = String(req.query.force || "") === "1";
    const scope_key = dashboardScopeKey(id_bodega, days, mov_days);
    let bodega_nombre = null;
    if (id_bodega) {
      const [[bRow]] = await pool.query(
        `SELECT nombre_bodega
         FROM bodegas
         WHERE id_bodega=:id_bodega
         LIMIT 1`,
        { id_bodega }
      );
      bodega_nombre = bRow?.nombre_bodega || null;
    }
    const cacheRow = force ? null : await readDashboardResumenCache(scope_key);
    if (cacheRow?.payload) {
      const isFresh = Number(cacheRow.age_sec || 0) <= DASHBOARD_CACHE_TTL_SEC;
      const payload = {
        ...cacheRow.payload,
        scope: {
          ...(cacheRow.payload.scope || {}),
          id_bodega,
          bodega_nombre,
          can_all_bodegas: scope.can_all_bodegas,
          bodega_usuario: scope.id_bodega,
        },
        cache: {
          hit: true,
          stale: !isFresh,
          age_sec: Number(cacheRow.age_sec || 0),
          generado_en: cacheRow.generado_en,
        },
      };
      if (!isFresh) {
        triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      }
      return res.json(payload);
    }

    if (!force) {
      triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      return res.json({
        ...emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
        cache: { hit: false, stale: false, warming: true, age_sec: 0, generado_en: null },
      });
    }

    const fresh = await withTimeout(
      buildDashboardResumenPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
      12000,
      null
    );
    if (!fresh) {
      triggerDashboardRefresh({ scope_key, id_bodega, bodega_nombre, scope, days, mov_days });
      return res.json({
        ...emptyDashboardPayload({ id_bodega, bodega_nombre, scope, days, mov_days }),
        cache: { hit: false, stale: false, warming: true, timeout: true, age_sec: 0, generado_en: null },
      });
    }
    await writeDashboardResumenCache({
      scope_key,
      id_bodega,
      days,
      mov_days,
      payload: fresh,
    });
    return res.json({
      ...fresh,
      cache: { hit: false, stale: false, warming: false, age_sec: 0, generado_en: new Date() },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/dashboard/detalle", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });

    const kind = String(req.query.kind || "vigentes").trim().toLowerCase();
    const id_bodega = scope.can_all_bodegas ? Number(req.query.warehouse || 0) || null : scope.id_bodega;
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    const mov_days = Math.max(7, Math.min(365, Number(req.query.mov_days || 30)));
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 300)));


    if (kind === "stock_minimo") {
      const [rows] = await pool.query(
        `SELECT vs.id_bodega,
                b.nombre_bodega,
                vs.id_producto,
                p.nombre_producto,
                p.sku,
                COALESCE(vs.stock, 0) AS stock,
                COALESCE(lpb.minimo, 0) AS minimo_stock,
                COALESCE(lpb.maximo, 0) AS maximo_stock,
                CASE
                  WHEN COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0) THEN 'Bajo minimo'
                  WHEN COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1) THEN 'Proximo a minimo'
                  ELSE ''
                END AS nivel_stock
         FROM v_stock_resumen vs
         JOIN bodegas b ON b.id_bodega=vs.id_bodega
         JOIN productos p ON p.id_producto=vs.id_producto
         LEFT JOIN limites_producto_bodega lpb
           ON lpb.id_bodega=vs.id_bodega
          AND lpb.id_producto=vs.id_producto
         WHERE vs.stock > 0
           AND COALESCE(lpb.activo, 1)=1
           AND COALESCE(lpb.minimo, 0) > 0
           AND (
             COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0)
             OR COALESCE(vs.stock, 0) = (COALESCE(lpb.minimo, 0) + 1)
           )
           AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)
         ORDER BY b.nombre_bodega ASC,
                  CASE WHEN COALESCE(vs.stock, 0) < COALESCE(lpb.minimo, 0) THEN 0 ELSE 1 END ASC,
                  p.nombre_producto ASC
         LIMIT ${limit}`,
        { id_bodega }
      );
      return res.json({ kind, rows });
    }
    const stockKinds = {
      vigentes: "(v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())",
      vencidos: "(v.fecha_vencimiento IS NOT NULL AND v.fecha_vencimiento < CURDATE())",
      proximos: "(v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)",
      rotar: "(v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) BETWEEN 0 AND :days)",
    };

    if (Object.prototype.hasOwnProperty.call(stockKinds, kind)) {
      const whereKind = stockKinds[kind];
      // Costo último con subconsultas correlacionadas (preferido + fallback).
      // NOTA: se revirtió el refactor a ROW_NUMBER() por el benchmark con datos
      // reales (test_bench_detalle.cjs): las ventanas eran ~50-60% MÁS LENTAS
      // en este MariaDB 12.2 (filesort por partición de todo el kardex vs index
      // lookups puntuales ix_k_bod_prod de las subconsultas).
      const [rows] = await pool.query(
        `SELECT v.id_bodega,
                b.nombre_bodega,
                v.id_producto,
                p.nombre_producto,
                p.sku,
                v.lote,
                v.fecha_vencimiento,
                v.stock,
                CASE
                  WHEN v.fecha_vencimiento IS NULL THEN NULL
                  ELSE DATEDIFF(v.fecha_vencimiento, CURDATE())
                END AS dias_para_vencer,
                COALESCE(
                  (
                    SELECT k1.costo_unitario
                    FROM kardex k1
                    LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
                    WHERE k1.id_bodega=v.id_bodega
                      AND k1.id_producto=v.id_producto
                      AND k1.delta_cantidad > 0
                      AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                      AND COALESCE(me1.no_contar_dashboard, 0) = 0
                    ORDER BY k1.creado_en DESC, k1.id_kardex DESC
                    LIMIT 1
                  ),
                  (
                    SELECT k2.costo_unitario
                    FROM kardex k2
                    WHERE k2.id_bodega=v.id_bodega
                      AND k2.id_producto=v.id_producto
                      AND k2.delta_cantidad > 0
                    ORDER BY k2.creado_en DESC, k2.id_kardex DESC
                    LIMIT 1
                  ),
                  0
                ) AS costo_unitario,
                (
                  v.stock * COALESCE(
                    (
                      SELECT k1.costo_unitario
                      FROM kardex k1
                      LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
                      WHERE k1.id_bodega=v.id_bodega
                        AND k1.id_producto=v.id_producto
                        AND k1.delta_cantidad > 0
                        AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
                        AND COALESCE(me1.no_contar_dashboard, 0) = 0
                      ORDER BY k1.creado_en DESC, k1.id_kardex DESC
                      LIMIT 1
                    ),
                    (
                      SELECT k2.costo_unitario
                      FROM kardex k2
                      WHERE k2.id_bodega=v.id_bodega
                        AND k2.id_producto=v.id_producto
                        AND k2.delta_cantidad > 0
                      ORDER BY k2.creado_en DESC, k2.id_kardex DESC
                      LIMIT 1
                    ),
                    0
                  )
                ) AS total_linea
         FROM v_stock_por_lote v
         JOIN bodegas b ON b.id_bodega=v.id_bodega
         JOIN productos p ON p.id_producto=v.id_producto
         WHERE v.stock > 0
           AND (${whereKind})
           AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
         ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
         LIMIT ${limit}`,
        { id_bodega, days }
      );
      return res.json({ kind, rows });
    }

    if (kind === "mas_mov" || kind === "menos_mov") {
      const orderSql = kind === "mas_mov" ? "DESC" : "ASC";
      const [rows] = await pool.query(
        `SELECT k.id_producto,
                p.nombre_producto,
                p.sku,
                SUM(ABS(k.delta_cantidad)) AS cantidad_movimiento,
                MAX(k.creado_en) AS ultimo_movimiento,
                (
                  SELECT COALESCE(SUM(vs.stock),0)
                  FROM v_stock_resumen vs
                  WHERE vs.id_producto=k.id_producto
                    AND (:id_bodega IS NULL OR vs.id_bodega=:id_bodega)
                ) AS stock_actual
         FROM kardex k
         JOIN productos p ON p.id_producto=k.id_producto
         LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
         WHERE (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
           AND k.creado_en >= DATE_SUB(CURDATE(), INTERVAL :mov_days DAY)
           AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
           AND COALESCE(me.no_contar_dashboard, 0) = 0
         GROUP BY k.id_producto, p.nombre_producto, p.sku
         HAVING SUM(ABS(k.delta_cantidad)) > 0
         ORDER BY cantidad_movimiento ${orderSql}, p.nombre_producto ASC
         LIMIT ${limit}`,
        { id_bodega, mov_days }
      );
      return res.json({ kind, rows });
    }

    return res.status(400).json({ error: "Tipo de detalle no valido" });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   DETALLE DE UN MOVIMIENTO (ENTRADA/SALIDA) — una sola consulta indexada
   ========================= */
app.get("/api/movimientos/:id", auth, async (req, res) => {
  const idMovimiento = Number(req.params.id || 0);
  if (!idMovimiento) return res.status(400).json({ error: "Movimiento invalido" });

  const scope = await resolveStockScope(req.user);
  if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
  if (!scope.can_view_existencias) return res.status(403).json({ error: "Sin permisos" });

  const [[head]] = await pool.query(
    `SELECT me.id_movimiento,
            me.tipo_movimiento,
            me.estado,
            me.anulado_por,
            me.anulado_en,
            u_anul.nombre_completo AS anulado_por_usuario,
            me.creado_en,
            me.no_documento,
            me.observaciones,
            bo.id_bodega AS id_bodega_origen,
            bo.nombre_bodega AS nombre_bodega_origen,
            bd.id_bodega AS id_bodega_destino,
            bd.nombre_bodega AS nombre_bodega_destino,
            -- Para salidas vinculadas a un pedido, la bodega destino real vive
            -- en el pedido (bodega solicitante), no en el movimiento.
            bped.id_bodega AS id_bodega_destino_pedido,
            bped.nombre_bodega AS nombre_bodega_destino_pedido,
            m.id_motivo,
            m.nombre_motivo,
            u.nombre_completo AS usuario_creador
     FROM movimiento_encabezado me
     LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
     LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
     LEFT JOIN (SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
                FROM pedido_movimiento_vinculo pmv
                JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
                WHERE pmv.id_movimiento=:id_movimiento
                GROUP BY pmv.id_movimiento
                LIMIT 1) pm ON pm.id_movimiento=me.id_movimiento
     LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
     LEFT JOIN bodegas bped ON bped.id_bodega=pe.id_bodega_solicita
     LEFT JOIN motivos_movimiento m ON m.id_motivo=me.id_motivo
     LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
     LEFT JOIN usuarios u_anul ON u_anul.id_usuario=me.anulado_por
     WHERE me.id_movimiento=:id_movimiento
     LIMIT 1`,
    { id_movimiento: idMovimiento }
  );
  if (!head) return res.status(404).json({ error: "Movimiento no existe" });

  // Acceso: el movimiento pertenece a las bodegas origen/destino. Para salidas
  // vinculadas a un pedido, la bodega solicitante (destino real) también cuenta.
  const movWhs = [
    Number(head.id_bodega_origen || 0),
    Number(head.id_bodega_destino || 0),
    Number(head.id_bodega_destino_pedido || 0),
  ].filter((x) => x > 0);
  if (scope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(scope.allowed_warehouse_ids);
    if (!movWhs.some((id) => allowed.includes(id))) {
      return res.status(403).json({ error: "No tienes acceso a este movimiento" });
    }
  } else if (!scope.can_all_bodegas && !movWhs.includes(Number(scope.id_bodega || 0))) {
    return res.status(403).json({ error: "No tienes acceso a este movimiento" });
  }

  const [lines] = await pool.query(
    `SELECT md.id_detalle,
            md.id_producto,
            p.nombre_producto,
            p.sku,
            c.nombre_categoria,
            sc.nombre_subcategoria,
            md.lote,
            md.fecha_vencimiento,
            md.cantidad,
            md.costo_unitario,
            md.precio_salida,
            (md.cantidad * COALESCE(md.precio_salida, md.costo_unitario)) AS total_linea
     FROM movimiento_detalle md
     JOIN productos p ON p.id_producto=md.id_producto
     LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
     LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
     WHERE md.id_movimiento=:id_movimiento
     ORDER BY md.id_detalle ASC`,
    { id_movimiento: idMovimiento }
  );

  res.json({
    id_movimiento: head.id_movimiento,
    fecha: head.creado_en,
    tipo: head.tipo_movimiento,
    no_documento: head.no_documento,
    observaciones: head.observaciones,
    estado: head.estado || null,
    anulado_por: head.anulado_por || null,
    anulado_en: head.anulado_en || null,
    anulado_por_usuario: head.anulado_por_usuario || null,
    nombre_motivo: head.nombre_motivo,
    id_motivo: head.id_motivo,
    usuario_creador: head.usuario_creador,
    bodega: head.nombre_bodega_destino || head.nombre_bodega_destino_pedido || head.nombre_bodega_origen || null,
    lines: lines || [],
  });
});

app.get("/api/reportes/entradas", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "renw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "renq");
    const id_producto = Number(req.query.id_producto || 0) || null;
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    // Rango sargable sobre la columna DATETIME (NO DATE(col)) para que MySQL
    // pueda usar el índice ix_me_creado. DATE(col) impedía el uso del índice.
    const from_dt = from_date ? `${from_date} 00:00:00` : null;
    const to_dt = to_date ? `${to_date} 23:59:59` : null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const motivoRaw = String(req.query.motivo || "").trim().toUpperCase();
    const tipo_movimiento = motivoRaw === "TRANSFERENCIA" ? "TRANSFERENCIA" : null;
    const id_motivo = tipo_movimiento ? null : Number(req.query.motivo || 0) || null;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    // Solo se agregan los JOINs a detalle/producto si el filtro los necesita.
    // El caso común (listado por fecha) se resuelve SOLO contra el encabezado,
    // que está indexado por creado_en → milisegundos en vez de escanear todo.
    const needsProductJoin = Boolean(
      id_producto || qf.hasTokens || lote || id_categoria || id_subcategoria
    );

    const headerClauses = [
      "me.tipo_movimiento IN ('ENTRADA', 'TRANSFERENCIA')",
      "me.estado<>'ANULADO'",
      accessFilter ? `me.id_bodega_destino IN (${accessFilter.sql})` : "1=1",
      "(:id_bodega IS NULL OR me.id_bodega_destino=:id_bodega)",
      "(:documento IS NULL OR me.no_documento LIKE :documento)",
      "(:from_dt IS NULL OR me.creado_en >= :from_dt)",
      "(:to_dt IS NULL OR me.creado_en <= :to_dt)",
      "(:tipo_movimiento IS NULL OR me.tipo_movimiento=:tipo_movimiento)",
      "(:id_motivo IS NULL OR me.id_motivo=:id_motivo)",
    ];
    const productClauses = [];
    if (needsProductJoin) {
      if (id_producto) productClauses.push("md.id_producto=:id_producto");
      else if (qf.clause && qf.clause !== "1=1") productClauses.push(qf.clause);
      if (lote) productClauses.push("md.lote LIKE :lote");
      if (id_categoria) productClauses.push("p.id_categoria=:id_categoria");
      if (id_subcategoria) productClauses.push("p.id_subcategoria=:id_subcategoria");
    }
    const whereSQL = [...headerClauses, ...productClauses].join("\n         AND ");

    const params = {
      id_bodega, documento, from_dt, to_dt,
      tipo_movimiento, id_motivo,
      ...(accessFilter?.params || {}),
      ...(needsProductJoin
        ? { id_producto, lote, id_categoria, id_subcategoria, ...(id_producto ? {} : qf.params) }
        : {}),
    };

    const productJoins = needsProductJoin
      ? `JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
         JOIN productos p ON p.id_producto=md.id_producto`
      : "";

    // Count distinct movements
    const [[{ total }]] = await pool.query(
      needsProductJoin
        ? `SELECT COUNT(DISTINCT me.id_movimiento) AS total
           FROM movimiento_encabezado me
           ${productJoins}
           WHERE ${whereSQL}`
        : `SELECT COUNT(*) AS total
           FROM movimiento_encabezado me
           WHERE ${whereSQL}`,
      params
    );
    const totalMovements = Number(total || 0);

    // Get paginated movement headers (sin GROUP BY si no hay joins)
    const [movements] = await pool.query(
      needsProductJoin
        ? `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           ${productJoins}
           WHERE ${whereSQL}
           GROUP BY me.id_movimiento
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`
        : `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           WHERE ${whereSQL}
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Get flat detail lines (one row per line, with movement data joined in).
    // IMPORTANTE: se aplican los mismos filtros de categoría/subcategoría/lote/q
    // que se usaron en el listado de movimientos. Si no, un movimiento que tiene
    // productos de varias categorías mostraría TODAS sus líneas al filtrar por
    // una sola categoría.
    let rows = [];
    if (movements.length > 0) {
      const ids = movements.map(function(m) { return m.id_movimiento; });
      const inClause = buildNamedInClause(ids, "entd");

      const detailClauses = [];
      const detailParams = { ...inClause.params };
      if (id_producto) {
        detailClauses.push("md.id_producto=:id_producto");
        detailParams.id_producto = id_producto;
      } else if (qf.clause) {
        detailClauses.push(qf.clause);
        Object.assign(detailParams, qf.params);
      }
      if (id_categoria) {
        detailClauses.push("p.id_categoria=:id_categoria");
        detailParams.id_categoria = id_categoria;
      }
      if (id_subcategoria) {
        detailClauses.push("p.id_subcategoria=:id_subcategoria");
        detailParams.id_subcategoria = id_subcategoria;
      }
      if (lote) {
        detailClauses.push("md.lote LIKE :lote");
        detailParams.lote = lote;
      }

      const detailWhere = `me.id_movimiento IN (${inClause.sql})${
        detailClauses.length ? " AND " + detailClauses.join(" AND ") : ""
      }`;
      const [detailRows] = await pool.query(
        `SELECT me.id_movimiento,
                me.tipo_movimiento AS tipo_entrada,
                me.estado,
                me.anulado_por,
                me.anulado_en,
                u_anul.nombre_completo AS anulado_por_usuario,
                DATE(me.creado_en) AS fecha,
                TIME(me.creado_en) AS hora,
                me.creado_en,
                me.no_documento,
                me.observaciones,
                b.id_bodega,
                b.nombre_bodega,
                m.id_motivo,
                m.nombre_motivo,
                COALESCE(me.no_contar_dashboard, 0) AS no_contar_dashboard,
                u.id_usuario,
                u.nombre_completo AS usuario_creador,
                md.id_detalle,
                md.id_producto,
                p.nombre_producto,
                p.sku,
                c.nombre_categoria,
                sc.nombre_subcategoria,
                md.lote,
                md.fecha_vencimiento,
                md.cantidad,
                md.costo_unitario,
                md.precio_salida,
                (md.cantidad * md.costo_unitario) AS total_linea
         FROM movimiento_encabezado me
         JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
         LEFT JOIN bodegas b ON b.id_bodega=me.id_bodega_destino
         JOIN productos p ON p.id_producto=md.id_producto
         LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
         LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
         LEFT JOIN motivos_movimiento m ON m.id_motivo=me.id_motivo
         LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
         LEFT JOIN usuarios u_anul ON u_anul.id_usuario=me.anulado_por
         WHERE ${detailWhere}
         ORDER BY me.creado_en DESC, me.id_movimiento DESC, md.id_detalle DESC`,
        detailParams
      );
      rows = detailRows;
    }

    res.json({
      rows,
      total: totalMovements,
      page,
      limit,
      totalPages: Math.ceil(totalMovements / Math.max(1, limit)),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post(
  "/api/entradas/:id_movimiento/dashboard-flag",
  auth,
  requirePermission("action.manage_permissions", "administrar exclusion del panel principal en entradas"),
  async (req, res) => {
    let conn = null;
    try {
      await ensureMovimientoDashboardColumn();
      await ensureMovimientoPastUpdateTrigger();
      const id_movimiento = Number(req.params.id_movimiento || 0);
      if (!id_movimiento) return res.status(400).json({ error: "Movimiento invalido" });
      const scope = await resolveStockScope(req.user);
      if (!scope?.is_admin_role) {
        return res.status(403).json({ error: "Solo un administrador puede excluir entradas antiguas del panel principal." });
      }

      const no_contar_dashboard = Number(req.body?.no_contar_dashboard) === 1 ? 1 : 0;
      conn = await pool.getConnection();
      const [[row]] = await conn.query(
        `SELECT id_movimiento, tipo_movimiento, id_bodega_destino, id_bodega_origen
         FROM movimiento_encabezado
         WHERE id_movimiento=:id_movimiento
         LIMIT 1`,
        { id_movimiento }
      );
      if (!row) return res.status(404).json({ error: "Movimiento no encontrado" });
      if (String(row.tipo_movimiento || "").toUpperCase() !== "ENTRADA") {
        return res.status(400).json({ error: "Solo las entradas pueden excluirse del panel principal." });
      }

      await conn.query(`SET @allow_dashboard_flag_past_update = 1`);
      await conn.query(
        `UPDATE movimiento_encabezado
         SET no_contar_dashboard=:no_contar_dashboard
         WHERE id_movimiento=:id_movimiento`,
        { id_movimiento, no_contar_dashboard }
      );
      await conn.query(`SET @allow_dashboard_flag_past_update = 0`);

      await pool.query(`DELETE FROM dashboard_cache_resumen`);

      return res.json({ ok: true, id_movimiento, no_contar_dashboard });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    } finally {
      if (conn) conn.release();
    }
  }
);

app.get("/api/reportes/salidas", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "resw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku"], "resq");
    const id_producto = Number(req.query.id_producto || 0) || null;
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    // Rango sargable sobre la columna DATETIME (NO DATE(col)) para usar el índice.
    const from_dt = from_date ? `${from_date} 00:00:00` : null;
    const to_dt = to_date ? `${to_date} 23:59:59` : null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const id_bodega_destino = Number(req.query.warehouse_destino || 0) || null;
    const motivoRaw = String(req.query.motivo || "").trim().toUpperCase();
    const tipo_movimiento = motivoRaw === "TRANSFERENCIA" ? "TRANSFERENCIA" : null;
    const id_motivo = tipo_movimiento ? null : Number(req.query.motivo || 0) || null;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    // Solo se agregan los JOINs que el filtro realmente necesita:
    //  - detalle/producto (md/p): solo si se filtra por producto/lote/categoría/subcategoría
    //  - vínculo con pedido (pm/pe): solo si se filtra por bodega destino.
    // El caso común (listado por fecha) se resuelve SOLO contra el encabezado,
    // que está indexado por creado_en → milisegundos en vez de escanear todo.
    const needsProductJoin = Boolean(
      id_producto || qf.hasTokens || lote || id_categoria || id_subcategoria
    );
    const needsPedidoJoin = Boolean(id_bodega_destino);

    const headerClauses = [
      "me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')",
      "me.estado<>'ANULADO'",
      accessFilter ? `me.id_bodega_origen IN (${accessFilter.sql})` : "1=1",
      "(:id_bodega IS NULL OR me.id_bodega_origen=:id_bodega)",
      "(:documento IS NULL OR me.no_documento LIKE :documento)",
      "(:from_dt IS NULL OR me.creado_en >= :from_dt)",
      "(:to_dt IS NULL OR me.creado_en <= :to_dt)",
      "(:tipo_movimiento IS NULL OR me.tipo_movimiento=:tipo_movimiento)",
      "(:id_motivo IS NULL OR me.id_motivo=:id_motivo)",
    ];
    if (needsPedidoJoin) {
      headerClauses.push(
        "(:id_bodega_destino IS NULL OR COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)=:id_bodega_destino)"
      );
    }
    const productClauses = [];
    if (needsProductJoin) {
      if (id_producto) productClauses.push("md.id_producto=:id_producto");
      else if (qf.clause && qf.clause !== "1=1") productClauses.push(qf.clause);
      if (lote) productClauses.push("md.lote LIKE :lote");
      if (id_categoria) productClauses.push("p.id_categoria=:id_categoria");
      if (id_subcategoria) productClauses.push("p.id_subcategoria=:id_subcategoria");
    }
    const whereSQL = [...headerClauses, ...productClauses].join("\n         AND ");

    const params = {
      id_bodega, documento, from_dt, to_dt,
      tipo_movimiento, id_motivo,
      ...(accessFilter?.params || {}),
      ...(needsPedidoJoin ? { id_bodega_destino } : {}),
      ...(needsProductJoin
        ? { id_producto, lote, id_categoria, id_subcategoria, ...(id_producto ? {} : qf.params) }
        : {}),
    };

    const productJoins = needsProductJoin
      ? `JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
         JOIN productos p ON p.id_producto=md.id_producto`
      : "";
    const pedidoJoins = needsPedidoJoin
      ? `LEFT JOIN (
           SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
           FROM pedido_movimiento_vinculo pmv
           JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
           GROUP BY pmv.id_movimiento
         ) pm ON pm.id_movimiento=me.id_movimiento
         LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido`
      : "";

    // Count distinct movements
    const [[{ total }]] = await pool.query(
      needsProductJoin || needsPedidoJoin
        ? `SELECT COUNT(DISTINCT me.id_movimiento) AS total
           FROM movimiento_encabezado me
           ${productJoins}
           ${pedidoJoins}
           WHERE ${whereSQL}`
        : `SELECT COUNT(*) AS total
           FROM movimiento_encabezado me
           WHERE ${whereSQL}`,
      params
    );
    const totalMovements = Number(total || 0);

    // Get paginated distinct movement IDs (sin GROUP BY si no hay joins)
    const [movements] = await pool.query(
      needsProductJoin || needsPedidoJoin
        ? `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           ${productJoins}
           ${pedidoJoins}
           WHERE ${whereSQL}
           GROUP BY me.id_movimiento
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`
        : `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           WHERE ${whereSQL}
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Get flat detail lines (one row per line, with movement data joined in).
    // IMPORTANTE: se aplican los mismos filtros de categoría/subcategoría/lote/q
    // que se usaron en el listado de movimientos. Si no, un movimiento que tiene
    // productos de varias categorías mostraría TODAS sus líneas al filtrar por
    // una sola categoría.
    let rows = [];
    if (movements.length > 0) {
      const ids = movements.map(function(m) { return m.id_movimiento; });
      const inClause = buildNamedInClause(ids, "sald");

      const detailClauses = [];
      const detailParams = { ...inClause.params };
      if (id_producto) {
        detailClauses.push("md.id_producto=:id_producto");
        detailParams.id_producto = id_producto;
      } else if (qf.clause) {
        detailClauses.push(qf.clause);
        Object.assign(detailParams, qf.params);
      }
      if (id_categoria) {
        detailClauses.push("p.id_categoria=:id_categoria");
        detailParams.id_categoria = id_categoria;
      }
      if (id_subcategoria) {
        detailClauses.push("p.id_subcategoria=:id_subcategoria");
        detailParams.id_subcategoria = id_subcategoria;
      }
      if (lote) {
        detailClauses.push("md.lote LIKE :lote");
        detailParams.lote = lote;
      }

      const detailWhere = `me.id_movimiento IN (${inClause.sql})${
        detailClauses.length ? " AND " + detailClauses.join(" AND ") : ""
      }`;
      const [detailRows] = await pool.query(
        `SELECT me.id_movimiento,
                me.tipo_movimiento AS tipo_salida,
                me.estado,
                me.anulado_por,
                me.anulado_en,
                u_anul.nombre_completo AS anulado_por_usuario,
                DATE(me.creado_en) AS fecha,
                TIME(me.creado_en) AS hora,
                me.creado_en,
                me.no_documento,
                me.observaciones,
                bo.id_bodega AS id_bodega_origen,
                bo.nombre_bodega AS nombre_bodega_origen,
                COALESCE(bd.id_bodega, bped.id_bodega) AS id_bodega_destino,
                COALESCE(bd.nombre_bodega, bped.nombre_bodega) AS nombre_bodega_destino,
                COALESCE(usol.nombre_completo, '') AS solicitante_pedido,
                m.id_motivo,
                m.nombre_motivo,
                u.id_usuario,
                u.nombre_completo AS usuario_creador,
                md.id_detalle,
                md.id_producto,
                p.nombre_producto,
                p.sku,
                c.nombre_categoria,
                sc.nombre_subcategoria,
                md.lote,
                md.cantidad,
                md.costo_unitario,
                md.precio_salida,
                -- Si el usuario capturó precio de salida, ese manda; si no, se
                -- usa el costo histórico (última entrada) como antes.
                (md.cantidad * COALESCE(md.precio_salida, md.costo_unitario)) AS total_linea
         FROM movimiento_encabezado me
         JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
         LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
         LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
         LEFT JOIN (SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido FROM pedido_movimiento_vinculo pmv JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle WHERE pmv.id_movimiento IN (${inClause.sql}) GROUP BY pmv.id_movimiento) pm ON pm.id_movimiento=me.id_movimiento
         LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
         LEFT JOIN bodegas bped ON bped.id_bodega=pe.id_bodega_solicita
         LEFT JOIN usuarios usol ON usol.id_usuario=pe.id_usuario_solicita
         LEFT JOIN motivos_movimiento m ON m.id_motivo=me.id_motivo
         LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
         LEFT JOIN usuarios u_anul ON u_anul.id_usuario=me.anulado_por
         LEFT JOIN productos p ON p.id_producto=md.id_producto
         LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
         LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
         WHERE ${detailWhere}
         ORDER BY me.creado_en DESC, me.id_movimiento DESC, md.id_detalle DESC`,
        detailParams
      );
      rows = detailRows;
    }

    res.json({
      rows,
      total: totalMovements,
      page,
      limit,
      totalPages: Math.ceil(totalMovements / Math.max(1, limit)),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});


// Tendencia diaria de entradas vs salidas para el dashboard (agregado en SQL).
// Antes el cliente bajaba 2 reportes con limit=2000 filas de detalle y agregaba
// en JS; ahora el backend devuelve una fila por día (máx. `days` filas).
app.get("/api/reportes/trends", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json([]);

    const days = Math.max(1, Math.min(90, Number(req.query.days || 7)));
    const toDate = new Date();
    const fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - (days - 1));
    const from_dt = `${localYmd(fromDate)} 00:00:00`;
    const to_dt = `${localYmd(toDate)} 23:59:59`;

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json([]);
    let id_bodega = warehouseScope.selected;
    if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    const accessFilter =
      warehouseScope.restrictedIds.length && !id_bodega
        ? buildNamedInClause(warehouseScope.restrictedIds, "trnw")
        : null;

    const entradasSql = `SELECT DATE(me.creado_en) AS fecha, SUM(md.cantidad) AS cantidad
      FROM movimiento_encabezado me
      JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
      WHERE me.tipo_movimiento IN ('ENTRADA','TRANSFERENCIA')
        AND me.estado<>'ANULADO'
        ${accessFilter ? `AND me.id_bodega_destino IN (${accessFilter.sql})` : ""}
        AND (:id_bodega IS NULL OR me.id_bodega_destino=:id_bodega)
        AND me.creado_en >= :from_dt
        AND me.creado_en <= :to_dt
      GROUP BY DATE(me.creado_en)`;

    const salidasSql = `SELECT DATE(me.creado_en) AS fecha, SUM(md.cantidad) AS cantidad
      FROM movimiento_encabezado me
      JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
      WHERE me.tipo_movimiento IN ('SALIDA','TRANSFERENCIA')
        AND me.estado<>'ANULADO'
        ${accessFilter ? `AND me.id_bodega_origen IN (${accessFilter.sql})` : ""}
        AND (:id_bodega IS NULL OR me.id_bodega_origen=:id_bodega)
        AND me.creado_en >= :from_dt
        AND me.creado_en <= :to_dt
      GROUP BY DATE(me.creado_en)`;

    const params = { id_bodega, from_dt, to_dt, ...(accessFilter?.params || {}) };
    const [entradasRes, salidasRes] = await Promise.all([
      pool.query(entradasSql, params),
      pool.query(salidasSql, params),
    ]);

    const entradasByDay = new Map(
      (entradasRes[0] || []).map((r) => [String(r.fecha || "").slice(0, 10), Number(r.cantidad || 0)])
    );
    const salidasByDay = new Map(
      (salidasRes[0] || []).map((r) => [String(r.fecha || "").slice(0, 10), Number(r.cantidad || 0)])
    );

    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localYmd(d);
      rows.push({
        fecha: key,
        entradas: entradasByDay.get(key) || 0,
        salidas: salidasByDay.get(key) || 0,
      });
    }
    res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/pedidos", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });

    const requesterScope = getScopedWarehouseFilter(scope, req.query.warehouse_requester);
    if (requesterScope.denied) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });
    let id_bodega_solicita = requesterScope.selected;
    const dispatchScope = getScopedWarehouseFilter(scope, req.query.warehouse_dispatch);
    if (dispatchScope.denied) return res.json({ rows: [], total: 0, page: 1, limit: 100, totalPages: 1 });
    let id_bodega_surtidor = dispatchScope.selected;
    const localWarehouseId = !scope.can_all_bodegas ? Number(scope.id_bodega || 0) || null : null;
    if (!scope.can_all_bodegas) {
      id_bodega_surtidor = null;
    }
    const requesterAccessFilter =
      requesterScope.restrictedIds.length && !id_bodega_solicita
        ? buildNamedInClause(requesterScope.restrictedIds, "rprw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["pr.nombre_producto", "pr.sku", "us.nombre_completo"], "rpeq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const date_mode = String(req.query.date_mode || "PEDIDO").trim().toUpperCase() === "DESPACHO" ? "DESPACHO" : "PEDIDO";
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const id_pedido = Number(req.query.pedido || 0) || null;
    const estado = String(req.query.estado || "").trim() || null;
    const id_usuario_solicita = Number(req.query.requester_user || 0) || null;
    const id_usuario_despacha = Number(req.query.dispatch_user || 0) || null;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    const where = "(:id_pedido IS NULL OR p.id_pedido=:id_pedido)\n         AND (:estado IS NULL OR p.estado=:estado)\n         AND " 
      + (requesterAccessFilter ? `p.id_bodega_solicita IN (${requesterAccessFilter.sql})` : "1=1")
      + "\n         AND (:id_bodega_solicita IS NULL OR p.id_bodega_solicita=:id_bodega_solicita)\n         AND (:id_bodega_surtidor IS NULL OR p.id_bodega_surtidor=:id_bodega_surtidor)\n         AND (:local_warehouse_id IS NULL OR p.id_bodega_solicita=:local_warehouse_id OR p.id_bodega_surtidor=:local_warehouse_id)\n         AND (:id_usuario_solicita IS NULL OR p.id_usuario_solicita=:id_usuario_solicita)\n         AND (:id_usuario_despacha IS NULL OR p.aprobado_por=:id_usuario_despacha OR EXISTS (SELECT 1 FROM pedido_movimiento_vinculo pmv3 JOIN movimiento_encabezado me3 ON me3.id_movimiento=pmv3.id_movimiento WHERE pmv3.id_pedido_detalle=d.id_pedido_detalle AND me3.creado_por=:id_usuario_despacha))\n         AND ((:date_mode=\'DESPACHO\' AND (:from_date IS NULL OR DATE(p.aprobado_en) >= :from_date) AND (:to_date IS NULL OR DATE(p.aprobado_en) <= :to_date)) OR (:date_mode<>\'DESPACHO\' AND (:from_date IS NULL OR DATE(p.creado_en) >= :from_date) AND (:to_date IS NULL OR DATE(p.creado_en) <= :to_date)))\n         AND (:id_categoria IS NULL OR pr.id_categoria=:id_categoria)\n         AND (:id_subcategoria IS NULL OR pr.id_subcategoria=:id_subcategoria)\n         AND "
      + qf.clause
      + "\n         AND (:lote IS NULL OR EXISTS (SELECT 1 FROM pedido_movimiento_vinculo pmv2 JOIN movimiento_detalle md2 ON md2.id_detalle=pmv2.id_detalle WHERE pmv2.id_pedido_detalle=d.id_pedido_detalle AND md2.lote LIKE :lote))";

    const params = {
      id_pedido, estado, id_bodega_solicita, id_bodega_surtidor,
      local_warehouse_id: localWarehouseId, id_usuario_solicita,
      id_usuario_despacha, date_mode, from_date, to_date,
      id_categoria, id_subcategoria, lote,
      ...(requesterAccessFilter?.params || {}),
      ...qf.params,
    };

    // Count distinct pedidos
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id_pedido) AS total
       FROM pedido_encabezado p
       JOIN pedido_detalle d ON d.id_pedido=p.id_pedido
       JOIN productos pr ON pr.id_producto=d.id_producto
       LEFT JOIN categorias c ON c.id_categoria=pr.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=pr.id_subcategoria
       JOIN usuarios us ON us.id_usuario=p.id_usuario_solicita
       LEFT JOIN usuarios ua ON ua.id_usuario=p.aprobado_por
       JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
       JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
       WHERE ${where}`,
      params
    );
    const totalMovements = Number(total || 0);

    // Get paginated pedido headers (uses SAME aliases as outer query)
    const [pedidos] = await pool.query(
      `SELECT p.id_pedido,
              DATE(p.creado_en) AS fecha_pedido,
              TIME(p.creado_en) AS hora_pedido,
              p.creado_en,
              p.estado,
              p.observaciones,
              p.id_usuario_solicita,
              us.nombre_completo AS solicitante,
              p.id_bodega_solicita,
              bs.nombre_bodega AS bodega_solicitante,
              p.id_bodega_surtidor,
              bd.nombre_bodega AS bodega_despacho,
              p.aprobado_por AS id_usuario_aprobador,
              ua.nombre_completo AS usuario_aprobador,
              p.aprobado_en,
              DATE(p.aprobado_en) AS fecha_despacho,
              TIME(p.aprobado_en) AS hora_despacho
       FROM pedido_encabezado p
       JOIN usuarios us ON us.id_usuario=p.id_usuario_solicita
       LEFT JOIN usuarios ua ON ua.id_usuario=p.aprobado_por
       JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
       JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
       JOIN (
         SELECT DISTINCT p.id_pedido
         FROM pedido_encabezado p
         JOIN pedido_detalle d ON d.id_pedido=p.id_pedido
         JOIN productos pr ON pr.id_producto=d.id_producto
         LEFT JOIN categorias c ON c.id_categoria=pr.id_categoria
         LEFT JOIN subcategorias sc ON sc.id_subcategoria=pr.id_subcategoria
         JOIN usuarios us ON us.id_usuario=p.id_usuario_solicita
         JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
         JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
         WHERE ${where}
         ORDER BY p.id_pedido DESC
         LIMIT ${limit} OFFSET ${offset}
       ) filtered ON filtered.id_pedido=p.id_pedido
       ORDER BY p.id_pedido DESC`,
      params
    );

    // Get detail lines for those pedidos.
    // IMPORTANTE: se aplican los mismos filtros de categoría/subcategoría/qf
    // que se usaron en el listado de pedidos. Si no, un pedido que tiene
    // productos de varias categorías mostraría TODAS sus líneas al filtrar
    // por una sola categoría.
    let rows = [];
    if (pedidos.length > 0) {
      const ids = pedidos.map(function(m) { return m.id_pedido; });
      const inClause = buildNamedInClause(ids, "pedd");

      const detailClauses = [];
      const detailParams = { ...inClause.params };
      if (id_categoria) {
        detailClauses.push("pr.id_categoria=:id_categoria");
        detailParams.id_categoria = id_categoria;
      }
      if (id_subcategoria) {
        detailClauses.push("pr.id_subcategoria=:id_subcategoria");
        detailParams.id_subcategoria = id_subcategoria;
      }
      if (qf.clause && qf.clause !== "1=1") {
        detailClauses.push(qf.clause);
        Object.assign(detailParams, qf.params);
      }

      const detailWhere = `p.id_pedido IN (${inClause.sql})${
        detailClauses.length ? " AND " + detailClauses.join(" AND ") : ""
      }`;

      const [detailRows] = await pool.query(
        `SELECT p.id_pedido,
                d.id_pedido_detalle,
                d.id_producto,
                pr.nombre_producto,
                pr.sku,
                c.nombre_categoria,
                sc.nombre_subcategoria,
                d.cantidad_solicitada,
                d.cantidad_surtida,
                (d.cantidad_solicitada - d.cantidad_surtida) AS pendiente,
                COALESCE(mv.lotes_despachados, '') AS lotes_despachados,
                COALESCE(mv.total_linea, 0) AS total_linea
         FROM pedido_encabezado p
         JOIN pedido_detalle d ON d.id_pedido=p.id_pedido
         JOIN productos pr ON pr.id_producto=d.id_producto
         LEFT JOIN categorias c ON c.id_categoria=pr.id_categoria
         LEFT JOIN subcategorias sc ON sc.id_subcategoria=pr.id_subcategoria
         LEFT JOIN (
           SELECT pmv.id_pedido_detalle,
                  GROUP_CONCAT(DISTINCT COALESCE(md.lote,'(sin lote)') ORDER BY md.lote SEPARATOR ', ') AS lotes_despachados,
                  SUM(md.cantidad * md.costo_unitario) AS total_linea
           FROM pedido_movimiento_vinculo pmv
           JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
           JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
           GROUP BY pmv.id_pedido_detalle
         ) mv ON mv.id_pedido_detalle=d.id_pedido_detalle
         WHERE ${detailWhere}
         ORDER BY p.id_pedido DESC, d.id_pedido_detalle ASC`,
        detailParams
      );

      // Group lines by pedido
      var movMap = new Map();
      for (var i = 0; i < pedidos.length; i++) {
        var m = pedidos[i];
        movMap.set(m.id_pedido, {
          id_pedido: m.id_pedido,
          fecha_pedido: m.fecha_pedido,
          hora_pedido: m.hora_pedido,
          creado_en: m.creado_en,
          estado: m.estado,
          observaciones: m.observaciones,
          id_usuario_solicita: m.id_usuario_solicita,
          solicitante: m.solicitante,
          id_bodega_solicita: m.id_bodega_solicita,
          bodega_solicitante: m.bodega_solicitante,
          id_bodega_surtidor: m.id_bodega_surtidor,
          bodega_despacho: m.bodega_despacho,
          id_usuario_aprobador: m.id_usuario_aprobador,
          usuario_aprobador: m.usuario_aprobador,
          aprobado_en: m.aprobado_en,
          fecha_despacho: m.fecha_despacho,
          hora_despacho: m.hora_despacho,
          lineas: []
        });
      }
      for (var j = 0; j < detailRows.length; j++) {
        var d = detailRows[j];
        var grupo = movMap.get(d.id_pedido);
        if (grupo) {
          grupo.lineas.push({
            id_detalle: d.id_pedido_detalle,
            id_producto: d.id_producto,
            nombre_producto: d.nombre_producto,
            sku: d.sku,
            nombre_categoria: d.nombre_categoria,
            nombre_subcategoria: d.nombre_subcategoria,
            cantidad_solicitada: Number(d.cantidad_solicitada || 0),
            cantidad_surtida: Number(d.cantidad_surtida || 0),
            pendiente: Number(d.pendiente || 0),
            total_linea: Number(d.total_linea || 0),
          });
        }
      }
      rows = Array.from(movMap.values());
    }

    res.json({
      rows,
      total: totalMovements,
      page,
      limit,
      totalPages: Math.ceil(totalMovements / Math.max(1, limit)),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   PEDIDOS (/api/orders)
========================= */
app.get(
  "/api/reportes/auditoria-sensibles",
  auth,
  requirePermission("section.view.r-auditoria-sensibles", "ver reporte de auditoria sensible"),
  async (req, res) => {
    try {
      const from = String(req.query.from || "").trim() || null;
      const to = String(req.query.to || "").trim() || null;
      const action_key = String(req.query.action_key || "").trim() || null;
      const qRaw = String(req.query.q || "").trim();
      const qf = buildTokenizedLikeFilter(
        qRaw,
        ["actor_nombre", "supervisor_nombre", "supervisor_usuario", "action_label"],
        "rauq"
      );
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));

      if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: "Fecha 'from' invalida. Formato esperado: YYYY-MM-DD" });
      }
      if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: "Fecha 'to' invalida. Formato esperado: YYYY-MM-DD" });
      }

      const canSeeAll = await canManageUserPermissions(Number(req.user?.id_user || 0));
      const id_bodega_actor = canSeeAll ? null : Number(req.user?.id_warehouse || 0) || null;

      const [rows] = await pool.query(
        `SELECT id_auditoria,
                action_key,
                action_label,
                endpoint,
                http_method,
                id_usuario_actor,
                actor_nombre,
                id_bodega_actor,
                id_usuario_supervisor,
                supervisor_usuario,
                supervisor_nombre,
                approval_method,
                reference_type,
                reference_id,
                detail_json,
                creado_en
         FROM auditoria_accion_sensible
         WHERE (:from IS NULL OR DATE(creado_en) >= :from)
           AND (:to IS NULL OR DATE(creado_en) <= :to)
           AND (:action_key IS NULL OR action_key = :action_key)
           AND ${qf.clause}
           AND (:id_bodega_actor IS NULL OR id_bodega_actor=:id_bodega_actor)
         ORDER BY creado_en DESC, id_auditoria DESC
         LIMIT ${limit}`,
        { from, to, action_key, id_bodega_actor, ...qf.params }
      );

      res.json(rows || []);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  }
);

app.post("/api/orders", auth, requirePermission("action.create_update", "crear pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { requested_from_warehouse_id, notes, lines } = req.body || {};
  const requester_user_id = Number(req.body?.requester_user_id || 0);
  const requester_pin = String(req.body?.requester_pin || "").trim();
  if (!requester_user_id) return res.status(400).json({ error: "Falta usuario solicitante" });
  if (!requester_pin) return res.status(400).json({ error: "Falta codigo del usuario solicitante" });
  if (!isValidOrderPin(requester_pin)) return res.status(400).json({ error: "El PIN de pedido debe tener entre 6 y 12 digitos" });
  if (!requested_from_warehouse_id) return res.status(400).json({ error: "Falta bodega origen/destino" });
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Pedido sin lineas" });
  const requestedFromWarehouseId = Number(requested_from_warehouse_id || 0);
  if (!requestedFromWarehouseId) return res.status(400).json({ error: "Bodega que despacha invalida" });
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/orders" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[requesterUser]] = await conn.query(
      `SELECT u.id_usuario, u.id_bodega, u.activo, upp.pin_hash
       FROM usuarios u
       LEFT JOIN usuario_pin_pedido upp ON upp.id_usuario=u.id_usuario
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: requester_user_id }
    );
    if (!requesterUser || Number(requesterUser.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Usuario solicitante no disponible" });
    }
    
    let finalRequesterUserId = requester_user_id;
    
    if (!requesterUser.pin_hash) {
      const matchedUser = await findOrderPinCollision(requester_pin, 0, conn, true);
      if (matchedUser) {
        finalRequesterUserId = matchedUser.id_usuario;
      } else {
        await conn.rollback();
        return res.status(400).json({ error: "El usuario solicitante no tiene PIN de pedidos configurado" });
      }
    } else {
      const pinOk = await bcrypt.compare(requester_pin, requesterUser.pin_hash || "");
      if (!pinOk) {
        const matchedUser = await findOrderPinCollision(requester_pin, 0, conn, true);
        if (matchedUser) {
          finalRequesterUserId = matchedUser.id_usuario;
        } else {
          trackPinFailure("order", { requester_user_id, actor_user_id: Number(req.user?.id_user || 0) });
          await conn.rollback();
          return res.status(400).json({ error: "Codigo de usuario solicitante invalido" });
        }
      }
    }
    
    const requester_warehouse_id = Number(requesterUser.id_bodega || 0);
    if (!requester_warehouse_id) {
      await conn.rollback();
      return res.status(400).json({ error: "Usuario solicitante sin bodega asignada" });
    }
    if (
      req.body?.requester_warehouse_id &&
      Number(req.body.requester_warehouse_id || 0) !== requester_warehouse_id
    ) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega del usuario solicitante no coincide" });
    }

    const [[fromWh]] = await conn.query(
      `SELECT id_bodega, tipo_bodega, activo
       FROM bodegas
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: requestedFromWarehouseId }
    );
    if (!fromWh || Number(fromWh.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega que despacha no disponible" });
    }
    const tipoFrom = String(fromWh.tipo_bodega || "").toUpperCase();
    if (!["PRINCIPAL", "RECEPTORA"].includes(tipoFrom)) {
      await conn.rollback();
      return res.status(400).json({ error: "Solo se puede pedir a bodegas PRINCIPAL o RECEPTORA" });
    }

    // Snapshot: si la bodega surtidora exige confirmacion de recepcion con PIN
    const [[cfgSurtidor]] = await conn.query(
      `SELECT requiere_confirmacion_recepcion
       FROM configuracion_bodega
       WHERE id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: requestedFromWarehouseId }
    );
    const confirmacionRequerida = Number(cfgSurtidor?.requiere_confirmacion_recepcion || 0) === 1 ? 1 : 0;

    const [r] = await conn.query(
      `INSERT INTO pedido_encabezado(id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, observaciones, confirmacion_requerida)
       VALUES(:u,:bs,:bd,:obs,:conf)`,
      { u: finalRequesterUserId, bs: requester_warehouse_id, bd: requested_from_warehouse_id, obs: notes ?? null, conf: confirmacionRequerida }
    );
    const id_pedido = r.insertId;

    for (const ln of lines) {
      if (ln?.id_product && !(await isProductVisibleInWarehouse(conn, ln.id_product, requestedFromWarehouseId))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${ln.id_product} no esta habilitado para la bodega que despacha` });
      }
      if (!ln.id_product || !ln.qty_requested || ln.qty_requested <= 0) continue;
      await conn.query(
        `INSERT INTO pedido_detalle(id_pedido, id_producto, cantidad_solicitada, observacion_producto)
         VALUES(:id_pedido,:id_producto,:cantidad,:nota)`,
        { id_pedido, id_producto: ln.id_product, cantidad: ln.qty_requested, nota: ln.line_note ?? null }
      );
    }

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id,
      requested_from_warehouse_id,
      status: "PENDIENTE",
      action: "created",
    });
    res.json({ ok: true, id_order: id_pedido });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/pedidos/correlativo-actual", auth, async (req, res) => {
  try {
    const [[r]] = await pool.query(
      `SELECT COALESCE(MAX(id_pedido), 0) AS correlativo
       FROM pedido_encabezado`
    );
    res.json({ correlativo: Number(r?.correlativo || 0) });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const scopeParam = req.query.scope ? String(req.query.scope) : null;
  const whParam = Number(req.query.warehouse || 0);
  const fromDate = String(req.query.from || "").trim() || null;
  const toDate = String(req.query.to || "").trim() || null;
  const stockScope = await resolveStockScope(req.user);
  const where = [];
  const params = {};
  if (status) {
    where.push("p.estado=:status");
    params.status = status;
  }
  // Rango sargable sobre la columna DATETIME (NO DATE(col)) para que MySQL
  // pueda usar el índice compuesto (id_bodega_surtidor, creado_en). DATE(col)
  // impedía el rango por fecha sobre la segunda columna del índice.
  if (fromDate) {
    where.push("p.creado_en >= :from_dt");
    params.from_dt = `${fromDate} 00:00:00`;
  }
  if (toDate) {
    where.push("p.creado_en <= :to_dt");
    params.to_dt = `${toDate} 23:59:59`;
  }
  if (scopeParam === "dispatch") {
    const warehouseScope = getScopedWarehouseFilter(stockScope, whParam);
    if (warehouseScope.denied) return res.json([]);
    if (!stockScope.can_all_bodegas) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = req.user.id_warehouse;
    } else if (warehouseScope.selected) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = warehouseScope.selected;
    } else if (warehouseScope.restrictedIds.length) {
      const inClause = buildNamedInClause(warehouseScope.restrictedIds, "ordw");
      where.push(`p.id_bodega_surtidor IN (${inClause.sql})`);
      Object.assign(params, inClause.params);
    }
  } else if (scopeParam === "mine") {
    where.push("p.id_usuario_solicita=:uid");
    params.uid = req.user.id_user;
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  // Límite de seguridad: evita respuestas gigantes cuando no hay filtros.
  // El cliente puede pedir más con ?limit=N.
  const limitParam = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
  // NOTA de rendimiento: el stock (mi_stock_total / su_stock_total) se calcula
  // DESPUÉS en una sola consulta agregada para los pedidos devueltos. Antes se
  // usaban dos subconsultas escalares POR FILA que materializaban la vista
  // v_stock_resumen (agrega TODO el kardex) N veces → ~1s con 500 pedidos.
  const [rows] = await pool.query(
    `
    SELECT p.*,
           bs.nombre_bodega AS requester_warehouse,
           bs.nombre_bodega AS nombre_bodega_solicita,
           bd.nombre_bodega AS from_warehouse,
           bd.nombre_bodega AS nombre_bodega_surtidor,
           u.nombre_completo AS requester_name,
           (SELECT COUNT(*) FROM pedido_detalle pd_tl WHERE pd_tl.id_pedido = p.id_pedido) AS total_lineas,
           (SELECT COALESCE(SUM(GREATEST(cantidad_solicitada - cantidad_surtida, 0)), 0)
            FROM pedido_detalle WHERE id_pedido = p.id_pedido) AS cantidad_pendiente_total,
           CASE
             WHEN bsol.tipo_bodega='RECEPTORA' OR cb.modo_despacho_auto='TRANSFERENCIA' THEN 'TRANSFERENCIA'
             ELSE 'SALIDA'
           END AS tipo_salida
    FROM pedido_encabezado p
    JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
    JOIN bodegas bd ON bd.id_bodega=p.id_bodega_surtidor
    JOIN bodegas bsol ON bsol.id_bodega=p.id_bodega_solicita
    LEFT JOIN configuracion_bodega cb ON cb.id_bodega=p.id_bodega_solicita
    JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
    ${whereSql}
    ORDER BY p.creado_en DESC
    LIMIT ${limitParam}
    `,
    params
  );

  // Stock por pedido en una sola pasada: suma el stock actual de v_stock_resumen
  // para cada producto del pedido, agrupado por (pedido, bodega). Luego en JS se
  // asigna mi_stock_total (bodega surtidora) y su_stock_total (bodega solicitante).
  if (rows.length > 0) {
    const ids = rows.map((r) => Number(r.id_pedido || 0));
    const inClause = buildNamedInClause(ids, "ordstk");
    const [stockRows] = await pool.query(
      `SELECT pd.id_pedido,
              vs.id_bodega,
              SUM(vs.stock) AS stock
       FROM pedido_detalle pd
       JOIN (
         SELECT id_bodega, id_producto, SUM(stock) AS stock
         FROM v_stock_disponible
         WHERE no_vencido = 1
         GROUP BY id_bodega, id_producto
       ) vs ON vs.id_producto = pd.id_producto
       WHERE pd.id_pedido IN (${inClause.sql})
       GROUP BY pd.id_pedido, vs.id_bodega`,
      inClause.params
    );
    const stockByPedido = new Map(); // pedidoId -> Map(bodegaId -> stock)
    for (const s of stockRows || []) {
      const pid = Number(s.id_pedido || 0);
      if (!stockByPedido.has(pid)) stockByPedido.set(pid, new Map());
      stockByPedido.get(pid).set(Number(s.id_bodega || 0), Number(s.stock || 0));
    }
    for (const r of rows) {
      const pid = Number(r.id_pedido || 0);
      const stocks = stockByPedido.get(pid);
      r.mi_stock_total = stocks ? (stocks.get(Number(r.id_bodega_surtidor || 0)) || 0) : 0;
      r.su_stock_total = stocks ? (stocks.get(Number(r.id_bodega_solicita || 0)) || 0) : 0;
    }
  }

  res.json(rows);
});

// Contador de pedidos pendientes de despacho (PENDIENTE/APROBADO/PARCIAL).
// Reemplaza descargar hasta 2000 pedidos solo para contarlos en el cliente.
app.get("/api/pedidos/count-pendientes", auth, async (req, res) => {
  try {
    const stockScope = await resolveStockScope(req.user);
    const where = [];
    const params = {};
    const whParam = Number(req.query.warehouse || 0);
    const warehouseScope = getScopedWarehouseFilter(stockScope, whParam);
    if (warehouseScope.denied) return res.json({ count: 0 });
    if (!stockScope.can_all_bodegas) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = req.user.id_warehouse;
    } else if (warehouseScope.selected) {
      where.push("p.id_bodega_surtidor=:wh");
      params.wh = warehouseScope.selected;
    } else if (warehouseScope.restrictedIds.length) {
      const inClause = buildNamedInClause(warehouseScope.restrictedIds, "cntw");
      where.push(`p.id_bodega_surtidor IN (${inClause.sql})`);
      Object.assign(params, inClause.params);
    }
    where.push("p.estado IN ('PENDIENTE','APROBADO','PARCIAL')");
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM pedido_encabezado p WHERE ${where.join(" AND ")}`,
      params
    );
    res.json({ count: Number(total || 0) });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/orders/:id/details", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT p.*,
            b.nombre_bodega AS from_warehouse,
            bs.nombre_bodega AS requester_warehouse,
            u.nombre_completo AS requester_name,
            uc.nombre_completo AS confirmado_por_nombre
     FROM pedido_encabezado p
     JOIN bodegas b ON b.id_bodega=p.id_bodega_surtidor
     LEFT JOIN bodegas bs ON bs.id_bodega=p.id_bodega_solicita
     LEFT JOIN usuarios u ON u.id_usuario=p.id_usuario_solicita
     LEFT JOIN usuarios uc ON uc.id_usuario=p.confirmado_por
     WHERE p.id_pedido=:id_pedido`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).json({ error: "No tienes acceso a este pedido" });
    }
  } else if (!stockScope.can_all_bodegas && !orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).json({ error: "No tienes acceso a este pedido" });
  }

  const [lines] = await pool.query(
    `SELECT d.id_pedido_detalle, d.id_producto, p.nombre_producto,
            d.cantidad_solicitada, d.cantidad_surtida,
            COALESCE(d.estado_linea, 'PENDIENTE') AS estado_linea,
            d.justificacion_linea,
            CASE
              WHEN COALESCE(d.estado_linea, 'PENDIENTE')='ANULADO' THEN 0
              ELSE GREATEST(d.cantidad_solicitada - d.cantidad_surtida, 0)
            END AS pendiente,
            s.stock   AS stock_surtidor,
            ss.stock  AS stock_solicitante
     FROM pedido_detalle d
     JOIN productos p ON p.id_producto=d.id_producto
     LEFT JOIN (
       SELECT id_bodega, id_producto, SUM(stock) AS stock
       FROM v_stock_disponible
       WHERE no_vencido = 1
       GROUP BY id_bodega, id_producto
     ) s ON s.id_bodega=:id_bodega_surtidor AND s.id_producto=d.id_producto
     LEFT JOIN (
       SELECT id_bodega, id_producto, SUM(stock) AS stock
       FROM v_stock_disponible
       WHERE no_vencido = 1
       GROUP BY id_bodega, id_producto
     ) ss ON ss.id_bodega=:id_bodega_solicita AND ss.id_producto=d.id_producto
     WHERE d.id_pedido=:id_pedido
     ORDER BY p.nombre_producto ASC`,
    {
      id_pedido,
      id_bodega_surtidor: pe.id_bodega_surtidor,
      id_bodega_solicita: pe.id_bodega_solicita || 0,
    }
  );

  res.json({
    id_pedido: pe.id_pedido,
    creado_en: pe.creado_en,
    estado: pe.estado || null,
    from_warehouse: pe.from_warehouse,
    requester_warehouse: pe.requester_warehouse,
    requester_name: pe.requester_name,
    observaciones: pe.observaciones || null,
    justificacion_despacho: pe.justificacion_despacho || null,
    confirmacion_requerida: Number(pe.confirmacion_requerida || 0) === 1,
    confirmado_en: pe.confirmado_en || null,
    confirmado_por: pe.confirmado_por || null,
    confirmado_por_nombre: pe.confirmado_por_nombre || null,
    lines,
  });
});


/* =========================
   ALIAS: Pedidos por despachar (mismo que GET /api/orders?scope=dispatch)
========================= */
app.get("/api/pedidos-despachar", auth, async (req, res) => {
  // Reuse the same handler as /api/orders?scope=dispatch by pre-setting the query.
  req.query = Object.assign({}, req.query, { scope: "dispatch" });
  return app._router.handle(
    Object.assign(req, { url: "/api/orders" + (req.originalUrl?.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "") }),
    res,
    () => res.status(500).json({ error: "No se pudo delegar a /api/orders" })
  );
});

/* =========================
   DESPACHO (MOVIMIENTOS + KARDEX)
========================= */
app.post("/api/orders/:id/fulfill", auth, requirePermission("action.dispatch", "despachar pedidos"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const { lines = [], justificacion = null } = req.body || {};
  const justificacionTxt = String(justificacion || "").trim();
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "Sin lineas a despachar" });
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/orders/${id_pedido}/fulfill` })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query("SELECT * FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE", { id_pedido });
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      await conn.rollback();
      return res.status(403).json({ error: "No puedes despachar pedidos de otra bodega" });
    }
    if (pe.estado === "CANCELADO" || pe.estado === "COMPLETADO" || pe.estado === "COMPLETADO_JUSTIFICADO") {
      await conn.rollback();
      return res.status(400).json({ error: "Pedido no despachable" });
    }

    const [[cfg]] = await conn.query(
      `SELECT cb.modo_despacho_auto, cb.maneja_stock, cb.requiere_confirmacion_recepcion, b.tipo_bodega
       FROM configuracion_bodega cb
       JOIN bodegas b ON b.id_bodega=cb.id_bodega
       WHERE cb.id_bodega=:id`,
      { id: pe.id_bodega_solicita }
    );
    const useTransfer = cfg?.tipo_bodega === "RECEPTORA" || cfg?.modo_despacho_auto === "TRANSFERENCIA";
    const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";
    const [[solUser]] = await conn.query(
      `SELECT nombre_completo
       FROM usuarios
       WHERE id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: pe.id_usuario_solicita }
    );
    const solicitanteNombre = String(solUser?.nombre_completo || `Usuario #${pe.id_usuario_solicita}`);

    const [[mot]] = await conn.query(
      `SELECT id_motivo
       FROM motivos_movimiento
       WHERE (nombre_motivo='Transferencia' AND :tipo='TRANSFERENCIA')
          OR (:tipo='SALIDA' AND tipo_movimiento='SALIDA')
       ORDER BY (nombre_motivo='Transferencia') DESC
       LIMIT 1`,
      { tipo: tipo_mov }
    );
    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: "No existe motivo para el movimiento" });
    }

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES(:tipo, :id_motivo, :origen, :destino, :obs, :u, NOW(), 'CONFIRMADO')`,
      {
        tipo: tipo_mov,
        id_motivo: mot.id_motivo,
        origen: pe.id_bodega_surtidor,
        // Siempre guardamos la bodega solicitante para trazabilidad del despacho.
        destino: pe.id_bodega_solicita,
        obs: `Despacho Pedido #${id_pedido} | Solicitante: ${solicitanteNombre}`,
        u: req.user.id_user,
      }
    );
    const id_movimiento = mhRes.insertId;

    let anyFulfilled = false;
    let requiresJustificacion = false;
    const skipped = [];

    for (const ln of lines) {
      const id_pedido_detalle = Number(ln.id_pedido_detalle);
      const qtyToFill = Number(ln.qty || 0);
      if (!id_pedido_detalle || qtyToFill <= 0) continue;

      const [[line]] = await conn.query(
        `SELECT * FROM pedido_detalle WHERE id_pedido_detalle=:id AND id_pedido=:id_pedido FOR UPDATE`,
        { id: id_pedido_detalle, id_pedido }
      );
      if (!line) continue;
      if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
        skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "LINEA_ANULADA" });
        continue;
      }

      const remainingToFill = Number(line.cantidad_solicitada) - Number(line.cantidad_surtida);
      if (remainingToFill <= 0) continue;
      // Permitir sobre-despacho: si el operador pide más de lo pendiente, se
      // respeta su cantidad (típico: "me piden 2 pero le voy a mandar 3").
      // El stock se valida con pickLotsFEFO más abajo; si no alcanza, la línea
      // se skipea. Si la cantidad a despachar difiere de la pendiente (sea
      // sobre o sub), exigimos justificación para tener trazabilidad.
      const requested = Math.max(Number(qtyToFill || 0), 0);
      if (requested !== remainingToFill) requiresJustificacion = true;

      const { picks } = await pickLotsFEFO(conn, pe.id_bodega_surtidor, line.id_producto, requested, {
        allowExpired: false,
      });
      if (!picks.length) {
        requiresJustificacion = true;
        skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "SIN_STOCK_NO_VIGENTE" });
        continue;
      }
      // Reportar faltantes parciales: el stock alcanzó para parte del pedido.
      const pickedQty = picks.reduce((a, b) => a + Number(b.qty || 0), 0);
      if (pickedQty < requested) {
        requiresJustificacion = true;
        skipped.push({
          id_pedido_detalle,
          id_producto: line.id_producto,
          motivo: "SIN_STOCK_PARCIAL",
          solicitado: requested,
          despachado: pickedQty,
          faltante: requested - pickedQty,
        });
      }

      anyFulfilled = true;

      for (const p of picks) {
        const costo_unitario = await getLastUnitCost(conn, pe.id_bodega_surtidor, line.id_producto, p.lote);
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle
           (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
           VALUES(:id_movimiento,:id_producto,:lote,:fecha,:cantidad,:costo,:obs)`,
          {
            id_movimiento,
            id_producto: line.id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo: costo_unitario,
            obs: `Pedido #${id_pedido}`,
          }
        );
        const id_detalle = d.insertId;

        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: pe.id_bodega_surtidor,
            id_producto: line.id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: -p.qty,
            costo: costo_unitario,
          }
        );

        if (useTransfer && cfg?.maneja_stock === 1) {
          await conn.query(
            `INSERT INTO kardex
             (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
             VALUES(:id_movimiento,:id_detalle,:id_bodega,:id_producto,:lote,:fecha,:delta,:costo)`,
            {
              id_movimiento,
              id_detalle,
              id_bodega: pe.id_bodega_solicita,
              id_producto: line.id_producto,
              lote: p.lote || null,
              fecha: p.fecha_vencimiento || null,
              delta: +p.qty,
              costo: costo_unitario,
            }
          );
        }

        await conn.query(
          `INSERT INTO pedido_movimiento_vinculo (id_pedido_detalle, id_movimiento, id_detalle)
           VALUES(:id_pedido_detalle,:id_movimiento,:id_detalle)`,
          { id_pedido_detalle, id_movimiento, id_detalle }
        );
      }

      const fulfilledNow = picks.reduce((a, b) => a + Number(b.qty), 0);
      const projectedSurtida = Number(line.cantidad_surtida) + fulfilledNow;
      if (projectedSurtida < Number(line.cantidad_solicitada)) {
        requiresJustificacion = true;
      }
      await conn.query(
        `UPDATE pedido_detalle
         SET cantidad_surtida = cantidad_surtida + :add,
             estado_linea = CASE
               WHEN (cantidad_surtida + :add) >= cantidad_solicitada THEN 'DESPACHADO'
               ELSE 'PENDIENTE'
             END,
             justificacion_linea = CASE
               WHEN :justificacion IS NULL OR :justificacion='' THEN justificacion_linea
               WHEN (cantidad_surtida + :add) != cantidad_solicitada THEN :justificacion
               ELSE justificacion_linea
             END
         WHERE id_pedido_detalle=:id`,
        {
          add: fulfilledNow,
          id: id_pedido_detalle,
          justificacion: justificacionTxt || null,
        }
      );
    }

    if (!anyFulfilled) {
      await conn.rollback();
      return res.status(400).json({ error: "Sin stock en las lineas seleccionadas", skipped });
    }

    if (requiresJustificacion && !justificacionTxt) {
      await conn.rollback();
      return res.status(400).json({ error: "Para despacho parcial debes ingresar una justificacion." });
    }

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
      justificacion: justificacionTxt || null,
    });
    const newStatus = recalc.estado;

    // Si la bodega solicitante exige confirmacion de recepcion y el pedido
    // se completo, marcar que requiere confirmacion del solicitante.
    const requiereConf = Number(cfg?.requiere_confirmacion_recepcion || 0) === 1;
    if (requiereConf && ['COMPLETADO', 'COMPLETADO_JUSTIFICADO'].includes(newStatus)) {
      await conn.query(
        `UPDATE pedido_encabezado SET confirmacion_requerida=1 WHERE id_pedido=:id`,
        { id: id_pedido }
      );
    }

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe.id_bodega_solicita,
      requested_from_warehouse_id: pe.id_bodega_surtidor,
      status: newStatus,
      action: "fulfilled",
    });
    res.json({
      ok: true,
      id_movimiento,
      status: newStatus,
      justificacion_despacho: recalc.justificacion_despacho || null,
      skipped,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   CONFIRMAR RECEPCION (PIN DEL SOLICITANTE)
   El solicitante da fe de haber recibido su pedido despachado.
   El PIN de pedidos del solicitante es la autorizacion (puede capturarlo
   en la sesion del despachador al momento de la entrega).
========================= */
app.post("/api/orders/:id/confirm-receipt", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  if (!Number.isFinite(id_pedido) || id_pedido <= 0) {
    return res.status(400).json({ error: "Pedido invalido" });
  }
  const pin = String(req.body?.pin || "").trim();
  if (!pin) return res.status(400).json({ error: "Falta el PIN del solicitante" });
  if (!isValidOrderPin(pin)) {
    return res.status(400).json({ error: "El PIN de pedido debe tener entre 6 y 12 digitos" });
  }
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/orders/${id_pedido}/confirm-receipt` })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      "SELECT * FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE",
      { id_pedido }
    );
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.confirmacion_requerida || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Este pedido no requiere confirmacion de recepcion" });
    }
    if (pe.confirmado_en) {
      await conn.rollback();
      return res.status(400).json({ error: "La recepcion de este pedido ya fue confirmada" });
    }
    if (!["COMPLETADO", "COMPLETADO_JUSTIFICADO"].includes(String(pe.estado || ""))) {
      await conn.rollback();
      return res.status(400).json({ error: "El pedido aun no esta completamente despachado" });
    }

    const [[solicitante]] = await conn.query(
      `SELECT u.id_usuario, u.activo, upp.pin_hash
       FROM usuarios u
       LEFT JOIN usuario_pin_pedido upp ON upp.id_usuario=u.id_usuario
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: pe.id_usuario_solicita }
    );
    let pinOk = false;
    if (solicitante && Number(solicitante.activo || 0) === 1 && solicitante.pin_hash) {
      pinOk = await bcrypt.compare(pin, solicitante.pin_hash || "");
    }
    
    if (!pinOk) {
      const matchedUser = await findOrderPinCollision(pin, 0, conn, true);
      if (!matchedUser) {
        trackPinFailure("order", { id_pedido, requester_user_id: pe.id_usuario_solicita, actor_user_id: Number(req.user?.id_user || 0) });
        await conn.rollback();
        return res.status(400).json({ error: "PIN del solicitante invalido" });
      }
    }

    await conn.query(
      `UPDATE pedido_encabezado
       SET confirmado_por=:confirmado_por, confirmado_en=NOW()
       WHERE id_pedido=:id_pedido`,
      { confirmado_por: pe.id_usuario_solicita, id_pedido }
    );

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe.id_bodega_solicita,
      requested_from_warehouse_id: pe.id_bodega_surtidor,
      status: pe.estado,
      action: "confirmed",
    });
    res.json({ ok: true, id_pedido, confirmado_por: pe.id_usuario_solicita });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   REVERTIR DESPACHO (MISMO DIA)
========================= */
app.post("/api/orders/:id/revert", auth, requirePermission("action.dispatch", "revertir despachos"), requireSensitiveApproval("reversa de despacho"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      "SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE",
      { id_pedido }
    );
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      await conn.rollback();
      return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    }

    const [links] = await conn.query(
      `SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad
       FROM pedido_movimiento_vinculo pmv
       JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
       JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
       WHERE pmv.id_pedido_detalle IN (
         SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido=:id_pedido
       )
       AND DATE(me.creado_en)=CURDATE()`,
      { id_pedido }
    );
    if (!links.length) {
      await conn.rollback();
      return res.status(400).json({ error: "No hay movimientos reversibles hoy" });
    }

    const movIds = [...new Set(links.map((x) => x.id_movimiento))];

    // Validar que la bodega receptora aun tenga el stock que se va a retirar.
    const [posRows] = await conn.query(
      `SELECT id_bodega, id_producto, lote, SUM(delta_cantidad) AS qty
       FROM kardex
       WHERE id_movimiento IN (${movIds.map(() => "?").join(",")}) AND delta_cantidad > 0
       GROUP BY id_bodega, id_producto, lote`,
      movIds
    );
    for (const r of posRows) {
      await conn.query(`SELECT id_producto FROM productos WHERE id_producto=? FOR UPDATE`, [r.id_producto]);
      const [[st]] = await conn.query(
        `SELECT COALESCE(SUM(delta_cantidad),0) AS stock FROM kardex
         WHERE id_bodega=? AND id_producto=? AND lote <=> ?`,
        [r.id_bodega, r.id_producto, r.lote]
      );
      if (Number(st?.stock || 0) < Number(r.qty || 0) - 1e-9) {
        await conn.rollback();
        return res.status(400).json({
          error: `No se puede revertir: la bodega destino ya consumio el producto #${r.id_producto} (lote ${r.lote ?? "sin lote"}).`,
        });
      }
    }

    for (const ln of links) {
      await conn.query(
        `UPDATE pedido_detalle
         SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0),
             estado_linea = CASE
               WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO'
               WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO'
               ELSE 'PENDIENTE'
             END
         WHERE id_pedido_detalle=:id`,
        { qty: ln.cantidad, id: ln.id_pedido_detalle }
      );
    }

    await conn.query(
      `DELETE FROM kardex WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM pedido_movimiento_vinculo WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_detalle WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );
    await conn.query(
      `DELETE FROM movimiento_encabezado WHERE id_movimiento IN (${movIds.map(() => "?").join(",")})`,
      movIds
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });
    const estado = recalc.estado;

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "REVERSA_DESPACHO_TOTAL",
      action_label: "Reversa total de despacho",
      approval: req.sensitive_approval,
      reference_type: "PEDIDO",
      reference_id: id_pedido,
      detail: { movimientos_revertidos: movIds.length },
    });
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: estado,
      action: "reverted",
    });
    res.json({ ok: true, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});


app.get("/api/orders/:id/lots", auth, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  const stockScope = await resolveStockScope(req.user);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });
  const [[pe]] = await pool.query(
    `SELECT id_bodega_solicita, id_bodega_surtidor
     FROM pedido_encabezado
     WHERE id_pedido=:id_pedido
     LIMIT 1`,
    { id_pedido }
  );
  if (!pe) return res.status(404).json({ error: "Pedido no existe" });
  const orderWarehouses = [Number(pe.id_bodega_solicita || 0), Number(pe.id_bodega_surtidor || 0)].filter((x) => x > 0);
  if (stockScope.has_warehouse_restrictions) {
    const allowed = normalizeWarehouseIdList(stockScope.allowed_warehouse_ids);
    if (!orderWarehouses.some((id) => allowed.includes(id))) {
      return res.status(403).json({ error: "No tienes acceso a este pedido" });
    }
  } else if (!orderWarehouses.includes(actorWarehouse)) {
    return res.status(403).json({ error: "No tienes acceso a este pedido" });
  }
  const [rows] = await pool.query(
    `SELECT pr.nombre_producto, md.lote, md.fecha_vencimiento, md.cantidad,
            me.tipo_movimiento, me.creado_en
     FROM pedido_movimiento_vinculo pmv
     JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
     JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
     JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
     JOIN productos pr ON pr.id_producto=pd.id_producto
     WHERE pd.id_pedido=:id_pedido
     ORDER BY me.creado_en DESC, pr.nombre_producto ASC`,
    { id_pedido }
  );
  res.json({ count: rows.length, rows });
});


app.post("/api/orders/:id/revert-line", auth, requirePermission("action.dispatch", "revertir lineas despachadas"), requireSensitiveApproval("reversa de linea despachada"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      "SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=:id_pedido FOR UPDATE",
      { id_pedido }
    );
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      await conn.rollback();
      return res.status(403).json({ error: "No puedes revertir pedidos de otra bodega" });
    }

    const [links] = await conn.query(
      `SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad
       FROM pedido_movimiento_vinculo pmv
       JOIN movimiento_detalle md ON md.id_detalle=pmv.id_detalle
       JOIN movimiento_encabezado me ON me.id_movimiento=pmv.id_movimiento
       WHERE pmv.id_pedido_detalle=:id_pedido_detalle
         AND DATE(me.creado_en)=CURDATE()`,
      { id_pedido_detalle }
    );
    if (!links.length) {
      await conn.rollback();
      return res.status(400).json({ error: "No hay movimientos reversibles hoy" });
    }

    const movIds = [...new Set(links.map((x) => x.id_movimiento))];
    const detalleIds = [...new Set(links.map((x) => x.id_detalle))];
    const reverted_qty = links.reduce((a, b) => a + Number(b.cantidad || 0), 0);

    // Validar que la bodega receptora aun tenga el stock que se va a retirar.
    const [posRows] = await conn.query(
      `SELECT id_bodega, id_producto, lote, SUM(delta_cantidad) AS qty
       FROM kardex
       WHERE id_detalle IN (${detalleIds.map(() => "?").join(",")}) AND delta_cantidad > 0
       GROUP BY id_bodega, id_producto, lote`,
      detalleIds
    );
    for (const r of posRows) {
      await conn.query(`SELECT id_producto FROM productos WHERE id_producto=? FOR UPDATE`, [r.id_producto]);
      const [[st]] = await conn.query(
        `SELECT COALESCE(SUM(delta_cantidad),0) AS stock FROM kardex
         WHERE id_bodega=? AND id_producto=? AND lote <=> ?`,
        [r.id_bodega, r.id_producto, r.lote]
      );
      if (Number(st?.stock || 0) < Number(r.qty || 0) - 1e-9) {
        await conn.rollback();
        return res.status(400).json({
          error: `No se puede revertir: la bodega destino ya consumio el producto #${r.id_producto} (lote ${r.lote ?? "sin lote"}).`,
        });
      }
    }

    await conn.query(
      `UPDATE pedido_detalle
       SET cantidad_surtida = GREATEST(cantidad_surtida - :qty, 0),
           estado_linea = CASE
             WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 'ANULADO'
             WHEN GREATEST(cantidad_surtida - :qty, 0) >= cantidad_solicitada THEN 'DESPACHADO'
             ELSE 'PENDIENTE'
           END
       WHERE id_pedido_detalle=:id`,
      { qty: reverted_qty, id: id_pedido_detalle }
    );

    // Borrar SOLO las filas de esta linea (no todo el movimiento).
    await conn.query(
      `DELETE FROM kardex WHERE id_detalle IN (${detalleIds.map(() => "?").join(",")})`,
      detalleIds
    );
    await conn.query(
      `DELETE FROM pedido_movimiento_vinculo WHERE id_detalle IN (${detalleIds.map(() => "?").join(",")})`,
      detalleIds
    );
    await conn.query(
      `DELETE FROM movimiento_detalle WHERE id_detalle IN (${detalleIds.map(() => "?").join(",")})`,
      detalleIds
    );
    // Eliminar encabezados que quedaron sin detalles.
    await conn.query(
      `DELETE me FROM movimiento_encabezado me
       LEFT JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       WHERE me.id_movimiento IN (${movIds.map(() => "?").join(",")}) AND md.id_detalle IS NULL`,
      movIds
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });
    const estado = recalc.estado;

    await conn.commit();
    await writeSensitiveActionAudit({
      req,
      action_key: "REVERSA_DESPACHO_LINEA",
      action_label: "Reversa de linea despachada",
      approval: req.sensitive_approval,
      reference_type: "PEDIDO_DETALLE",
      reference_id: id_pedido_detalle,
      detail: { id_pedido, movimientos_revertidos: movIds.length, reverted_qty },
    });
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: estado,
      action: "reverted_line",
    });
    res.json({ ok: true, reverted_qty, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/orders/:id/cancel-line", auth, requirePermission("action.dispatch", "anular lineas de pedido"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  const justificacion = String(req.body?.justificacion || "").trim();
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  if (!justificacion) return res.status(400).json({ error: "La justificacion es obligatoria para anular una linea." });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      `SELECT id_bodega_solicita, id_bodega_surtidor
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido }
    );
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      await conn.rollback();
      return res.status(403).json({ error: "No puedes anular lineas de otra bodega" });
    }

    const [[line]] = await conn.query(
      `SELECT id_pedido_detalle, cantidad_solicitada, cantidad_surtida, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea
       FROM pedido_detalle
       WHERE id_pedido_detalle=:id_pedido_detalle
         AND id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido_detalle, id_pedido }
    );
    if (!line) {
      await conn.rollback();
      return res.status(404).json({ error: "Linea no encontrada" });
    }
    if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
      await conn.rollback();
      return res.status(400).json({ error: "La linea ya esta anulada." });
    }
    const pendiente = Math.max(0, Number(line.cantidad_solicitada || 0) - Number(line.cantidad_surtida || 0));
    if (pendiente <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: "La linea ya fue despachada completamente." });
    }

    await conn.query(
      `UPDATE pedido_detalle
       SET estado_linea='ANULADO',
           justificacion_linea=:justificacion,
           anulado_por=:anulado_por,
           anulado_en=NOW()
       WHERE id_pedido_detalle=:id_pedido_detalle`,
      {
        justificacion,
        anulado_por: req.user.id_user,
        id_pedido_detalle,
      }
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
      justificacion,
    });

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: recalc.estado,
      action: "cancel_line",
    });
    res.json({
      ok: true,
      status: recalc.estado,
      justificacion_despacho: recalc.justificacion_despacho || null,
      id_pedido_detalle,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/orders/:id/uncancel-line", auth, requirePermission("action.dispatch", "rehabilitar lineas anuladas"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_pedido = Number(req.params.id);
  const id_pedido_detalle = Number(req.body?.id_pedido_detalle || 0);
  if (!id_pedido_detalle) return res.status(400).json({ error: "Falta linea" });
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!actorWarehouse) return res.status(400).json({ error: "Usuario sin bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pe]] = await conn.query(
      `SELECT id_bodega_solicita, id_bodega_surtidor
       FROM pedido_encabezado
       WHERE id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido }
    );
    if (!pe) {
      await conn.rollback();
      return res.status(404).json({ error: "Pedido no existe" });
    }
    if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
      await conn.rollback();
      return res.status(403).json({ error: "No puedes modificar lineas de otra bodega" });
    }

    const [[line]] = await conn.query(
      `SELECT id_pedido_detalle, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea
       FROM pedido_detalle
       WHERE id_pedido_detalle=:id_pedido_detalle
         AND id_pedido=:id_pedido
       FOR UPDATE`,
      { id_pedido_detalle, id_pedido }
    );
    if (!line) {
      await conn.rollback();
      return res.status(404).json({ error: "Linea no encontrada" });
    }
    if (String(line.estado_linea || "").toUpperCase() !== "ANULADO") {
      await conn.rollback();
      return res.status(400).json({ error: "La linea no esta anulada." });
    }

    await conn.query(
      `UPDATE pedido_detalle
       SET estado_linea='PENDIENTE',
           justificacion_linea=NULL,
           anulado_por=NULL,
           anulado_en=NULL
       WHERE id_pedido_detalle=:id_pedido_detalle`,
      { id_pedido_detalle }
    );

    const recalc = await recomputePedidoEstado(conn, id_pedido, {
      actorUserId: req.user.id_user,
    });

    await conn.commit();
    emitPedidoChanged({
      id_pedido,
      requester_warehouse_id: pe?.id_bodega_solicita,
      requested_from_warehouse_id: pe?.id_bodega_surtidor,
      status: recalc.estado,
      action: "uncancel_line",
    });
    res.json({
      ok: true,
      status: recalc.estado,
      id_pedido_detalle,
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/reportes/tendencia-producto", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ producto: null, price_increases: [], price_monthly: [], price_status: "sin_datos", demand_by_date: [], demand_by_warehouse: [], top_consumer_warehouse: null, demand_peak_dates: [], from_date: null, to_date: null, base_warehouse: 0 });

    const requesterScope = getScopedWarehouseFilter(scope, req.query.warehouse_base);
    if (requesterScope.denied) return res.json({ producto: null, price_increases: [], price_monthly: [], price_status: "sin_datos", demand_by_date: [], demand_by_warehouse: [], top_consumer_warehouse: null, demand_peak_dates: [], from_date: null, to_date: null, base_warehouse: 0 });
    let id_bodega_base = requesterScope.selected;
    if (!scope.can_all_bodegas) id_bodega_base = scope.id_bodega;
    const requesterAccessFilter =
      requesterScope.restrictedIds.length && !id_bodega_base
        ? buildNamedInClause(requesterScope.restrictedIds, "rtpw")
        : null;

    const id_producto = Number(req.query.producto || 0) || null;
    if (!id_producto) return res.status(400).json({ error: "Producto requerido" });
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;

    const [[prod = null]] = await pool.query(
      `SELECT id_producto, nombre_producto, sku
       FROM productos
       WHERE id_producto=:id_producto`,
      { id_producto }
    );

    const [price_monthly] = await pool.query(
      `SELECT DATE_FORMAT(me.creado_en, '%Y-%m-01') AS periodo,
              ROUND(AVG(md.costo_unitario), 2) AS precio
       FROM movimiento_detalle md
       JOIN movimiento_encabezado me ON me.id_movimiento=md.id_movimiento
       WHERE md.id_producto=:id_producto
         AND md.costo_unitario IS NOT NULL AND md.costo_unitario>0
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
       GROUP BY DATE_FORMAT(me.creado_en, '%Y-%m-01')
       ORDER BY periodo ASC`,
      { id_producto, from_date, to_date }
    );

    const [price_increases] = await pool.query(
      `WITH mp AS (
         SELECT DATE_FORMAT(me.creado_en, '%Y-%m-01') AS fecha,
                ROUND(AVG(md.costo_unitario), 2) AS precio
         FROM movimiento_detalle md
         JOIN movimiento_encabezado me ON me.id_movimiento=md.id_movimiento
         WHERE md.id_producto=:id_producto
           AND md.costo_unitario IS NOT NULL AND md.costo_unitario>0
           AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
           AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
         GROUP BY DATE_FORMAT(me.creado_en, '%Y-%m-01')
       )
       SELECT m1.fecha,
              COALESCE(m2.precio, m1.precio) AS precio_anterior,
              m1.precio AS precio_nuevo,
              ROUND((m1.precio - COALESCE(m2.precio, m1.precio)) / COALESCE(m2.precio, m1.precio) * 100, 2) AS pct_up
       FROM mp m1
       LEFT JOIN mp m2 ON m2.fecha < m1.fecha
       WHERE NOT EXISTS (SELECT 1 FROM mp m3 WHERE m3.fecha < m1.fecha AND m3.fecha > COALESCE(m2.fecha, '0000-00-00'))
         AND (m2.fecha IS NULL OR m1.precio > m2.precio)
       ORDER BY m1.fecha ASC`,
      { id_producto, from_date, to_date }
    );

    let price_status = "sin_subidas";
    if (price_increases.length > 0) {
      price_status = "subio";
    } else if (price_monthly.length > 1) {
      const firstPrice = Number(price_monthly[0]?.precio || 0);
      const lastPrice = Number(price_monthly[price_monthly.length - 1]?.precio || 0);
      if (firstPrice === lastPrice) price_status = "se_mantuvo";
    }

    const [demand_by_date] = await pool.query(
      `SELECT DATE(me.creado_en) AS fecha,
              SUM(md.cantidad) AS cantidad_solicitada
       FROM movimiento_detalle md
       JOIN movimiento_encabezado me ON me.id_movimiento=md.id_movimiento
       WHERE md.id_producto=:id_producto
         AND me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND me.id_bodega_origen=:id_bodega_base
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
       GROUP BY DATE(me.creado_en)
       ORDER BY fecha ASC`,
      { id_producto, id_bodega_base, from_date, to_date }
    );

    const [warehouseRows] = await pool.query(
      `SELECT
        COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) AS id_bodega_destino,
        bdest.nombre_bodega,
        COALESCE(SUM(md.cantidad), 0) AS cantidad_sacada,
        COUNT(DISTINCT me.id_movimiento) AS pedidos
       FROM movimiento_encabezado me
       JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento
       LEFT JOIN (
         SELECT pmv.id_movimiento, MIN(pd.id_pedido) AS id_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         GROUP BY pmv.id_movimiento
       ) pm ON pm.id_movimiento=me.id_movimiento
       LEFT JOIN pedido_encabezado pe ON pe.id_pedido=pm.id_pedido
       LEFT JOIN bodegas bdest ON bdest.id_bodega=COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)
       WHERE md.id_producto=:id_producto
         AND me.tipo_movimiento IN ('SALIDA', 'TRANSFERENCIA')
         AND me.estado<>'ANULADO'
         AND me.id_bodega_origen=:id_bodega_base
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IS NOT NULL
         AND COALESCE(me.id_bodega_destino, pe.id_bodega_solicita)<>:id_bodega_base
         AND ${requesterAccessFilter ? `COALESCE(me.id_bodega_destino, pe.id_bodega_solicita) IN (${requesterAccessFilter.sql})` : "1=1"}
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
       GROUP BY COALESCE(me.id_bodega_destino, pe.id_bodega_solicita), bdest.nombre_bodega
       ORDER BY cantidad_sacada DESC, pedidos DESC, bdest.nombre_bodega ASC`,
      {
        id_producto,
        id_bodega_base,
        from_date,
        to_date,
        ...(requesterAccessFilter?.params || {}),
      }
    );

    const demand_by_warehouse = (warehouseRows || []).map((x) => ({
      id_bodega: Number(x.id_bodega_destino || 0),
      nombre_bodega: String(x.nombre_bodega || '').trim(),
      cantidad_sacada: Number(x.cantidad_sacada || 0),
      pedidos: Number(x.pedidos || 0),
    }));
    const top_consumer_warehouse = demand_by_warehouse.length ? demand_by_warehouse[0] : null;

    const demand_peak_dates = [...demand_by_date]
      .sort((a, b) => Number(b.cantidad_solicitada || 0) - Number(a.cantidad_solicitada || 0))
      .slice(0, 5);

    return res.json({
      producto: prod,
      base_warehouse: id_bodega_base,
      from_date,
      to_date,
      price_increases,
      price_monthly,
      price_status,
      demand_by_date,
      demand_by_warehouse,
      top_consumer_warehouse,
      demand_peak_dates,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/reportes/kardex", auth, async (req, res) => {
  try {
    // Compatibilidad: el cliente React (que envía ?page=) recibe
    // {rows,total,page,limit,totalPages}; el cliente legacy recibe array plano.
    const pageParam = req.query.page != null && req.query.page !== "" ? Math.max(1, Number(req.query.page || 1)) : null;
    const emptyPayload = pageParam ? { rows: [], total: 0, page: pageParam, limit: 100, totalPages: 1 } : [];

    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json(emptyPayload);

    const warehouseScope = getScopedWarehouseFilter(scope, req.query.warehouse);
    if (warehouseScope.denied) return res.json(emptyPayload);
    // Por defecto filtramos por la bodega del usuario (o la que pidió por
    // query param). Si se pasa `all_bodegas=1`, NO filtramos por bodega —
    // seguimos respetando `accessFilter` (bodegas permitidas) pero vemos
    // movimientos de todas las bodegas a las que el usuario tiene acceso.
    // Útil para la vista "Kardex por producto" donde el stock puede estar
    // en una bodega distinta a la del usuario.
    const allBodegasFlag = String(req.query.all_bodegas || "") === "1";
    let id_bodega = warehouseScope.selected;
    if (allBodegasFlag) id_bodega = null;
    else if (!scope.can_all_bodegas) id_bodega = scope.id_bodega;
    // Solo construimos accessFilter si hay bodegas permitidas (length > 0).
    // Si el usuario no tiene restricciones (BODEGUERO típico), el filtro
    // es null y se ve TODO. Si activó all_bodegas=1 pero no tiene
    // restricciones, también debe ver todo (no aplicar un `IN (NULL)` que
    // en MySQL no matchea ninguna fila).
    const accessFilter =
      warehouseScope.restrictedIds.length
        ? buildNamedInClause(warehouseScope.restrictedIds, "rkaw")
        : null;

    const qRaw = String(req.query.q || "").trim();
    const qf = buildTokenizedLikeFilter(qRaw, ["p.nombre_producto", "p.sku", "ui.nombre_completo"], "rkaq");
    const loteRaw = String(req.query.lote || "").trim();
    const lote = loteRaw ? `%${loteRaw}%` : null;
    const documentoRaw = String(req.query.documento || "").trim();
    const documento = documentoRaw ? `%${documentoRaw}%` : null;
    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const id_categoria = Number(req.query.categoria || 0) || null;
    const id_subcategoria = Number(req.query.subcategoria || 0) || null;
    const tipo = String(req.query.tipo || "").trim().toUpperCase() || null;
    const id_producto = Number(req.query.producto || 0) || null;
    const id_usuario = Number(req.query.usuario || 0) || null;
    const id_solicitante = Number(req.query.solicitante || 0) || null;
    const id_movimiento = Number(req.query.movimiento || 0) || null;
    const limit = Math.max(1, Math.min(8000, Number(req.query.limit || 2000)));

    const id_bodega_stock = scope.can_all_bodegas
      ? (id_bodega || null)
      : scope.id_bodega;

    const queryParams = {
      id_bodega,
      id_bodega_stock,
      tipo,
      id_movimiento,
      id_producto,
      id_usuario,
      id_solicitante,
      lote,
      documento,
      from_date,
      to_date,
      id_categoria,
      id_subcategoria,
      ...(accessFilter?.params || {}),
      ...qf.params,
    };

    const fromWhereSQL = `FROM kardex k
       JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
       LEFT JOIN bodegas bk ON bk.id_bodega=k.id_bodega
       LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
       LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
       JOIN productos p ON p.id_producto=k.id_producto
       LEFT JOIN categorias c ON c.id_categoria=p.id_categoria
       LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
       LEFT JOIN usuarios ui ON ui.id_usuario=me.creado_por
       LEFT JOIN (
         SELECT pmv.id_detalle,
                MIN(pd.id_pedido) AS id_pedido,
                MIN(pe.id_usuario_solicita) AS id_usuario_solicita,
                MIN(us.nombre_completo) AS solicitante_pedido
         FROM pedido_movimiento_vinculo pmv
         JOIN pedido_detalle pd ON pd.id_pedido_detalle=pmv.id_pedido_detalle
         JOIN pedido_encabezado pe ON pe.id_pedido=pd.id_pedido
         LEFT JOIN usuarios us ON us.id_usuario=pe.id_usuario_solicita
         GROUP BY pmv.id_detalle
       ) pm ON pm.id_detalle=k.id_detalle
       WHERE me.estado<>'ANULADO'
         AND ${accessFilter ? `k.id_bodega IN (${accessFilter.sql})` : "1=1"}
         AND (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
         AND (:tipo IS NULL OR me.tipo_movimiento=:tipo)
         AND (:id_movimiento IS NULL OR k.id_movimiento=:id_movimiento)
         AND (:id_producto IS NULL OR k.id_producto=:id_producto)
         AND (:id_usuario IS NULL OR me.creado_por=:id_usuario)
         AND (:id_solicitante IS NULL OR pm.id_usuario_solicita=:id_solicitante)
         AND ${qf.clause}
         AND (:lote IS NULL OR k.lote LIKE :lote)
         AND (:documento IS NULL OR me.no_documento LIKE :documento)
         AND (:from_date IS NULL OR DATE(COALESCE(k.creado_en, me.creado_en)) >= :from_date)
         AND (:to_date IS NULL OR DATE(COALESCE(k.creado_en, me.creado_en)) <= :to_date)
         AND (:id_categoria IS NULL OR p.id_categoria=:id_categoria)
         AND (:id_subcategoria IS NULL OR p.id_subcategoria=:id_subcategoria)`;

    const selectSQL = `SELECT k.id_movimiento,
              k.id_detalle,
              DATE(COALESCE(k.creado_en, me.creado_en)) AS fecha,
              TIME(COALESCE(k.creado_en, me.creado_en)) AS hora,
              COALESCE(k.creado_en, me.creado_en) AS creado_en,
              me.tipo_movimiento,
              me.no_documento,
              me.observaciones,
              k.id_bodega AS id_bodega_kardex,
              bk.nombre_bodega AS bodega_kardex,
              me.id_bodega_origen,
              bo.nombre_bodega AS bodega_origen,
              me.id_bodega_destino,
              bd.nombre_bodega AS bodega_destino,
              k.id_producto,
              p.nombre_producto,
              p.sku,
              p.id_categoria,
              c.nombre_categoria,
              p.id_subcategoria,
              sc.nombre_subcategoria,
              k.lote,
              k.fecha_vencimiento,
              k.delta_cantidad,
              CASE WHEN k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END AS cantidad_entrada,
              CASE WHEN k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END AS cantidad_salida,
              k.costo_unitario,
              ABS(k.delta_cantidad * k.costo_unitario) AS total_linea,
              (
                SELECT COALESCE(SUM(vs.stock),0)
                FROM v_stock_resumen vs
                WHERE vs.id_producto=k.id_producto
                  AND (:id_bodega_stock IS NULL OR vs.id_bodega=:id_bodega_stock)
              ) AS stock_total_producto,
              me.creado_por AS id_usuario_ingreso,
              ui.nombre_completo AS usuario_ingreso,
              pm.id_pedido,
              pm.id_usuario_solicita,
              pm.solicitante_pedido
       ${fromWhereSQL}`;

    const orderSQL = `ORDER BY CASE me.tipo_movimiento
                  WHEN 'ENTRADA' THEN 1
                  WHEN 'SALIDA' THEN 2
                  WHEN 'TRANSFERENCIA' THEN 3
                  ELSE 9
                END ASC,
                COALESCE(k.creado_en, me.creado_en) ASC,
                k.id_movimiento ASC,
                k.id_detalle ASC`;

    // Cliente React: paginado real con total/totalPages
    if (pageParam) {
      const offset = (pageParam - 1) * limit;
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total ${fromWhereSQL}`,
        queryParams
      );
      const totalRows = Number(total || 0);
      const [rows] = await pool.query(
        `${selectSQL}
        ${orderSQL}
        LIMIT ${limit} OFFSET ${offset}`,
        queryParams
      );
      return res.json({
        rows,
        total: totalRows,
        page: pageParam,
        limit,
        totalPages: Math.ceil(totalRows / Math.max(1, limit)) || 1,
      });
    }

    // Cliente legacy: array plano
    const [rows] = await pool.query(
      `${selectSQL}
        ${orderSQL}
        LIMIT ${limit}`,
      queryParams
    );

    res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});


app.get("/api/reportes/transferencias", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    if (!scope.id_bodega) return res.status(400).json({ error: "Usuario sin bodega" });
    if (!scope.can_view_existencias) return res.json({ rows: [], total: 0, page: 1, limit: 50, totalPages: 1 });

    const from_date = String(req.query.from || "").trim() || null;
    const to_date = String(req.query.to || "").trim() || null;
    const id_producto = Number(req.query.id_producto || 0) || null;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const page = Math.max(1, Number(req.query.page || 1));
    const offset = (page - 1) * limit;

    // Si se filtra por producto, se une detalle para poder filtrar por línea
    // (misma lógica que los reportes de entradas/salidas).
    const needsProductJoin = Boolean(id_producto);
    const productJoins = needsProductJoin
      ? `JOIN movimiento_detalle md ON md.id_movimiento=me.id_movimiento`
      : "";

    const params = { from_date, to_date, ...(needsProductJoin ? { id_producto } : {}) };
    const whereSQL = `me.tipo_movimiento='TRANSFERENCIA'
         AND me.estado<>'ANULADO'
         AND (:from_date IS NULL OR DATE(me.creado_en) >= :from_date)
         AND (:to_date IS NULL OR DATE(me.creado_en) <= :to_date)
         ${needsProductJoin ? "AND md.id_producto=:id_producto" : ""}`;

    // Paginado por MOVIMIENTO (no por línea)
    const [[{ total }]] = await pool.query(
      needsProductJoin
        ? `SELECT COUNT(DISTINCT me.id_movimiento) AS total
           FROM movimiento_encabezado me
           ${productJoins}
           WHERE ${whereSQL}`
        : `SELECT COUNT(*) AS total
           FROM movimiento_encabezado me
           WHERE ${whereSQL}`,
      params
    );
    const totalMovements = Number(total || 0);

    const [movements] = await pool.query(
      needsProductJoin
        ? `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           ${productJoins}
           WHERE ${whereSQL}
           GROUP BY me.id_movimiento
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`
        : `SELECT me.id_movimiento
           FROM movimiento_encabezado me
           WHERE ${whereSQL}
           ORDER BY me.creado_en DESC, me.id_movimiento DESC
           LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // Encabezados de la página actual
    const movMap = new Map();
    if (movements.length) {
      const ids = movements.map((m) => m.id_movimiento);
      const inClause = buildNamedInClause(ids, "tranm");
      const [headerRows] = await pool.query(
        `SELECT me.id_movimiento,
                me.tipo_movimiento,
                DATE(me.creado_en) AS fecha,
                TIME(me.creado_en) AS hora,
                me.creado_en,
                me.no_documento,
                me.observaciones,
                bo.nombre_bodega AS bodega_origen,
                bd.nombre_bodega AS bodega_destino,
                u.nombre_completo AS usuario_creador
         FROM movimiento_encabezado me
         LEFT JOIN bodegas bo ON bo.id_bodega=me.id_bodega_origen
         LEFT JOIN bodegas bd ON bd.id_bodega=me.id_bodega_destino
         LEFT JOIN usuarios u ON u.id_usuario=me.creado_por
         WHERE me.id_movimiento IN (${inClause.sql})`,
        inClause.params
      );
      for (const h of headerRows) {
        movMap.set(h.id_movimiento, { ...h, lineas: [] });
      }

      // Líneas de los movimientos de la página
      const lineClause = buildNamedInClause(ids, "trand");
      const lineParams = {
        ...lineClause.params,
        ...(needsProductJoin ? { id_producto } : {}),
      };
      const lineWhere = `md.id_movimiento IN (${lineClause.sql})${
        needsProductJoin ? " AND md.id_producto=:id_producto" : ""
      }`;
      const [lineRows] = await pool.query(
        `SELECT md.id_movimiento,
                md.id_detalle,
                md.id_producto,
                p.nombre_producto,
                p.sku,
                md.lote,
                md.fecha_vencimiento,
                md.cantidad,
                md.costo_unitario,
                (md.cantidad * md.costo_unitario) AS total_linea
         FROM movimiento_detalle md
         JOIN productos p ON p.id_producto=md.id_producto
         WHERE ${lineWhere}
         ORDER BY md.id_detalle ASC`,
        lineParams
      );
      for (const l of lineRows) {
        const g = movMap.get(l.id_movimiento);
        if (g) {
          g.lineas.push({
            id_detalle: l.id_detalle,
            id_producto: l.id_producto,
            nombre_producto: l.nombre_producto,
            sku: l.sku,
            lote: l.lote,
            fecha_vencimiento: l.fecha_vencimiento,
            cantidad: Number(l.cantidad || 0),
            costo_unitario: Number(l.costo_unitario || 0),
            total_linea: Number(l.total_linea || 0),
          });
        }
      }
    }

    // Mantener el orden de la paginación (creado_en DESC)
    const rows = movements
      .map((m) => movMap.get(m.id_movimiento))
      .filter(Boolean);

    res.json({
      rows,
      total: totalMovements,
      page,
      limit,
      totalPages: Math.ceil(totalMovements / Math.max(1, limit)),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   ROLES (LISTA)
========================= */
app.get("/api/roles", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id_rol AS id_role, nombre_rol AS role_name
     FROM roles
     WHERE activo=1
     ORDER BY nombre_rol ASC`
  );
  res.json(rows);
});


app.post("/api/usuarios", auth, requirePermission("action.manage_permissions", "crear usuarios"), async (req, res) => {
  try {
    const {
      username,
      full_name,
      password,
      order_pin = null,
      can_supervisor = 0,
      no_auto_logout = 0,
      id_role,
      id_warehouse = null,
      active = 1,
      avatar_data = null,
    } = req.body || {};

    const user = String(username || "").trim();
    const name = String(full_name || "").trim();
    const pass = String(password || "");
    const pinPedido = String(order_pin || "").trim();
    const canSupervisor = Number(can_supervisor) ? 1 : 0;
    const roleId = Number(id_role || 0);
    const warehouseId = Number(id_warehouse || 0) || null;
    const isActive = Number(active) ? 1 : 0;
    const noAutoLogout = Number(no_auto_logout) ? 1 : 0;
    const avatarData = normalizeAvatarData(avatar_data);

    if (!user) return res.status(400).json({ error: "Falta usuario" });
    if (!name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });
    if (pinPedido && !isValidOrderPin(pinPedido)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });
    if (!roleId) return res.status(400).json({ error: "Falta rol" });
    if (pinPedido) {
      const duplicatedPinOwner = await findOrderPinCollision(pinPedido, 0, pool, false);
      if (duplicatedPinOwner) {
        return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
      }
    }

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `INSERT INTO usuarios
       (usuario, nombre_completo, contrasena_hash, id_rol, id_bodega, activo, no_auto_logout)
       VALUES (:usuario, :nombre_completo, :contrasena_hash, :id_rol, :id_bodega, :activo, :no_auto_logout)`,
      {
        usuario: user,
        nombre_completo: name,
        contrasena_hash: passHash,
        id_rol: roleId,
        id_bodega: warehouseId,
        activo: isActive,
        no_auto_logout: noAutoLogout,
      }
    );

    if (avatarData) {
      try {
        await pool.query(
          `INSERT INTO usuario_avatar (id_usuario, avatar_data)
           VALUES (:id_usuario, :avatar_data)
           ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
          { id_usuario: r.insertId, avatar_data: avatarData }
        );
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    if (pinPedido) {
      const pinHash = await bcrypt.hash(pinPedido, 10);
      await pool.query(
        `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
         VALUES (:id_usuario, :pin_hash)
         ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
        { id_usuario: r.insertId, pin_hash: pinHash }
      );
    }
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: r.insertId, activo: canSupervisor }
    );

    clearPermisosCache(r.insertId); res.json({ ok: true, id_user: r.insertId });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   BODEGAS (EDITAR)
========================= */
app.patch("/api/bodegas/:id", auth, requirePermission("action.manage_permissions", "editar bodegas"), async (req, res) => {
  const id_bodega = Number(req.params.id || 0);
  const {
    nombre_bodega,
    tipo_bodega,
    activo = 1,
    maneja_stock = 1,
    puede_recibir = 1,
    puede_despachar = 1,
    modo_despacho_auto = "SALIDA",
    id_bodega_destino_default = null,
    permite_salida_conteo_final = 0,
    requiere_precio_salida = 0,
    telefono_contacto = null,
    direccion_contacto = null,
  } = req.body || {};

  if (!id_bodega) return res.status(400).json({ error: "Falta bodega" });
  if (!nombre_bodega) return res.status(400).json({ error: "Falta nombre" });
  if (!tipo_bodega) return res.status(400).json({ error: "Falta tipo" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [up] = await conn.query(
      `UPDATE bodegas
       SET nombre_bodega=:nombre_bodega,
           tipo_bodega=:tipo_bodega,
           activo=:activo,
           telefono_contacto=:telefono_contacto,
           direccion_contacto=:direccion_contacto
       WHERE id_bodega=:id_bodega`,
      {
        id_bodega,
        nombre_bodega,
        tipo_bodega,
        activo: activo ? 1 : 0,
        telefono_contacto: String(telefono_contacto || "").trim() || null,
        direccion_contacto: String(direccion_contacto || "").trim() || null,
      }
    );
    if (!up.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ error: "Bodega no existe" });
    }

    await conn.query(
      `INSERT INTO configuracion_bodega
       (id_bodega, maneja_stock, puede_recibir, puede_despachar, modo_despacho_auto, id_bodega_destino_default, permite_salida_conteo_final, requiere_precio_salida)
       VALUES (:id_bodega, :maneja_stock, :puede_recibir, :puede_despachar, :modo_despacho_auto, :id_bodega_destino_default, :permite_salida_conteo_final, :requiere_precio_salida)
       ON DUPLICATE KEY UPDATE
         maneja_stock=VALUES(maneja_stock),
         puede_recibir=VALUES(puede_recibir),
         puede_despachar=VALUES(puede_despachar),
         modo_despacho_auto=VALUES(modo_despacho_auto),
         id_bodega_destino_default=VALUES(id_bodega_destino_default),
         permite_salida_conteo_final=VALUES(permite_salida_conteo_final),
         requiere_precio_salida=VALUES(requiere_precio_salida)`,
      {
        id_bodega,
        maneja_stock: maneja_stock ? 1 : 0,
        puede_recibir: puede_recibir ? 1 : 0,
        puede_despachar: puede_despachar ? 1 : 0,
        modo_despacho_auto,
        id_bodega_destino_default: id_bodega_destino_default || null,
        permite_salida_conteo_final: permite_salida_conteo_final ? 1 : 0,
        requiere_precio_salida: requiere_precio_salida ? 1 : 0,
      }
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Ya existe una bodega con ese nombre" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   CONFIG: CONFIRMACION DE RECEPCION POR BODEGA
   Activa/desactiva que los despachos de esta bodega requieran
   el PIN del solicitante como fe de recibido.
========================= */
app.patch("/api/bodegas/:id/config-recepcion", auth, requirePermission("action.manage_permissions", "configurar bodegas"), async (req, res) => {
  try {
    const id_bodega = Number(req.params.id || 0);
    if (!id_bodega) return res.status(400).json({ error: "Bodega invalida" });
    const flag = req.body?.requiere_confirmacion_recepcion ? 1 : 0;

    const [[bod]] = await pool.query(
      `SELECT id_bodega FROM bodegas WHERE id_bodega=:id_bodega LIMIT 1`,
      { id_bodega }
    );
    if (!bod) return res.status(404).json({ error: "Bodega no existe" });

    await pool.query(
      `INSERT INTO configuracion_bodega (id_bodega, requiere_confirmacion_recepcion)
       VALUES (:id_bodega, :flag)
       ON DUPLICATE KEY UPDATE requiere_confirmacion_recepcion=VALUES(requiere_confirmacion_recepcion)`,
      { id_bodega, flag }
    );
    res.json({ ok: true, id_bodega, requiere_confirmacion_recepcion: flag });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (RESET PASSWORD)
========================= */
app.post("/api/usuarios/:id/reset-password", auth, requirePermission("action.manage_permissions", "restablecer contrasenas"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pass = String(req.body?.password || "");
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!pass || pass.length < 6) return res.status(400).json({ error: "Contrasena invalida" });

    const passHash = await bcrypt.hash(pass, 10);
    const [r] = await pool.query(
      `UPDATE usuarios
       SET contrasena_hash=:contrasena_hash
       WHERE id_usuario=:id_usuario`,
      { contrasena_hash: passHash, id_usuario: id_user }
    );

    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/usuarios/:id/reset-order-pin", auth, requirePermission("action.manage_permissions", "restablecer PIN de pedidos"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const pin = String(req.body?.pin || "").trim();
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!isValidOrderPin(pin)) return res.status(400).json({ error: "PIN de pedido invalido (6 a 12 digitos)" });

    const [usr] = await pool.query(
      `SELECT id_usuario
       FROM usuarios
       WHERE id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario: id_user }
    );
    if (!usr.length) return res.status(404).json({ error: "Usuario no existe" });
    const duplicatedPinOwner = await findOrderPinCollision(pin, id_user, pool, false);
    if (duplicatedPinOwner) {
      return res.status(409).json({ error: "Ese PIN de pedidos ya esta en uso por otro usuario" });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await pool.query(
      `INSERT INTO usuario_pin_pedido (id_usuario, pin_hash)
       VALUES (:id_usuario, :pin_hash)
       ON DUPLICATE KEY UPDATE pin_hash=VALUES(pin_hash)`,
      { id_usuario: id_user, pin_hash: pinHash }
    );

    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (EDITAR)
========================= */
app.patch("/api/usuarios/:id", auth, requirePermission("action.manage_permissions", "editar usuarios"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    const username = String(req.body?.username || "").trim();
    const full_name = String(req.body?.full_name || "").trim();
    const id_role = Number(req.body?.id_role || 0);
    const id_warehouse = Number(req.body?.id_warehouse || 0) || null;
    const active = Number(req.body?.active) ? 1 : 0;
    const no_auto_logout = Number(req.body?.no_auto_logout) ? 1 : 0;
    const can_supervisor = Number(req.body?.can_supervisor) ? 1 : 0;
    const hasAvatarField = Object.prototype.hasOwnProperty.call(req.body || {}, "avatar_data");
    const avatarData = normalizeAvatarData(req.body?.avatar_data);

    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (!username) return res.status(400).json({ error: "Falta usuario" });
    if (!full_name) return res.status(400).json({ error: "Falta nombre completo" });
    if (!id_role) return res.status(400).json({ error: "Falta rol" });

    const [r] = await pool.query(
      `UPDATE usuarios
       SET usuario=:usuario,
           nombre_completo=:nombre_completo,
           id_rol=:id_rol,
           id_bodega=:id_bodega,
           activo=:activo,
           no_auto_logout=:no_auto_logout
       WHERE id_usuario=:id_usuario`,
      {
        usuario: username,
        nombre_completo: full_name,
        id_rol: id_role,
        id_bodega: id_warehouse,
        activo: active,
        no_auto_logout,
        id_usuario: id_user,
      }
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Usuario no existe" });
    await pool.query(
      `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
       VALUES (:id_usuario, 'action.sensitive_approve', :activo)
       ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
      { id_usuario: id_user, activo: can_supervisor }
    );

    if (hasAvatarField) {
      try {
        if (avatarData) {
          await pool.query(
            `INSERT INTO usuario_avatar (id_usuario, avatar_data)
             VALUES (:id_usuario, :avatar_data)
             ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)`,
            { id_usuario: id_user, avatar_data: avatarData }
          );
        } else {
          await pool.query(`DELETE FROM usuario_avatar WHERE id_usuario=:id_usuario`, { id_usuario: id_user });
        }
      } catch (e) {
        if (!isAvatarTableMissingError(e)) throw e;
      }
    }

    clearPermisosCache(id_user);
    emitPermisosChanged(id_user, "user");
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "El usuario ya existe" });
    }
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (DESACTIVAR)
========================= */
app.post("/api/usuarios/:id/deactivate", auth, requirePermission("action.manage_permissions", "desactivar usuarios"), async (req, res) => {
  try {
    const id_user = Number(req.params.id || 0);
    if (!id_user) return res.status(400).json({ error: "Falta usuario" });
    if (Number(req.user?.id_user || 0) === id_user) {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
    }
    const [r] = await pool.query(
      `UPDATE usuarios
       SET activo=0
       WHERE id_usuario=:id_usuario`,
      { id_usuario: id_user }
    );
    if (!r.affectedRows) {
      const [chk] = await pool.query(
        `SELECT id_usuario FROM usuarios WHERE id_usuario=:id_usuario LIMIT 1`,
        { id_usuario: id_user }
      );
      if (!chk.length) return res.status(404).json({ error: "Usuario no existe" });
    }
    clearPermisosCache(id_user);
    emitPermisosChanged(id_user, "deactivated");
    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   USUARIOS (LISTA)
========================= */
app.get("/api/usuarios", auth, async (req, res) => {
  const all = String(req.query.all || "") === "1";
  let rows = [];
  try {
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              ua.avatar_data AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       LEFT JOIN usuario_avatar ua ON ua.id_usuario=u.id_usuario
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  } catch (e) {
    if (!isAvatarTableMissingError(e)) throw e;
    [rows] = await pool.query(
      `SELECT u.id_usuario AS id_user,
              u.usuario AS username,
              u.nombre_completo AS full_name,
              u.id_bodega AS id_warehouse,
              u.id_rol AS id_role,
              u.activo AS active,
              u.no_auto_logout AS no_auto_logout,
              COALESCE((
                SELECT up.activo
                FROM usuario_permisos up
                WHERE up.id_usuario=u.id_usuario
                  AND up.permiso='action.sensitive_approve'
                LIMIT 1
              ), 0) AS can_supervisor,
              r.nombre_rol AS role_name,
              b.nombre_bodega AS warehouse_name,
              '' AS avatar_url
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       LEFT JOIN bodegas b ON b.id_bodega=u.id_bodega
       WHERE (:all=1 OR u.activo=1)
       ORDER BY u.nombre_completo ASC`,
      { all: all ? 1 : 0 }
    );
  }
  res.json(rows);
});

app.get("/api/permisos/catalogo", auth, async (req, res) => {
  res.json(PERM_CATALOG);
});

app.get("/api/me/permisos", auth, async (req, res) => {
  try {
    const id_usuario = Number(req.user?.id_user || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    const scope = await resolveStockScope(req.user);
    res.json({
      permisos: map,
      catalogo: PERM_CATALOG,
      is_admin_role: Number(scope?.is_admin_role ? 1 : 0),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/usuarios/:id/permisos", auth, async (req, res) => {
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const map = await getUserPermissionsMap(id_usuario);
    res.json({ id_usuario, permisos: map, catalogo: PERM_CATALOG });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/usuarios/:id/bodegas-acceso", auth, async (req, res) => {
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });

    const [rows] = await pool.query(
      `SELECT uba.id_bodega, b.nombre_bodega
       FROM usuario_bodegas_acceso uba
       JOIN bodegas b ON b.id_bodega=uba.id_bodega
       WHERE uba.id_usuario=:id_usuario
       ORDER BY b.nombre_bodega ASC, uba.id_bodega ASC`,
      { id_usuario }
    );
    res.json({
      id_usuario,
      bodegas: rows || [],
      ids: normalizeWarehouseIdList((rows || []).map((r) => r.id_bodega)),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.put("/api/usuarios/:id/bodegas-acceso", auth, requirePermission("action.manage_permissions", "asignar bodegas a usuarios"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureUserWarehouseAccessTable();
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar accesos de bodegas" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const ids = normalizeWarehouseIdList(req.body?.id_bodegas || []);

    const [[userRow]] = await conn.query(
      `SELECT u.id_usuario, r.nombre_rol
       FROM usuarios u
       LEFT JOIN roles r ON r.id_rol=u.id_rol
       WHERE u.id_usuario=:id_usuario
       LIMIT 1`,
      { id_usuario }
    );
    if (!userRow) return res.status(404).json({ error: "Usuario no existe" });

    const roleName = String(userRow?.nombre_rol || "").trim().toUpperCase();
    const isReportRole = roleName.includes("REPORTE");
    const isAdminRole = roleName.includes("ADMIN");
    if (!isReportRole || isAdminRole) {
      return res.status(400).json({ error: "Solo usuarios de reportes no administradores pueden tener este filtro" });
    }

    if (ids.length) {
      const inClause = buildNamedInClause(ids, "uba");
      const [validRows] = await conn.query(
        `SELECT id_bodega
         FROM bodegas
         WHERE activo=1
           AND id_bodega IN (${inClause.sql})`,
        inClause.params
      );
      const validIds = normalizeWarehouseIdList((validRows || []).map((r) => r.id_bodega));
      if (validIds.length !== ids.length) {
        return res.status(400).json({ error: "Una o mas bodegas no son validas o no estan activas" });
      }
    }

    await conn.beginTransaction();
    await conn.query(
      `DELETE FROM usuario_bodegas_acceso
       WHERE id_usuario=:id_usuario`,
      { id_usuario }
    );
    for (const id_bodega of ids) {
      await conn.query(
        `INSERT INTO usuario_bodegas_acceso (id_usuario, id_bodega)
         VALUES (:id_usuario, :id_bodega)`,
        { id_usuario, id_bodega }
      );
    }
    await conn.commit();
    emitPermisosChanged(id_usuario, "bodegas-acceso");
    res.json({ ok: true, id_usuario, id_bodegas: ids });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

/* =========================
   USUARIOS (COPIAR DE OTRO)
   Copia permisos (y opcionalmente bodegas-acceso) desde un usuario origen
   al usuario destino. Sobrescribe los valores actuales del destino.
========================= */
app.post("/api/usuarios/:id/copy-from/:sourceId", auth, requirePermission("action.manage_permissions", "copiar permisos entre usuarios"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id_destino = Number(req.params.id || 0);
    const id_origen = Number(req.params.sourceId || 0);
    const copyPermisos = req.body?.copy_permisos !== false; // default true
    const copyBodegas = req.body?.copy_bodegas === true;

    if (!id_destino) return res.status(400).json({ error: "Usuario destino invalido" });
    if (!id_origen) return res.status(400).json({ error: "Usuario origen invalido" });
    if (id_destino === id_origen) {
      return res.status(400).json({ error: "Origen y destino no pueden ser el mismo usuario" });
    }

    // Validar que ambos usuarios existan
    const [users] = await conn.query(
      `SELECT id_usuario FROM usuarios WHERE id_usuario IN (?, ?)`,
      [id_destino, id_origen]
    );
    const found = new Set(users.map((r) => Number(r.id_usuario)));
    if (!found.has(id_destino)) return res.status(404).json({ error: "Usuario destino no existe" });
    if (!found.has(id_origen)) return res.status(404).json({ error: "Usuario origen no existe" });

    const copied = { permisos: 0, bodegas: 0 };

    await conn.beginTransaction();

    if (copyPermisos) {
      // Tomamos el mapa EFECTIVO del origen (defaults + filas explícitas)
      // y lo escribimos como filas explícitas en el destino. Esto hace que
      // el destino termine con exactamente los mismos permisos efectivos
      // que el origen, sin importar qué tenga explícito.
      const sourceMap = permissionDefaults();
      const [sourceRows] = await conn.query(
        `SELECT permiso, activo FROM usuario_permisos WHERE id_usuario=:id_usuario`,
        { id_usuario: id_origen }
      );
      for (const r of sourceRows || []) {
        if (Object.prototype.hasOwnProperty.call(sourceMap, r.permiso)) {
          sourceMap[r.permiso] = Number(r.activo) ? 1 : 0;
        }
      }

      // Borramos lo actual del destino
      await conn.query(`DELETE FROM usuario_permisos WHERE id_usuario=:id_usuario`, { id_usuario: id_destino });

      // Insertamos el snapshot del origen
      for (const k of Object.keys(sourceMap)) {
        await conn.query(
          `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
           VALUES (:id_usuario, :permiso, :activo)
           ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
          { id_usuario: id_destino, permiso: k, activo: sourceMap[k] }
        );
        copied.permisos++;
      }
    }

    if (copyBodegas) {
      // Solo tiene sentido para roles REPORTE no-admin (igual que el PUT normal)
      const [[destRow]] = await conn.query(
        `SELECT r.nombre_rol
         FROM usuarios u
         LEFT JOIN roles r ON r.id_rol=u.id_rol
         WHERE u.id_usuario=:id_usuario LIMIT 1`,
        { id_usuario: id_destino }
      );
      const roleName = String(destRow?.nombre_rol || "").trim().toUpperCase();
      const isReportRole = roleName.includes("REPORTE");
      const isAdminRole = roleName.includes("ADMIN");
      if (!isReportRole || isAdminRole) {
        await conn.rollback();
        return res.status(400).json({ error: "El usuario destino no admite filtro de bodegas (no es rol REPORTE)" });
      }

      const [sourceBodRows] = await conn.query(
        `SELECT id_bodega FROM usuario_bodegas_acceso WHERE id_usuario=:id_usuario ORDER BY id_bodega ASC`,
        { id_usuario: id_origen }
      );
      const sourceBodegas = (sourceBodRows || []).map((r) => Number(r.id_bodega));

      await conn.query(`DELETE FROM usuario_bodegas_acceso WHERE id_usuario=:id_usuario`, { id_usuario: id_destino });
      for (const id_bodega of sourceBodegas) {
        await conn.query(
          `INSERT INTO usuario_bodegas_acceso (id_usuario, id_bodega) VALUES (:id_usuario, :id_bodega)`,
          { id_usuario: id_destino, id_bodega }
        );
      }
      copied.bodegas = sourceBodegas.length;
    }

    await conn.commit();
    clearPermisosCache(id_destino);
    // Avisar al usuario destino para que recargue su snapshot en vivo
    emitPermisosChanged(id_destino, copyBodegas ? "bodegas-acceso" : "permisos");
    res.json({ ok: true, id_destino, id_origen, copied });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.put("/api/usuarios/:id/permisos", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const requester = Number(req.user?.id_user || 0);
    if (!requester) return res.status(401).json({ error: "Usuario invalido" });
    const allowed = await canManageUserPermissions(requester);
    if (!allowed) return res.status(403).json({ error: "Sin permiso para administrar permisos" });

    const id_usuario = Number(req.params.id || 0);
    if (!id_usuario) return res.status(400).json({ error: "Usuario invalido" });
    const input = req.body?.permisos || {};
    const map = permissionDefaults();

    if (Array.isArray(input)) {
      for (const it of input) {
        const k = String(it?.permiso || "");
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        map[k] = Number(it?.activo) ? 1 : 0;
      }
    } else if (input && typeof input === "object") {
      for (const k of Object.keys(map)) {
        if (Object.prototype.hasOwnProperty.call(input, k)) {
          map[k] = Number(input[k]) ? 1 : 0;
        }
      }
    } else {
      return res.status(400).json({ error: "Formato de permisos invalido" });
    }

    await conn.beginTransaction();
    for (const k of Object.keys(map)) {
      await conn.query(
        `INSERT INTO usuario_permisos (id_usuario, permiso, activo)
         VALUES (:id_usuario, :permiso, :activo)
         ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
        { id_usuario, permiso: k, activo: map[k] }
      );
    }
    await conn.commit();
    clearPermisosCache(id_usuario);
    emitPermisosChanged(id_usuario, "permisos");
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.get("/api/ops/metrics", auth, requirePermission("action.manage_permissions", "ver metricas operativas"), async (req, res) => {
  try {
    const alerts = buildOperationalAlerts();
    const avgApiLatency =
      opsMetrics.api.total > 0 ? Number((opsMetrics.api.total_latency_ms / opsMetrics.api.total).toFixed(2)) : 0;
    const avgDbLatency =
      opsMetrics.db.total_queries > 0 ? Number((opsMetrics.db.total_latency_ms / opsMetrics.db.total_queries).toFixed(2)) : 0;
    res.json({
      ok: true,
      started_at: opsMetrics.started_at,
      api: {
        total: opsMetrics.api.total,
        errors_4xx: opsMetrics.api.errors_4xx,
        errors_5xx: opsMetrics.api.errors_5xx,
        avg_latency_ms: avgApiLatency,
        max_latency_ms: opsMetrics.api.max_latency_ms,
      },
      db: {
        total_queries: opsMetrics.db.total_queries,
        failures: opsMetrics.db.failures,
        avg_latency_ms: avgDbLatency,
        max_latency_ms: opsMetrics.db.max_latency_ms,
        recent_failures_5m: opsMetrics.db.recent_failures.length,
        last_error: opsMetrics.db.last_error,
      },
      pin_failures: {
        order_15m: opsMetrics.pin_failures.order.length,
        supervisor_15m: opsMetrics.pin_failures.supervisor.length,
      },
      sensitive_actions: opsMetrics.sensitive_actions,
      stock_actual: opsMetrics.stock_actual,
      alerts,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/ops/backup/status", auth, requirePermission("action.manage_permissions", "ver estado de backups"), async (req, res) => {
  try {
    const [[lastBackup]] = await pool.query(
      `SELECT id_backup, backup_date, trigger_type, status, file_path, bytes_written, creado_en, finalizado_en, error_message
       FROM backup_audit
       ORDER BY id_backup DESC
       LIMIT 1`
    );
    const [[lastRecovery]] = await pool.query(
      `SELECT id_test, trigger_type, status, source_file, creado_en, finalizado_en, error_message
       FROM recovery_test_audit
       ORDER BY id_test DESC
       LIMIT 1`
    );
    res.json({
      ok: true,
      backup_auto_enabled: OPS_BACKUP_AUTO_ENABLED,
      backup_interval_ms: OPS_BACKUP_INTERVAL_MS,
      backup_dir: OPS_BACKUP_BASE_DIR,
      last_backup: lastBackup || null,
      last_recovery_test: lastRecovery || null,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/ops/backup/run", auth, requirePermission("action.manage_permissions", "ejecutar backup"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await createLogicalBackup({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo generar backup" });
    res.json(r);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/ops/backup/recovery-test", auth, requirePermission("action.manage_permissions", "ejecutar prueba de recovery"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await runRecoveryDryTest({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo ejecutar prueba de recovery" });
    res.json(r);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Transferencia manual entre bodegas ----------
app.post("/api/transferencias", auth, requirePermission("action.create_update", "crear transferencias"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const { id_bodega_origen = null, id_bodega_destino = null, observaciones = null, lines = [] } = req.body || {};

  if (!id_bodega_origen || !id_bodega_destino) {
    return res.status(400).json({ error: "Faltan bodegas origen y/o destino" });
  }
  if (Number(id_bodega_origen) === Number(id_bodega_destino)) {
    return res.status(400).json({ error: "La bodega origen y destino deben ser diferentes" });
  }
  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: "Sin lineas de producto" });
  }
  if (!beginIdempotentRequest(req, res, { pathKey: "/api/transferencias" })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada. Espera unos segundos e intenta de nuevo." });
  }

  const id_origen = Number(id_bodega_origen);
  const id_destino = Number(id_bodega_destino);

  // Solo puedes sacar stock de TU bodega (salvo roles admin).
  const stockScope = await resolveStockScope(req.user);
  const actorWarehouse = Number(req.user?.id_warehouse || 0);
  if (!stockScope.is_admin_role && id_origen !== actorWarehouse) {
    return res.status(403).json({ error: "Solo puedes transferir desde tu propia bodega" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Validar bodega origen
    const [[origenRow]] = await conn.query(
      `SELECT b.id_bodega, b.activo, cb.maneja_stock
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: id_origen }
    );
    if (!origenRow || Number(origenRow.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega origen no disponible" });
    }

    // Validar bodega destino
    const [[destRow]] = await conn.query(
      `SELECT b.id_bodega, b.activo, cb.maneja_stock, cb.puede_recibir
       FROM bodegas b
       LEFT JOIN configuracion_bodega cb ON cb.id_bodega=b.id_bodega
       WHERE b.id_bodega=:id_bodega
       LIMIT 1`,
      { id_bodega: id_destino }
    );
    if (!destRow || Number(destRow.activo || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega destino no disponible" });
    }
    if (Number(destRow.maneja_stock || 0) !== 1) {
      await conn.rollback();
      return res.status(400).json({ error: "La bodega destino no maneja stock" });
    }

    // Buscar motivo TRANSFERENCIA
    const [[mot]] = await conn.query(
      `SELECT id_motivo, nombre_motivo
       FROM motivos_movimiento
       WHERE tipo_movimiento='TRANSFERENCIA' AND activo=1
       ORDER BY (nombre_motivo='Transferencia') DESC, id_motivo ASC
       LIMIT 1`
    );
    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: "No existe motivo de tipo TRANSFERENCIA" });
    }

    // Crear movimiento_encabezado
    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('TRANSFERENCIA', :id_motivo, :id_bodega_origen, :id_bodega_destino, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        id_motivo: mot.id_motivo,
        id_bodega_origen: id_origen,
        id_bodega_destino: id_destino,
        observaciones: String(observaciones || "").trim() || null,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento = mhRes.insertId;

    // Procesar líneas
    let totalLineas = 0;
    for (const line of lines) {
      const id_producto = Number(line.id_producto || 0);
      const cantidad = Number(line.cantidad || 0);
      const loteSolicitado = String(line.lote || "").trim() || null;
      const precio = Number(line.precio || 0) || 0;

      if (!id_producto || cantidad <= 0) continue;

      // Validar producto y visibilidad en ambas bodegas
      const [[prod]] = await conn.query(
        `SELECT id_producto FROM productos WHERE id_producto=:id_producto LIMIT 1`,
        { id_producto }
      );
      if (!prod) {
        await conn.rollback();
        return res.status(400).json({ error: `Producto #${id_producto} no existe` });
      }
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_origen))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega origen` });
      }
      if (!(await isProductVisibleInWarehouse(conn, id_producto, id_destino))) {
        await conn.rollback();
        return res.status(400).json({ error: `El producto #${id_producto} no esta habilitado para la bodega destino` });
      }

      // Seleccionar lotes: FEFO si no se especifica lote; validar el lote pedido si viene.
      let picks = [];
      if (loteSolicitado) {
        await conn.query(`SELECT id_producto FROM productos WHERE id_producto=:id_producto FOR UPDATE`, { id_producto });
        const [[lotRow]] = await conn.query(
          `SELECT lote, fecha_vencimiento, stock
           FROM v_stock_disponible
           WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote=:lote
           LIMIT 1`,
          { id_bodega: id_origen, id_producto, lote: loteSolicitado }
        );
        const stockLote = Number(lotRow?.stock || 0);
        if (!lotRow || stockLote < cantidad) {
          await conn.rollback();
          return res.status(400).json({
            error: `Stock insuficiente del lote "${loteSolicitado}" para producto #${id_producto}: disponible ${stockLote}, solicitado ${cantidad}`,
          });
        }
        picks = [{ lote: loteSolicitado, fecha_vencimiento: lotRow.fecha_vencimiento, qty: cantidad }];
      } else {
        const r = await pickLotsFEFO(conn, id_origen, id_producto, cantidad, { allowExpired: false });
        if (!r.picks.length || r.remaining > 0) {
          await conn.rollback();
          return res.status(400).json({
            error: `Stock insuficiente (vigente) en origen para producto #${id_producto}: solicitado ${cantidad}`,
          });
        }
        picks = r.picks;
      }

      for (const p of picks) {
        // Determinar costo unitario (ultimo costo de entrada del lote en origen)
        const cost = precio > 0 ? precio : await getLastUnitCost(conn, id_origen, id_producto, p.lote);

        // Insertar movimiento_detalle
        const [d] = await conn.query(
          `INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_producto, :lote, :fecha, :cantidad, :costo_unitario)`,
          {
            id_movimiento,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            cantidad: p.qty,
            costo_unitario: cost,
          }
        );
        const id_detalle = d.insertId;

        // Kardex: salida de origen
        await conn.query(
          `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha, :delta, :costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: id_origen,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: -p.qty,
            costo: cost,
          }
        );

        // Kardex: entrada en destino (conserva lote y fecha de vencimiento)
        await conn.query(
          `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha, :delta, :costo)`,
          {
            id_movimiento,
            id_detalle,
            id_bodega: id_destino,
            id_producto,
            lote: p.lote || null,
            fecha: p.fecha_vencimiento || null,
            delta: +p.qty,
            costo: cost,
          }
        );
      }

      totalLineas++;
    }

    if (totalLineas === 0) {
      await conn.rollback();
      return res.status(400).json({ error: "Ninguna linea valida para transferir" });
    }

    await conn.commit();
    res.json({ ok: true, id_movimiento, total_lineas: totalLineas });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error("Error en POST /api/transferencias:", e);
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

// ---------- Revertir una transferencia ----------
// ── Revertir cualquier movimiento (entrada, salida, ajuste) ──
app.post("/api/movimientos/:id/revert", auth, requirePermission("action.create_update", "revertir movimientos"), requireSensitiveApproval("reversa de movimiento"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_movimiento = Number(req.params.id);
  if (!id_movimiento) return res.status(400).json({ error: "ID de movimiento invalido" });
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/movimientos/${id_movimiento}/revert` })) {
    return res.status(409).json({ error: "Solicitud duplicada. Espera unos segundos." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Verificar que el movimiento existe y es reversible
    const [[mov]] = await conn.query(
      `SELECT id_movimiento, tipo_movimiento, id_bodega_origen, id_bodega_destino,
              id_motivo, no_documento, observaciones, estado, creado_en, creado_por
       FROM movimiento_encabezado
       WHERE id_movimiento=:id
       LIMIT 1`,
      { id: id_movimiento }
    );

    if (!mov) {
      await conn.rollback();
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }

    if (String(mov.estado || "").toUpperCase() === "ANULADO") {
      await conn.rollback();
      return res.status(400).json({ error: "El movimiento ya fue anulado previamente" });
    }

    // Regla de negocio: solo se puede revertir el mismo dia (mensaje claro, no error de trigger).
    if (localYmd(mov.creado_en) !== localYmd(new Date())) {
      await conn.rollback();
      return res.status(400).json({ error: "Solo se pueden revertir movimientos del mismo dia" });
    }

    const tipo = String(mov.tipo_movimiento || "").toUpperCase();
    if (!["ENTRADA", "SALIDA", "AJUSTE"].includes(tipo)) {
      await conn.rollback();
      return res.status(400).json({ error: `No se puede revertir un movimiento de tipo ${tipo}` });
    }

    // 2. Verificar que el movimiento no haya sido revertido antes
    const [[rev]] = await conn.query(
      `SELECT id_movimiento
       FROM movimiento_encabezado
       WHERE observaciones LIKE :pat
       LIMIT 1`,
      { pat: `%REVERSIÓN de #${id_movimiento}%` }
    );
    if (rev) {
      await conn.rollback();
      return res.status(400).json({ error: `El movimiento #${id_movimiento} ya fue revertido (movimiento #${rev.id_movimiento})` });
    }

    // 3. Obtener las líneas originales del movimiento
    const [lines] = await conn.query(
      `SELECT id_detalle, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario
       FROM movimiento_detalle
       WHERE id_movimiento=:id_movimiento`,
      { id_movimiento }
    );

    if (!lines.length) {
      await conn.rollback();
      return res.status(400).json({ error: "El movimiento no tiene líneas para revertir" });
    }

    // 4. Determinar bodega para la reversión
    const id_bodega =
      tipo === "ENTRADA"
        ? Number(mov.id_bodega_destino || 0)
        : Number(mov.id_bodega_origen || 0);

    if (!id_bodega) {
      await conn.rollback();
      return res.status(400).json({ error: "El movimiento no tiene bodega asociada" });
    }

    // 5. Crear movimiento inverso (delta_cantidad negativa para entradas, positiva para salidas)
    const obsReversion = `REVERSIÓN de #${id_movimiento}. Motivo original: ${mov.no_documento || 'N/D'}. ${mov.observaciones || ''}`.trim();

    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, no_documento, observaciones, creado_por, estado)
       VALUES (:tipo, :id_motivo, :id_bodega_origen, :id_bodega_destino, :no_documento, :observaciones, :creado_por, 'CONFIRMADO')`,
      {
        tipo: tipo === "ENTRADA" ? "AJUSTE" : tipo,
        id_motivo: mov.id_motivo,
        id_bodega_origen: tipo === "ENTRADA" ? id_bodega : null,
        id_bodega_destino: tipo === "ENTRADA" ? null : id_bodega,
        no_documento: `REV-${id_movimiento}`,
        observaciones: obsReversion.slice(0, 255),
        creado_por: req.user?.id_user || 0,
      }
    );
    const id_reversion = Number(mhRes.insertId || 0);

    // 6. Insertar en kardex el INVERSO EXACTO de cada fila original.
    //    Así se revierten bien ENTRADA, SALIDA y AJUSTE (de entrada o de salida).
    let totalLineas = 0;

    for (const ln of lines) {
      if (Math.abs(Number(ln.cantidad || 0)) === 0) continue;

      const [d] = await conn.query(
        `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
         VALUES (:id_movimiento, :id_producto, :lote, :fecha_vencimiento, :cantidad, :costo_unitario, :observacion_linea)`,
        {
          id_movimiento: id_reversion,
          id_producto: ln.id_producto,
          lote: ln.lote || null,
          fecha_vencimiento: ln.fecha_vencimiento || null,
          cantidad: Math.abs(Number(ln.cantidad || 0)),
          costo_unitario: ln.costo_unitario || 0,
          observacion_linea: `REVERSIÓN #${id_movimiento}`,
        }
      );
      const id_detalle_rev = Number(d.insertId || 0);

      // Invertir cada fila de kardex original de este detalle (puede tocar varias bodegas).
      const [kx] = await conn.query(
        `SELECT id_bodega, lote, fecha_vencimiento, SUM(delta_cantidad) AS delta, costo_unitario
         FROM kardex
         WHERE id_detalle=:id_detalle
         GROUP BY id_bodega, lote, fecha_vencimiento, costo_unitario`,
        { id_detalle: ln.id_detalle }
      );

      for (const row of kx) {
        const deltaInv = -Number(row.delta || 0);
        if (deltaInv === 0) continue;

        // Si la reversa retira stock, validar que la bodega aun lo tenga.
        if (deltaInv < 0) {
          await conn.query(`SELECT id_producto FROM productos WHERE id_producto=? FOR UPDATE`, [ln.id_producto]);
          const [[st]] = await conn.query(
            `SELECT COALESCE(SUM(delta_cantidad),0) AS stock
             FROM kardex
             WHERE id_bodega=? AND id_producto=? AND lote <=> ?`,
            [row.id_bodega, ln.id_producto, row.lote]
          );
          if (Number(st?.stock || 0) < Math.abs(deltaInv) - 1e-9) {
            await conn.rollback();
            return res.status(400).json({
              error: `No se puede revertir: stock insuficiente del producto #${ln.id_producto} (lote ${row.lote ?? "sin lote"}) en bodega #${row.id_bodega}. Ya fue consumido.`,
            });
          }
        }

        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha_vencimiento, :delta_cantidad, :costo_unitario)`,
          {
            id_movimiento: id_reversion,
            id_detalle: id_detalle_rev,
            id_bodega: row.id_bodega,
            id_producto: ln.id_producto,
            lote: row.lote || null,
            fecha_vencimiento: row.fecha_vencimiento || null,
            delta_cantidad: deltaInv,
            costo_unitario: row.costo_unitario || 0,
          }
        );
      }

      totalLineas++;
    }

    // 7. Marcar movimiento original como ANULADO
    await conn.query(
      `UPDATE movimiento_encabezado
SET estado='ANULADO', anulado_por=:anulado_por, anulado_en=NOW()
WHERE id_movimiento=:id_movimiento`,
      { id_movimiento, anulado_por: Number(req.user?.id_user || 0) }
    );

    await conn.commit();

    await writeSensitiveActionAudit({
      req,
      action_key: "REVERSA_MOVIMIENTO",
      action_label: "Reversa de movimiento",
      approval: req.sensitive_approval,
      reference_type: "MOVIMIENTO",
      reference_id: id_movimiento,
      detail: { id_reversion, tipo, lineas: totalLineas },
    });

    // 8. Notificar en tiempo real
    emitStockChanged(id_bodega, {
      action: tipo === "ENTRADA" ? "reversion_entrada" : "reversion_salida",
      id_movimiento: id_reversion,
      nombre_bodega: "",
    });

    res.json({
      ok: true,
      id_movimiento: id_reversion,
      mensaje: `Movimiento #${id_movimiento} revertido. Se creó el movimiento #${id_reversion}.`,
      sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

app.post("/api/transferencias/:id/revert", auth, requirePermission("action.create_update", "revertir transferencias"), enforceDailyCloseBeforeMutations, async (req, res) => {
  const id_movimiento_original = Number(req.params.id || 0);
  if (!id_movimiento_original) {
    return res.status(400).json({ error: "ID de movimiento invalido" });
  }
  if (!beginIdempotentRequest(req, res, { pathKey: `/api/transferencias/${id_movimiento_original}/revert` })) {
    return res.status(409).json({ error: "Solicitud duplicada detectada." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Leer encabezado original
    const [[original]] = await conn.query(
      `SELECT id_movimiento, tipo_movimiento, id_bodega_origen, id_bodega_destino, creado_en, estado
       FROM movimiento_encabezado
       WHERE id_movimiento=:id_movimiento
       LIMIT 1
       FOR UPDATE`,
      { id_movimiento: id_movimiento_original }
    );
    if (!original) {
      await conn.rollback();
      return res.status(404).json({ error: "Movimiento no encontrado" });
    }
    if (String(original.tipo_movimiento || "").toUpperCase() !== "TRANSFERENCIA") {
      await conn.rollback();
      return res.status(400).json({ error: "El movimiento no es una transferencia" });
    }
    if (String(original.estado || "").toUpperCase() === "ANULADO") {
      await conn.rollback();
      return res.status(400).json({ error: "La transferencia ya esta anulada" });
    }
    // Regla de negocio: solo se puede revertir el mismo dia.
    if (localYmd(original.creado_en) !== localYmd(new Date())) {
      await conn.rollback();
      return res.status(400).json({ error: "Solo se pueden revertir transferencias del mismo dia" });
    }

    // Verificar que no se haya revertido ya (buscar transferencia que referencia a la original)
    const [[existingRevert]] = await conn.query(
      `SELECT id_movimiento FROM movimiento_encabezado
       WHERE observaciones LIKE :ref
       LIMIT 1`,
      { ref: `%REVERSIÓN de #${id_movimiento_original}%` }
    );
    if (existingRevert) {
      await conn.rollback();
      return res.status(400).json({ error: `Esta transferencia ya fue revertida (movimiento #${existingRevert.id_movimiento})` });
    }

    const id_origen = Number(original.id_bodega_origen);
    const id_destino = Number(original.id_bodega_destino);

    // Validar que bodegas sigan activas
    const [[origenCheck]] = await conn.query(
      `SELECT id_bodega FROM bodegas WHERE id_bodega=:id AND activo=1 LIMIT 1`,
      { id: id_origen }
    );
    const [[destCheck]] = await conn.query(
      `SELECT id_bodega FROM bodegas WHERE id_bodega=:id AND activo=1 LIMIT 1`,
      { id: id_destino }
    );
    if (!origenCheck || !destCheck) {
      await conn.rollback();
      return res.status(400).json({ error: "Una de las bodegas ya no esta activa" });
    }

    // Leer detalles originales
    const [detalles] = await conn.query(
      `SELECT id_producto, lote, fecha_vencimiento, cantidad, costo_unitario
       FROM movimiento_detalle
       WHERE id_movimiento=:id_movimiento`,
      { id_movimiento: id_movimiento_original }
    );
    if (!detalles || !detalles.length) {
      await conn.rollback();
      return res.status(400).json({ error: "La transferencia original no tiene lineas" });
    }

    // Buscar motivo TRANSFERENCIA
    const [[mot]] = await conn.query(
      `SELECT id_motivo
       FROM motivos_movimiento
       WHERE tipo_movimiento='TRANSFERENCIA' AND activo=1
       ORDER BY id_motivo ASC
       LIMIT 1`
    );
    if (!mot) {
      await conn.rollback();
      return res.status(400).json({ error: "No existe motivo de tipo TRANSFERENCIA" });
    }

    // Crear nuevo movimiento con bodegas invertidas
    const [mhRes] = await conn.query(
      `INSERT INTO movimiento_encabezado
       (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('TRANSFERENCIA', :id_motivo, :id_bodega_origen, :id_bodega_destino, :observaciones, :creado_por, NOW(), 'CONFIRMADO')`,
      {
        id_motivo: mot.id_motivo,
        id_bodega_origen: id_destino,
        id_bodega_destino: id_origen,
        observaciones: `REVERSIÓN de #${id_movimiento_original}`,
        creado_por: req.user.id_user,
      }
    );
    const id_movimiento_nuevo = mhRes.insertId;

    // Reinsertar detalles y kardex (swap origen/destino)
    let totalLineas = 0;
    for (const det of detalles) {
      const id_producto = Number(det.id_producto || 0);
      const cantidad = Number(det.cantidad || 0);
      const lote = String(det.lote || "").trim() || null;
      const cost = Number(det.costo_unitario || 0);

      if (!id_producto || cantidad <= 0) continue;

      // Verificar stock en la bodega destino (ahora origen de la reversión), por lote
      await conn.query(`SELECT id_producto FROM productos WHERE id_producto=:id_producto FOR UPDATE`, { id_producto });
      const [[stockRow]] = await conn.query(
        `SELECT COALESCE(SUM(delta_cantidad), 0) AS disponible
         FROM kardex
         WHERE id_bodega=:id_bodega AND id_producto=:id_producto AND lote <=> :lote`,
        { id_bodega: id_destino, id_producto, lote }
      );
      const disponible = Number(stockRow?.disponible || 0);
      if (disponible < cantidad) {
        await conn.rollback();
        return res.status(400).json({
          error: `Stock insuficiente en bodega destino para revertir producto #${id_producto} (lote ${lote ?? "sin lote"}): disponible ${disponible}, requerido ${cantidad}`,
        });
      }

      // Insertar detalle
      const [d] = await conn.query(
        `INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario)
         VALUES (:id_movimiento, :id_producto, :lote, :fecha, :cantidad, :costo_unitario)`,
        {
          id_movimiento: id_movimiento_nuevo,
          id_producto,
          lote,
          fecha: det.fecha_vencimiento || null,
          cantidad,
          costo_unitario: cost,
        }
      );
      const id_detalle_rev = d.insertId;

      // Kardex: salida de destino (ahora origen en reversión)
      await conn.query(
        `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
         VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha, :delta, :costo)`,
        {
          id_movimiento: id_movimiento_nuevo,
          id_detalle: id_detalle_rev,
          id_bodega: id_destino,
          id_producto,
          lote,
          fecha: det.fecha_vencimiento || null,
          delta: -cantidad,
          costo: cost,
        }
      );

      // Kardex: entrada en origen (ahora destino en reversión)
      await conn.query(
        `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
         VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha, :delta, :costo)`,
        {
          id_movimiento: id_movimiento_nuevo,
          id_detalle: id_detalle_rev,
          id_bodega: id_origen,
          id_producto,
          lote,
          fecha: det.fecha_vencimiento || null,
          delta: +cantidad,
          costo: cost,
        }
      );

      totalLineas++;
    }

    // Marcar la transferencia original como ANULADA para evitar doble reversa
    await conn.query(
      `UPDATE movimiento_encabezado
       SET estado='ANULADO', anulado_por=:anulado_por, anulado_en=NOW()
       WHERE id_movimiento=:id_movimiento`,
      { id_movimiento: id_movimiento_original, anulado_por: Number(req.user?.id_user || 0) }
    );

    await conn.commit();
    res.json({
      ok: true,
      id_movimiento: id_movimiento_nuevo,
      id_movimiento_original,
      total_lineas: totalLineas,
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error("Error en POST /api/transferencias/:id/revert:", e);
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

// ---------- Conteo Cíclico / Inventario Físico ----------

// Listar conteos
app.get("/api/conteo-ciclico", auth, async (req, res) => {
  try {
    const scope = await resolveStockScope(req.user);
    const whClause = scope.can_all_bodegas
      ? { sql: "1=1", params: {} }
      : buildNamedInClause(scope.allowed_warehouse_ids, "ccwh");
    const warehouseFilter = scope.can_all_bodegas
      ? "1=1"
      : `cc.id_bodega IN (${whClause.sql})`;

    const [rows] = await pool.query(
      `SELECT cc.id_conteo,
              cc.id_bodega,
              b.nombre_bodega,
              cc.fecha_conteo,
              cc.estado,
              cc.observaciones,
              u.nombre_completo AS creado_por_nombre,
              cc.creado_en,
              (SELECT COUNT(*) FROM conteo_ciclico_detalle WHERE id_conteo=cc.id_conteo) AS total_lineas,
              (SELECT COUNT(*) FROM conteo_ciclico_detalle WHERE id_conteo=cc.id_conteo AND cantidad_conteo IS NOT NULL) AS lineas_contadas
       FROM conteo_ciclico cc
       JOIN bodegas b ON b.id_bodega=cc.id_bodega
       LEFT JOIN usuarios u ON u.id_usuario=cc.creado_por
       WHERE ${warehouseFilter}
       ORDER BY cc.creado_en DESC
       LIMIT 200`,
      { ...whClause.params }
    );
    res.json(rows || []);
  } catch (e) {
    console.error("Error GET /api/conteo-ciclico:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Crear nuevo conteo (genera líneas desde el stock actual)
app.post("/api/conteo-ciclico", auth, requirePermission("action.create_update", "crear conteos"), async (req, res) => {
  const { id_bodega, observaciones = null } = req.body || {};
  const id_bodega_num = Number(id_bodega || 0);
  if (!id_bodega_num) return res.status(400).json({ error: "Falta bodega" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[bodega]] = await conn.query(
      `SELECT id_bodega, nombre_bodega FROM bodegas WHERE id_bodega=:id AND activo=1 LIMIT 1`,
      { id: id_bodega_num }
    );
    if (!bodega) {
      await conn.rollback();
      return res.status(400).json({ error: "Bodega no disponible" });
    }

    const [mhRes] = await conn.query(
      `INSERT INTO conteo_ciclico (id_bodega, fecha_conteo, estado, observaciones, creado_por)
       VALUES (:id_bodega, CURDATE(), 'BORRADOR', :observaciones, :creado_por)`,
      { id_bodega: id_bodega_num, observaciones: String(observaciones || "").trim() || null, creado_por: req.user.id_user }
    );
    const id_conteo = mhRes.insertId;

    // Obtener stock actual desde v_stock_resumen
    const [stockRows] = await conn.query(
      `SELECT vs.id_producto, p.nombre_producto, p.sku, vs.stock
       FROM v_stock_resumen vs
       JOIN productos p ON p.id_producto=vs.id_producto
       WHERE vs.id_bodega=:id_bodega
         AND vs.stock > 0
       ORDER BY p.nombre_producto ASC`,
      { id_bodega: id_bodega_num }
    );

    if (stockRows && stockRows.length > 0) {
      const values = stockRows.map((r) => [
        id_conteo,
        r.id_producto,
        r.nombre_producto,
        r.sku || null,
        Number(r.stock || 0),
      ]);
      await conn.query(
        `INSERT INTO conteo_ciclico_detalle
         (id_conteo, id_producto, nombre_producto, sku, cantidad_sistema)
         VALUES ?`,
        [values]
      );
    }

    await conn.commit();
    res.json({ ok: true, id_conteo, total_lineas: (stockRows || []).length });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error("Error POST /api/conteo-ciclico:", e);
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    conn.release();
  }
});

// Obtener detalle de un conteo
app.get("/api/conteo-ciclico/:id", auth, async (req, res) => {
  try {
    const id_conteo = Number(req.params.id || 0);
    if (!id_conteo) return res.status(400).json({ error: "ID invalido" });

    const [[conteo]] = await pool.query(
      `SELECT cc.*, b.nombre_bodega,
              u.nombre_completo AS creado_por_nombre
       FROM conteo_ciclico cc
       JOIN bodegas b ON b.id_bodega=cc.id_bodega
       LEFT JOIN usuarios u ON u.id_usuario=cc.creado_por
       WHERE cc.id_conteo=:id
       LIMIT 1`,
      { id: id_conteo }
    );
    if (!conteo) return res.status(404).json({ error: "Conteo no encontrado" });

    const [detalles] = await pool.query(
      `SELECT * FROM conteo_ciclico_detalle
       WHERE id_conteo=:id_conteo
       ORDER BY nombre_producto ASC`,
      { id_conteo }
    );

    res.json({ conteo, detalles: detalles || [] });
  } catch (e) {
    console.error("Error GET /api/conteo-ciclico/:id:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Actualizar cantidad contada de una línea
app.patch("/api/conteo-ciclico/:id/detalle/:id_detalle", auth, requirePermission("action.create_update", "actualizar conteo"), async (req, res) => {
  try {
    const id_conteo = Number(req.params.id || 0);
    const id_detalle = Number(req.params.id_detalle || 0);
    const { cantidad_conteo, comentario } = req.body || {};

    if (!id_conteo || !id_detalle) return res.status(400).json({ error: "IDs invalidos" });

    // Verificar que el conteo esté en BORRADOR o EN_PROGRESO
    const [[conteo]] = await pool.query(
      `SELECT estado FROM conteo_ciclico WHERE id_conteo=:id LIMIT 1`,
      { id: id_conteo }
    );
    if (!conteo) return res.status(404).json({ error: "Conteo no encontrado" });
    if (conteo.estado !== 'BORRADOR' && conteo.estado !== 'EN_PROGRESO') {
      return res.status(400).json({ error: "El conteo no esta en progreso" });
    }

    // Actualizar estado a EN_PROGRESO si estaba en BORRADOR
    if (conteo.estado === 'BORRADOR') {
      await pool.query(
        `UPDATE conteo_ciclico SET estado='EN_PROGRESO' WHERE id_conteo=:id`,
        { id: id_conteo }
      );
    }

    const c = cantidad_conteo !== null && cantidad_conteo !== undefined && cantidad_conteo !== '' ? Number(cantidad_conteo) : null;

    await pool.query(
      `UPDATE conteo_ciclico_detalle
       SET cantidad_conteo=:cantidad_conteo,
           diferencia=IF(:cantidad_conteo IS NOT NULL, :cantidad_conteo - cantidad_sistema, NULL),
           comentario=:comentario
       WHERE id_detalle=:id_detalle AND id_conteo=:id_conteo`,
      {
        cantidad_conteo: c,
        comentario: String(comentario || "").trim() || null,
        id_detalle,
        id_conteo,
      }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Error PATCH /api/conteo-ciclico/:id/detalle/:id_detalle:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Completar conteo (marcar como COMPLETADO)
app.post("/api/conteo-ciclico/:id/completar", auth, requirePermission("action.create_update", "completar conteos"), async (req, res) => {
  try {
    const id_conteo = Number(req.params.id || 0);
    if (!id_conteo) return res.status(400).json({ error: "ID invalido" });

    const [[conteo]] = await pool.query(
      `SELECT estado FROM conteo_ciclico WHERE id_conteo=:id LIMIT 1`,
      { id: id_conteo }
    );
    if (!conteo) return res.status(404).json({ error: "Conteo no encontrado" });
    if (conteo.estado === 'COMPLETADO' || conteo.estado === 'AJUSTADO') {
      return res.status(400).json({ error: "El conteo ya fue completado o ajustado" });
    }

    // Si estaba en BORRADOR, pasar a EN_PROGRESO primero
    await pool.query(
      `UPDATE conteo_ciclico SET estado='COMPLETADO' WHERE id_conteo=:id`,
      { id: id_conteo }
    );

    res.json({ ok: true, id_conteo });
  } catch (e) {
    console.error("Error POST /api/conteo-ciclico/:id/completar:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// Ajustar inventario desde conteo (crea movimientos de ajuste por diferencias)
app.post("/api/conteo-ciclico/:id/ajustar", auth, requirePermission("action.create_update", "ajustar inventario desde conteo"), requireSensitiveApproval("ajuste de inventario por conteo ciclico"), async (req, res) => {
  try {
    const id_conteo = Number(req.params.id || 0);
    if (!id_conteo) return res.status(400).json({ error: "ID invalido" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [[conteo]] = await conn.query(
        `SELECT cc.*, b.nombre_bodega
         FROM conteo_ciclico cc
         JOIN bodegas b ON b.id_bodega=cc.id_bodega
         WHERE cc.id_conteo=:id
         LIMIT 1`,
        { id: id_conteo }
      );
      if (!conteo) {
        await conn.rollback();
        return res.status(404).json({ error: "Conteo no encontrado" });
      }
      if (conteo.estado !== 'COMPLETADO') {
        await conn.rollback();
        return res.status(400).json({ error: "El conteo debe estar COMPLETADO antes de ajustar" });
      }

      // Obtener líneas con diferencia
      const [detalles] = await conn.query(
        `SELECT * FROM conteo_ciclico_detalle
         WHERE id_conteo=:id_conteo
           AND cantidad_conteo IS NOT NULL
           AND cantidad_conteo <> cantidad_sistema
         ORDER BY nombre_producto ASC`,
        { id_conteo }
      );

      if (!detalles || !detalles.length) {
        await conn.rollback();
        return res.status(400).json({ error: "No hay diferencias para ajustar" });
      }

      // Buscar motivo AJUSTE
      const [[motivo]] = await conn.query(
        `SELECT id_motivo FROM motivos_movimiento
         WHERE tipo_movimiento='AJUSTE' AND activo=1
         ORDER BY id_motivo ASC LIMIT 1`
      );
      if (!motivo) {
        await conn.rollback();
        return res.status(400).json({ error: "No existe motivo de tipo AJUSTE" });
      }

      // Agrupar líneas por dirección (ENTRADA si diferencia > 0, SALIDA si < 0)
      const entradas = [];
      const salidas = [];
      for (const d of detalles) {
        const dif = Number(d.diferencia || 0);
        if (dif > 0) entradas.push(d);
        else if (dif < 0) salidas.push(d);
      }

      let movimientos = [];

      // Crear ajuste de ENTRADA (sobrantes)
      if (entradas.length > 0) {
        const [mhRes] = await conn.query(
          `INSERT INTO movimiento_encabezado
           (tipo_movimiento, id_motivo, id_bodega_destino, observaciones, creado_por, confirmado_en, estado, no_contar_dashboard)
           VALUES ('AJUSTE', :id_motivo, :id_bodega, :observaciones, :creado_por, NOW(), 'CONFIRMADO', 1)`,
          {
            id_motivo: motivo.id_motivo,
            id_bodega: conteo.id_bodega,
            observaciones: `Ajuste por conteo ciclico #${id_conteo} (sobrantes)`,
            creado_por: req.user.id_user,
          }
        );
        const id_mov = mhRes.insertId;

        for (const d of entradas) {
          const dif = Number(d.diferencia || 0);
          const costo = await getLastUnitCost(conn, conteo.id_bodega, d.id_producto, null);
          const [det] = await conn.query(
            `INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, cantidad, costo_unitario)
             VALUES (:id_movimiento, :id_producto, NULL, :cantidad, :costo)`,
            { id_movimiento: id_mov, id_producto: d.id_producto, cantidad: dif, costo }
          );
          await conn.query(
            `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
             VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, NULL, NULL, :delta_cantidad, :costo)`,
            {
              id_movimiento: id_mov,
              id_detalle: det.insertId,
              id_bodega: conteo.id_bodega,
              id_producto: d.id_producto,
              delta_cantidad: dif,
              costo,
            }
          );
        }
        movimientos.push({ tipo: 'ENTRADA', id_movimiento: id_mov, lineas: entradas.length });
      }

      // Crear ajuste de SALIDA (faltantes)
      if (salidas.length > 0) {
        const [mhRes] = await conn.query(
          `INSERT INTO movimiento_encabezado
           (tipo_movimiento, id_motivo, id_bodega_origen, observaciones, creado_por, confirmado_en, estado, no_contar_dashboard)
           VALUES ('AJUSTE', :id_motivo, :id_bodega, :observaciones, :creado_por, NOW(), 'CONFIRMADO', 1)`,
          {
            id_motivo: motivo.id_motivo,
            id_bodega: conteo.id_bodega,
            observaciones: `Ajuste por conteo ciclico #${id_conteo} (faltantes)`,
            creado_por: req.user.id_user,
          }
        );
        const id_mov = mhRes.insertId;

        for (const d of salidas) {
          const dif = Math.abs(Number(d.diferencia || 0));
          // Descargar faltantes por lote (FEFO, incluye vencidos: es una baja de inventario)
          const { picks, remaining } = await pickLotsFEFO(conn, conteo.id_bodega, d.id_producto, dif, { allowExpired: true });
          if (!picks.length || remaining > 0) {
            await conn.rollback();
            return res.status(400).json({
              error: `Stock insuficiente para ajustar faltante de "${d.nombre_producto}" (#${d.id_producto}). El stock cambio desde el conteo; repite el conteo.`,
            });
          }
          for (const p of picks) {
            const costo = await getLastUnitCost(conn, conteo.id_bodega, d.id_producto, p.lote);
            const [det] = await conn.query(
              `INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario)
               VALUES (:id_movimiento, :id_producto, :lote, :fecha, :cantidad, :costo)`,
              {
                id_movimiento: id_mov,
                id_producto: d.id_producto,
                lote: p.lote || null,
                fecha: p.fecha_vencimiento || null,
                cantidad: p.qty,
                costo,
              }
            );
            await conn.query(
              `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
               VALUES (:id_movimiento, :id_detalle, :id_bodega, :id_producto, :lote, :fecha, :delta_cantidad, :costo)`,
              {
                id_movimiento: id_mov,
                id_detalle: det.insertId,
                id_bodega: conteo.id_bodega,
                id_producto: d.id_producto,
                lote: p.lote || null,
                fecha: p.fecha_vencimiento || null,
                delta_cantidad: -p.qty,
                costo,
              }
            );
          }
        }
        movimientos.push({ tipo: 'SALIDA', id_movimiento: id_mov, lineas: salidas.length });
      }

      // Marcar conteo como AJUSTADO
      await conn.query(
        `UPDATE conteo_ciclico SET estado='AJUSTADO' WHERE id_conteo=:id`,
        { id: id_conteo }
      );

      await conn.commit();
      await writeSensitiveActionAudit({
        req,
        action_key: "AJUSTE_CONTEO_CICLICO",
        action_label: "Ajuste de inventario por conteo ciclico",
        approval: req.sensitive_approval,
        reference_type: "CONTEO_CICLICO",
        reference_id: id_conteo,
        detail: { movimientos },
      });
      res.json({ ok: true, id_conteo, movimientos, sensitive_approval: toSensitiveApprovalPayload(req.sensitive_approval) });
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("Error POST /api/conteo-ciclico/:id/ajustar:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// ── Push Notification helpers ──────────────────────────────────────

/**
 * Envía una notificación push a todas las suscripciones activas
 * de una bodega específica (o a todas si idBodega es null).
 */
async function sendPushToWarehouse(idBodega, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  try {
    const params = {};
    let whereClause = '';
    if (idBodega != null) {
      whereClause = 'WHERE s.id_bodega=:id_bodega';
      params.id_bodega = Number(idBodega);
    }
    const [rows] = await pool.query(
      `SELECT s.endpoint, s.auth, s.p256dh
       FROM push_subscriptions s
       ${whereClause}
       ORDER BY s.id_suscripcion ASC`,
      params
    );
    if (!rows || !rows.length) return;

    const data = JSON.stringify(payload);
    await Promise.allSettled(
      rows.map((sub) => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { auth: sub.auth, p256dh: sub.p256dh },
        };
        return webpush.sendNotification(pushSub, data).catch((err) => {
          // Solo eliminar si la suscripción expiró (410 Gone)
          // Otros errores (red, servidor) son temporales
          if (err.statusCode === 410) {
            pool.query(
              `DELETE FROM push_subscriptions
               WHERE endpoint=:endpoint`,
              { endpoint: sub.endpoint }
            ).catch(() => {});
          }
        });
      })
    );
  } catch (e) {
    console.error('[push] Error sending pushes:', e.message || e);
  }
}

// ── Push Notification Endpoints ────────────────────────────────────

/** GET /api/push/vapid-key — devuelve la llave pública VAPID */
app.get("/api/push/vapid-key", (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: "VAPID no configurado" });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/** POST /api/push/subscribe — Guarda una nueva suscripción push */
app.post("/api/push/subscribe", auth, async (req, res) => {
  try {
    const idUsuario = Number(req.user?.id_user || 0);
    if (!idUsuario) return res.status(401).json({ error: "Usuario invalido" });

    const { endpoint, keys, id_bodega } = req.body || {};
    if (!endpoint || !keys?.auth || !keys?.p256dh) {
      return res.status(400).json({ error: "Suscripcion incompleta" });
    }

    // Seguridad: solo puedes suscribirte a alertas de tu propia bodega
    // o de bodegas a las que tienes acceso explicito.
    const idBodegaReq = Number(id_bodega || 0) || null;
    if (idBodegaReq) {
      const ownWarehouse = Number(req.user?.id_warehouse || 0);
      const accessIds = await getUserWarehouseAccessIds(idUsuario);
      if (idBodegaReq !== ownWarehouse && !accessIds.includes(idBodegaReq)) {
        return res.status(403).json({ error: "No puedes suscribirte a alertas de otra bodega" });
      }
    }

    // Evitar duplicados por endpoint
    await pool.query(
      `DELETE FROM push_subscriptions WHERE endpoint=:endpoint`,
      { endpoint }
    );

    await pool.query(
      `INSERT INTO push_subscriptions (id_usuario, endpoint, auth, p256dh, id_bodega, user_agent)
       VALUES (:id_usuario, :endpoint, :auth, :p256dh, :id_bodega, :user_agent)`,
      {
        id_usuario: idUsuario,
        endpoint,
        auth: keys.auth,
        p256dh: keys.p256dh,
        id_bodega: idBodegaReq,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 250),
      }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[push] subscribe error:', e.message || e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** POST /api/push/unsubscribe — Elimina una suscripción push */
app.post("/api/push/unsubscribe", auth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "Falta endpoint" });

    await pool.query(
      `DELETE FROM push_subscriptions WHERE endpoint=:endpoint`,
      { endpoint }
    );

    res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

/** POST /api/push/send-alertas — Envía push para alertas de stock detectadas por polling */
app.post("/api/push/send-alertas", auth, async (req, res) => {
  try {
    const { alertas } = req.body || {};
    if (!Array.isArray(alertas) || !alertas.length) {
      return res.json({ ok: true });
    }

    // Seguridad: solo se pueden disparar alertas de las bodegas del propio
    // usuario (su bodega asignada o bodegas con acceso explicito). Nunca
    // broadcast (id_bodega nulo) desde este endpoint.
    const idUsuario = Number(req.user?.id_user || 0);
    const ownWarehouse = Number(req.user?.id_warehouse || 0);
    const accessIds = await getUserWarehouseAccessIds(idUsuario);
    const allowedWarehouses = new Set([ownWarehouse, ...accessIds].filter((x) => Number(x) > 0));

    // Enviar push para hasta 10 alertas (evitar sobrecarga)
    for (const a of alertas.slice(0, 10)) {
      const alertWarehouse = Number(a?.id_bodega || 0);
      if (!alertWarehouse || !allowedWarehouses.has(alertWarehouse)) {
        continue; // Saltar alertas de bodegas ajenas o broadcast
      }
      const isMinimo = a.minimo != null && Number(a.stock) < Number(a.minimo);
      const isVencido = a.dias_para_vencer != null && a.dias_para_vencer <= 0;
      const isProximo = a.dias_para_vencer != null && a.dias_para_vencer <= 3;

      let title, body;
      if (isMinimo) {
        title = '📦 Stock por debajo del mínimo';
        body = `${a.nombre_producto}${a.sku ? ` (${a.sku})` : ''} · Stock: ${Number(a.stock)} / Mín: ${Number(a.minimo)}`;
      } else if (isVencido) {
        title = '❌ Producto vencido';
        body = `${a.nombre_producto}${a.sku ? ` (${a.sku})` : ''} · Vencido hace ${Math.abs(Number(a.dias_para_vencer))} día(s)`;
      } else if (isProximo) {
        title = '🔥 Vence pronto';
        body = `${a.nombre_producto}${a.sku ? ` (${a.sku})` : ''} · Vence en ${a.dias_para_vencer} día(s)`;
      } else {
        continue; // Saltar alertas no críticas
      }

      const pushPayload = {
        type: 'alerta',
        title,
        body,
        tag: `alerta-${alertWarehouse}-${a.id_producto || 0}-${a.lote || 'nolote'}`,
        url: '/alertas',
      };
      await sendPushToWarehouse(alertWarehouse, pushPayload);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[push] Error sending alertas push:', e.message || e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/health", async (req, res) => {

  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const db_ping_ms = Date.now() - t0;
    const alerts = buildOperationalAlerts();
    res.json({ ok: true, db_ping_ms, alerts, stock_actual: opsMetrics.stock_actual });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
      alerts: buildOperationalAlerts(),
    });
  }
});

// ── Global async error handler (must be registered BEFORE listen) ─
app.use((err, req, res, next) => {
  console.error("[unhandled]", err?.message || err);
  if (res.writableEnded) return;
  const status = Number(err?.status || 500);
  res.status(status).json({ error: String(err?.message || "Error interno del servidor") });
});

// ── SPA catch-all: sirve el index.html de React para cualquier ruta no
//    reconocida por las API o los estáticos (necesario para React Router).
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Bodega API en ${HOST}:${PORT}`);
  if (OPS_BACKUP_AUTO_ENABLED) {
    setTimeout(() => {
      createLogicalBackup({ trigger: "AUTO_STARTUP" }).catch((e) => console.error("Backup inicial fallo:", e));
      maybeRunMonthlyRecoveryTest().catch((e) => console.error("Recovery test inicial fallo:", e));
    }, 8000);
    setInterval(() => {
      createLogicalBackup({ trigger: "AUTO_DAILY" }).catch((e) => console.error("Backup programado fallo:", e));
    }, OPS_BACKUP_INTERVAL_MS);
    setInterval(() => {
      maybeRunMonthlyRecoveryTest().catch((e) => console.error("Recovery test programado fallo:", e));
    }, OPS_RECOVERY_CHECK_INTERVAL_MS);
  } else {
    console.log("Backup automatico deshabilitado por BACKUP_AUTO_ENABLED=0");
  }
  if (DASHBOARD_PREWARM_ENABLED) {
    setTimeout(() => {
      prewarmDashboardCache().catch((e) => console.error("Prewarm inicial fallo:", e));
    }, 12000);
    setInterval(() => {
      prewarmDashboardCache().catch((e) => console.error("Prewarm programado fallo:", e));
    }, DASHBOARD_PREWARM_MS);
  } else {
    console.log("Dashboard prewarm deshabilitado por DASHBOARD_PREWARM=0");
  }
  if (STOCK_HC_ENABLED) {
    setTimeout(() => {
      checkStockActualConsistency().catch((e) => console.error("Healthcheck stock inicial fallo:", e));
    }, 15000);
    setInterval(() => {
      checkStockActualConsistency().catch((e) => console.error("Healthcheck stock programado fallo:", e));
    }, STOCK_HC_INTERVAL_MS);
  } else {
    console.log("Healthcheck stock_actual deshabilitado por STOCK_HC_ENABLED=0");
  }
});
