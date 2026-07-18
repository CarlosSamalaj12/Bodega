// server-admin-ops.js  |  Ops / backup / health routes (modular)
import fsSync from 'fs';
import fs from 'fs/promises';
import { pool, auth, requirePermission, opsMetrics, createLogicalBackup, OPS_BACKUP_AUTO_ENABLED, OPS_BACKUP_INTERVAL_MS, OPS_BACKUP_BASE_DIR, trimOldEvents } from '../server-shared.js';
import { Router } from 'express';
const router = Router();

// ======= Local helpers (extracted from monolithic backup) =======
async function runRecoveryDryTest({ trigger = "AUTO", createdBy = null } = {}) {
  const conn = await pool.getConnection();
  try {
    const [auditRes] = await conn.query(
      `INSERT INTO recovery_test_audit (trigger_type, status, created_by)
       VALUES (:trigger, 'RUNNING', :createdBy)`,
      { trigger, createdBy }
    );
    const id_test = auditRes.insertId;

    const [[backupRow]] = await conn.query(
      `SELECT id_backup, file_path
       FROM backup_audit
       WHERE status='SUCCESS'
       ORDER BY id_backup DESC
       LIMIT 1`
    );
    if (!backupRow || !backupRow.file_path) {
      await conn.query(
        `UPDATE recovery_test_audit SET status='FAILED', error_message='No hay backup disponible' WHERE id_test=:id_test`,
        { id_test }
      );
      return { ok: false, error: "No hay backup disponible para probar" };
    }

    const filePath = String(backupRow.file_path);

    if (!fsSync.existsSync(filePath)) {
      await conn.query(
        `UPDATE recovery_test_audit SET status='FAILED', error_message='Archivo de backup no encontrado' WHERE id_test=:id_test`,
        { id_test }
      );
      return { ok: false, error: "Archivo de backup no encontrado" };
    }


    const content = await fs.readFile(filePath, "utf8");
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      await conn.query(
        `UPDATE recovery_test_audit SET status='FAILED', error_message='Backup corrupto: no es JSON valido' WHERE id_test=:id_test`,
        { id_test }
      );
      return { ok: false, error: "Backup corrupto: no es JSON valido" };
    }

    const tables = Object.keys(data || {});
    if (!tables.length) {
      await conn.query(
        `UPDATE recovery_test_audit SET status='FAILED', error_message='Backup vacio: no contiene tablas' WHERE id_test=:id_test`,
        { id_test }
      );
      return { ok: false, error: "Backup vacio: no contiene tablas" };
    }

    await conn.query(
      `UPDATE recovery_test_audit
       SET status='SUCCESS', source_file=:source_file, finalizado_en=NOW()
       WHERE id_test=:id_test`,
      { id_test, source_file: filePath }
    );

    return { ok: true, id_test, tables_found: tables.length, tables };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    conn.release();
  }
}

function buildOperationalAlerts() {
  trimOldEvents();
  const alerts = [];

  const avgMs =
    opsMetrics.api.total > 0
      ? Number((opsMetrics.api.total_latency_ms / opsMetrics.api.total).toFixed(2))
      : 0;
  const api5xx = opsMetrics.api.errors_5xx;
  const pinFails =
    opsMetrics.pin_failures.order.length + opsMetrics.pin_failures.supervisor.length;

  if (avgMs > 1200) {
    alerts.push({
      severity: "WARN",
      code: "API_LATENCY_HIGH",
      message: `Latencia promedio alta: ${avgMs}ms`,
    });
  }
  if (api5xx >= 8) {
    alerts.push({
      severity: "ERROR",
      code: "API_ERRORS_HIGH",
      message: `Muchos errores 5xx: ${api5xx} en la ventana`,
    });
  }
  if (opsMetrics.db.recent_failures.length >= 3) {
    alerts.push({
      severity: "ERROR",
      code: "DB_FAILURES",
      message: `Fallos de base de datos: ${opsMetrics.db.recent_failures.length} en 5m`,
    });
  }
  if (pinFails >= 5) {
    alerts.push({
      severity: "WARN",
      code: "PIN_FAILURES",
      message: `Muchos fallos de PIN: ${pinFails} en 15m`,
    });
  }

  return alerts;
}

// -------------------------------------------------------
/* =========================
   OPS METRICS
========================= */
router.get("/api/ops/metrics", auth, requirePermission("action.manage_permissions", "ver metricas operativas"), async (req, res) => {
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
      alerts,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   BACKUP STATUS
========================= */
router.get("/api/ops/backup/status", auth, requirePermission("action.manage_permissions", "ver estado de backups"), async (req, res) => {
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
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/ops/backup/run", auth, requirePermission("action.manage_permissions", "ejecutar backup"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await createLogicalBackup({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo generar backup" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.post("/api/ops/backup/recovery-test", auth, requirePermission("action.manage_permissions", "ejecutar prueba de recovery"), async (req, res) => {
  try {
    const createdBy = Number(req.user?.id_user || 0) || null;
    const r = await runRecoveryDryTest({ trigger: "MANUAL", createdBy });
    if (!r.ok) return res.status(500).json({ error: r.error || "No se pudo ejecutar prueba de recovery" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* =========================
   HEALTH CHECK
========================= */
router.get("/api/health", async (req, res) => {
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const db_ping_ms = Date.now() - t0;
    const alerts = buildOperationalAlerts();
    res.json({ ok: true, db_ping_ms, alerts });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e.message || e),
      alerts: buildOperationalAlerts(),
    });
  }
});

export default router;
