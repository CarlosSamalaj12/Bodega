// server-lib/core.js  —  Express app setup, middleware, pool, Socket.IO, config constants
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
import { pool } from "../db.js";

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
  if (!allowedOrigins.size || allowedOrigins.has(origin)) return callback(null, true);
  return callback(null, false);
};

const corsOptions = { origin: corsOriginResolver, credentials: true };

const io = new SocketIOServer(httpServer, { cors: corsOptions });
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const __filename = fileURLToPath(import.meta.url);
// core.js lives in server-lib/, so go up one level to reach project root
const __dirname = path.resolve(path.dirname(__filename), "..");
app.use(express.static(path.join(__dirname, "public")));
app.use("/imagenes", express.static(path.join(__dirname, "imagenes")));

app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "login.html")); });
app.get("/login", (req, res) => { res.sendFile(path.join(__dirname, "public", "login.html")); });
app.get("/app", (req, res) => { res.sendFile(path.join(__dirname, "public", "app.html")); });

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
  api: { total: 0, errors_4xx: 0, errors_5xx: 0, total_latency_ms: 0, max_latency_ms: 0, recent: [] },
  db: { total_queries: 0, failures: 0, total_latency_ms: 0, max_latency_ms: 0, recent_failures: [], last_error: null },
  pin_failures: { order: [], supervisor: [] },
  sensitive_actions: { approved_by_special_permission: 0, approved_by_supervisor_pin: 0, blocked: 0 },
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
  for (const k of Object.keys(value).sort()) { const v = value[k]; if (typeof v === "undefined") continue; out[k] = stableSortObject(v); }
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
    if (!res.writableEnded || Number(res.statusCode || 500) >= 400) recentRequestSignatures.delete(signature);
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
      opsMetrics.db.last_error = { source: src, code: e?.code || null, message: String(e?.message || e), at: new Date().toISOString() };
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

// Back-compat redirect
app.get("/public/login.html", (req, res) => { res.redirect(301, "/login.html"); });

const DASHBOARD_PREWARM_ENABLED = String(process.env.DASHBOARD_PREWARM || "1") !== "0";
const DASHBOARD_PREWARM_MS = Math.max(60 * 1000, Number(process.env.DASHBOARD_PREWARM_MS || 5 * 60 * 1000));

export {
  app, httpServer, HOST, PORT, io, pool, bcrypt, __dirname,
  OPS_BACKUP_AUTO_ENABLED, OPS_BACKUP_INTERVAL_MS, OPS_BACKUP_BASE_DIR, OPS_RECOVERY_CHECK_INTERVAL_MS,
  opsMetrics, trimOldEvents, beginIdempotentRequest, trackPinFailure,
  DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS,
};
