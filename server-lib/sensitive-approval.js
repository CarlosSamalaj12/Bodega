// server-lib/sensitive-approval.js  —  Sensitive action approval middleware and audit
import { pool, trackPinFailure } from "./core.js";
import bcrypt from "bcryptjs";
import { ensureSensitiveActionAuditTable } from "./tables.js";
import { isValidSupervisorPin } from "./format.js";

async function verifySensitiveApproval(req, conn, actionLabel) {
  if (!req.user || !req.body) return { ok: true, method: "NO_OP", message: "No se requiere aprobacion sensible" };
  const alreadyApproved = req.sensitive_approval?.ok;
  if (alreadyApproved) return req.sensitive_approval;
  const supervisorPin = String(req.body?.supervisor_pin || req.body?.approval_supervisor_pin || "").trim();
  const supervisorUserId = Number(req.body?.supervisor_user_id || req.body?.approval_supervisor_user_id || 0);
  if (!supervisorPin || !supervisorUserId) return { ok: true, method: "NO_PIN", message: "Sin PIN supervisor — se omite validacion sensible" };
  if (!isValidSupervisorPin(supervisorPin)) return { ok: false, status: 400, error: "El PIN del supervisor debe tener entre 6 y 12 digitos" };
  const [[userRow]] = await conn.query(`SELECT u.id_usuario, u.nombre_completo, u.activo, ups.pin_hash FROM usuarios u LEFT JOIN usuario_pin_supervisor ups ON ups.id_usuario=u.id_usuario WHERE u.id_usuario=:id_usuario LIMIT 1`, { id_usuario: supervisorUserId });
  if (!userRow || Number(userRow.activo || 0) !== 1) return { ok: false, status: 400, error: "Supervisor no valido" };
  if (!userRow.pin_hash) return { ok: false, status: 400, error: "El supervisor no tiene PIN configurado" };
  const pinOk = await bcrypt.compare(supervisorPin, userRow.pin_hash || "");
  if (!pinOk) {
    trackPinFailure("supervisor", { supervisor_user_id: supervisorUserId, actor_user_id: Number(req.user?.id_user || 0) });
    return { ok: false, status: 401, error: "PIN de supervisor invalido" };
  }
  return {
    ok: true, method: "SUPERVISOR_PIN", supervisor_user_id: supervisorUserId, supervisor_usuario: String(userRow.nombre_completo || `#${supervisorUserId}`),
    actor_label: `${actionLabel}`,
  };
}

function toSensitiveApprovalPayload(approval) {
  if (!approval || !approval.ok) return null;
  return { method: approval.method || "UNKNOWN", supervisor_user_id: approval.supervisor_user_id || null, supervisor_usuario: approval.supervisor_usuario || null, actor_label: approval.actor_label || null };
}

async function writeSensitiveActionAudit({ req, action_key, action_label, approval, reference_type, reference_id, detail }) {
  try {
    await ensureSensitiveActionAuditTable();
    const actorId = Number(req.user?.id_user || 0);
    const actorName = String(req.user?.full_name || "").trim() || "Sistema";
    const actorWarehouse = Number(req.user?.id_warehouse || 0);
    const supervisorId = Number(approval?.supervisor_user_id || 0) || null;
    const supervisorUser = String(approval?.supervisor_usuario || "").trim() || null;
    const approvalMethod = String(approval?.method || "NO_OP");
    await pool.query(`INSERT INTO auditoria_accion_sensible (action_key, action_label, endpoint, http_method, id_usuario_actor, actor_nombre, id_bodega_actor, id_usuario_supervisor, supervisor_usuario, supervisor_nombre, approval_method, reference_type, reference_id, detail_json) VALUES (:action_key, :action_label, :endpoint, :http_method, :id_usuario_actor, :actor_nombre, :id_bodega_actor, :id_usuario_supervisor, :supervisor_usuario, :supervisor_nombre, :approval_method, :reference_type, :reference_id, :detail_json)`, {
      action_key, action_label, endpoint: req.path || null, http_method: req.method || null, id_usuario_actor: actorId, actor_nombre: actorName, id_bodega_actor: actorWarehouse || null, id_usuario_supervisor: supervisorId, supervisor_usuario: supervisorUser, supervisor_nombre: supervisorUser, approval_method: approvalMethod, reference_type: reference_type || null, reference_id: reference_id || null, detail_json: detail ? JSON.stringify(detail) : null,
    });
  } catch (e) { console.error("Error al escribir auditoria sensible:", e); }
}

function requireSensitiveApproval(actionLabel = "esta accion") {
  return (req, res, next) => {
    req.sensitive_approval_check = { label: actionLabel };
    next();
  };
}

export { verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit, requireSensitiveApproval };
