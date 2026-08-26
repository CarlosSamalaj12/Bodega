// ─────────────────────────────────────────────────────────────────────────────
// test_despacho_rapido.cjs
// Test funcional del DESPACHO RÁPIDO (⚡ por línea y ⚡ Despachar todo) del
// flujo "Pedidos por despachar" (DespachoForm.jsx → POST /api/orders/:id/fulfill
// y POST /api/orders/:id/cancel-line).
//
// Replica el SQL EXACTO de los endpoints del servidor (movimiento_encabezado/
// detalle, kardex, pedido_movimiento_vinculo, UPDATE de pedido_detalle,
// recomputePedidoEstado) para que disparen los triggers transaccionales reales
// de stock_actual (ai) y verifiquen el comportamiento del despacho rápido:
//
//   S1  ⚡ por línea: solo despacha la línea indicada (las demás intactas),
//       respetando FEFO (lote con vencimiento más cercano primero) y sin tocar
//       lotes VENCIDOS (allowExpired:false). Estado del pedido = PARCIAL.
//   S2  ⚡ Despachar todo: despacha las líneas pendientes restantes → COMPLETADO.
//   S3  Anuladas: una línea anulada localmente se cancela vía cancel-line
//       (estado_linea='ANULADO', justificacion, anulado_por, sin kardex) y el
//       pedido queda COMPLETADO_JUSTIFICADO.
//   S4  SIN_STOCK_PARCIAL: si el stock vigente no alcanza, despacha lo que hay
//       y reporta skipped {solicitado, despachado, faltante} sin tocar vencidas.
//   S5  SIN_STOCK_NO_VIGENTE: con solo stock vencido, no despacha nada y
//       devuelve 400 con skipped (rollback del movimiento).
//
// IMPORTANTE: todo corre dentro de una transacción con ROLLBACK al final; cada
// llamada replicada usa SAVEPOINT para imitar el rollback del endpoint sin
// afectar la transacción externa. NO modifica datos reales (lotes ZZDESP_*).
//
// Uso: node test_despacho_rapido.cjs
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv/config");
const mysql = require("mysql2/promise");

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` → ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` → ${detail}` : ""}`);
  }
}

// ── Ground truth: agregado REAL de kardex para un grupo (como el reconcile) ──
async function expectedGroup(conn, id_bodega, id_producto, lote, fec) {
  const [[r]] = await conn.query(
    `SELECT SUM(delta_cantidad) AS stock
     FROM kardex
     WHERE id_bodega = ? AND id_producto = ?
       AND (lote <=> ?) AND (fecha_vencimiento <=> ?)`,
    [id_bodega, id_producto, lote, fec]
  );
  if (r.stock === null) return null;
  return { stock: Number(r.stock) };
}

async function actualGroup(conn, id_bodega, id_producto, lote, fec) {
  const [rows] = await conn.query(
    `SELECT stock
     FROM stock_actual
     WHERE id_bodega = ? AND id_producto = ?
       AND (lote <=> ?) AND (fecha_vencimiento <=> ?)`,
    [id_bodega, id_producto, lote, fec]
  );
  return rows[0] ? { stock: Number(rows[0].stock) } : null;
}

const fmtG = (g) => (g ? `stock=${g.stock}` : "AUSENTE");

async function assertGroup(name, conn, id_bodega, id_producto, lote, fec) {
  const exp = await expectedGroup(conn, id_bodega, id_producto, lote, fec);
  const act = await actualGroup(conn, id_bodega, id_producto, lote, fec);
  const ok = exp === null ? act === null : act !== null && Math.abs(act.stock - exp.stock) < 1e-6;
  check(name, ok, `esperado=${fmtG(exp)} | real=${fmtG(act)}`);
}

// Consistencia global stock_actual vs agregado real de kardex.
async function fullConsistency(conn) {
  const KEY_EXPR = `CONCAT(IF(lote IS NULL, 'N', 'Y'), COALESCE(lote, '')) AS lote_key,
                    IF(fecha_vencimiento IS NULL, '1000-01-01', DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d')) AS fecha_key`;
  const [expRows] = await conn.query(`
    SELECT id_bodega, id_producto, ${KEY_EXPR}, SUM(delta_cantidad) AS stock
    FROM kardex
    GROUP BY id_bodega, id_producto, lote_key, fecha_key`);
  const [actRows] = await conn.query(`
    SELECT id_bodega, id_producto, lote_key,
           DATE_FORMAT(fecha_key, '%Y-%m-%d') AS fecha_key, stock
    FROM stock_actual`);
  const keyOf = (r) => `${r.id_bodega}|${r.id_producto}|${r.lote_key}|${r.fecha_key}`;
  const expMap = new Map(expRows.map((r) => [keyOf(r), Number(r.stock)]));
  const actMap = new Map(actRows.map((r) => [keyOf(r), Number(r.stock)]));
  let mism = 0;
  for (const [k, v] of expMap) {
    const a = actMap.get(k);
    if (a === undefined || Math.abs(a - v) > 1e-6) mism++;
  }
  for (const k of actMap.keys()) if (!expMap.has(k)) mism++;
  return { mism, exp: expMap.size, act: actMap.size };
}

// ── Replicas fieles del backend ──────────────────────────────────────────────

// pickLotsFEFO del servidor con allowExpired:false (solo stock vigente, FEFO).
async function pickLotsFEFO(conn, id_bodega, id_producto, qtyNeeded) {
  await conn.query(`SELECT id_producto FROM productos WHERE id_producto=? FOR UPDATE`, [id_producto]);
  const [lots] = await conn.query(
    `SELECT lote, fecha_vencimiento, stock
     FROM v_stock_disponible
     WHERE id_bodega=? AND id_producto=?
       AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
     ORDER BY (fecha_vencimiento IS NULL), fecha_vencimiento ASC`,
    [id_bodega, id_producto]
  );
  const picks = [];
  let remaining = Number(qtyNeeded);
  for (const l of lots) {
    if (remaining <= 1e-9) break;
    const lotStock = Number(l.stock);
    if (!(lotStock > 0)) continue;
    const take = Math.min(remaining, lotStock);
    picks.push({ lote: l.lote, fecha_vencimiento: l.fecha_vencimiento, qty: take });
    remaining -= take;
  }
  if (remaining <= 1e-9) remaining = 0;
  return { picks, remaining };
}

async function getLastUnitCost(conn, id_bodega, id_producto, lote) {
  const [rows] = await conn.query(
    `SELECT costo_unitario
     FROM kardex
     WHERE id_bodega=? AND id_producto=? AND lote <=> ? AND delta_cantidad > 0
     ORDER BY creado_en DESC LIMIT 1`,
    [id_bodega, id_producto, lote]
  );
  return rows[0]?.costo_unitario ?? 0;
}

// recomputePedidoEstado del servidor (misma lógica y UPDATEs).
async function recomputePedidoEstado(conn, id_pedido, opts = {}) {
  const actorUserId = Number(opts?.actorUserId || 0) || null;
  const justificacion = String(opts?.justificacion || "").trim();
  const [[agg]] = await conn.query(
    `SELECT
       COUNT(*) AS total_lineas,
       SUM(CASE WHEN COALESCE(estado_linea, 'PENDIENTE')='ANULADO' THEN 1 ELSE 0 END) AS lineas_anuladas,
       SUM(CASE WHEN cantidad_surtida >= cantidad_solicitada AND cantidad_solicitada > 0 THEN 1 ELSE 0 END) AS lineas_completas_qty,
       SUM(CASE WHEN cantidad_surtida > 0 AND cantidad_surtida < cantidad_solicitada THEN 1 ELSE 0 END) AS lineas_parciales_qty,
       SUM(cantidad_solicitada) AS total_solicitado,
       SUM(cantidad_surtida) AS total_surtido
     FROM pedido_detalle
     WHERE id_pedido=?`,
    [id_pedido]
  );
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
       SET estado=?,
           justificacion_despacho=NULL,
           aprobado_por=COALESCE(?, aprobado_por),
           aprobado_en=NOW()
       WHERE id_pedido=?`,
      [estado, actorUserId, id_pedido]
    );
    return { estado, justificacion_despacho: null };
  }

  if (justificacion && (estado === "PARCIAL" || estado === "COMPLETADO_JUSTIFICADO")) {
    const [[head]] = await conn.query(
      `SELECT justificacion_despacho FROM pedido_encabezado WHERE id_pedido=? LIMIT 1`,
      [id_pedido]
    );
    const current = String(head?.justificacion_despacho || "").trim();
    const finalJust =
      !current ? justificacion : current.toLowerCase() === justificacion.toLowerCase() ? current : `${current} | ${justificacion}`;
    await conn.query(
      `UPDATE pedido_encabezado
       SET estado=?, justificacion_despacho=?, aprobado_por=COALESCE(?, aprobado_por), aprobado_en=NOW()
       WHERE id_pedido=?`,
      [estado, finalJust, actorUserId, id_pedido]
    );
    return { estado, justificacion_despacho: finalJust };
  }

  await conn.query(
    `UPDATE pedido_encabezado
     SET estado=?, aprobado_por=COALESCE(?, aprobado_por), aprobado_en=NOW()
     WHERE id_pedido=?`,
    [estado, actorUserId, id_pedido]
  );
  return { estado, justificacion_despacho: null };
}

// POST /api/orders/:id/fulfill — replica con SAVEPOINT para imitar el rollback
// del endpoint (devuelve { ok:false, error, skipped } en los paths de error).
async function replicaFulfill(conn, { id_pedido, lines, justificacion = null, actorWarehouse, actorUserId }) {
  await conn.query(`SAVEPOINT sp_fulfill`);
  const skipped = [];
  const fail = async (error) => {
    await conn.query(`RELEASE SAVEPOINT sp_fulfill`);
    return { ok: false, error, skipped };
  };

  const [[pe]] = await conn.query(`SELECT * FROM pedido_encabezado WHERE id_pedido=? FOR UPDATE`, [id_pedido]);
  if (!pe) return fail("Pedido no existe");
  if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
    return fail("No puedes despachar pedidos de otra bodega");
  }
  if (["CANCELADO", "COMPLETADO", "COMPLETADO_JUSTIFICADO"].includes(pe.estado)) {
    return fail("Pedido no despachable");
  }

  const [[cfg]] = await conn.query(
    `SELECT cb.modo_despacho_auto, cb.maneja_stock, cb.requiere_confirmacion_recepcion, b.tipo_bodega
     FROM configuracion_bodega cb
     JOIN bodegas b ON b.id_bodega=cb.id_bodega
     WHERE cb.id_bodega=?`,
    [pe.id_bodega_solicita]
  );
  const useTransfer = cfg?.tipo_bodega === "RECEPTORA" || cfg?.modo_despacho_auto === "TRANSFERENCIA";
  const tipo_mov = useTransfer ? "TRANSFERENCIA" : "SALIDA";
  const [[solUser]] = await conn.query(
    `SELECT nombre_completo FROM usuarios WHERE id_usuario=? LIMIT 1`,
    [pe.id_usuario_solicita]
  );
  const solicitanteNombre = String(solUser?.nombre_completo || `Usuario #${pe.id_usuario_solicita}`);

  const [[mot]] = await conn.query(
    `SELECT id_motivo
     FROM motivos_movimiento
     WHERE (nombre_motivo='Transferencia' AND ?='TRANSFERENCIA')
        OR (?='SALIDA' AND tipo_movimiento='SALIDA')
     ORDER BY (nombre_motivo='Transferencia') DESC
     LIMIT 1`,
    [tipo_mov, tipo_mov]
  );
  if (!mot) return fail("No existe motivo para el movimiento");

  const [mhRes] = await conn.query(
    `INSERT INTO movimiento_encabezado
     (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 'CONFIRMADO')`,
    [tipo_mov, mot.id_motivo, pe.id_bodega_surtidor, pe.id_bodega_solicita,
     `Despacho Pedido #${id_pedido} | Solicitante: ${solicitanteNombre}`, actorUserId]
  );
  const id_movimiento = mhRes.insertId;

  let anyFulfilled = false;
  let requiresJustificacion = false;
  const justificacionTxt = String(justificacion || "").trim();

  for (const ln of lines) {
    const id_pedido_detalle = Number(ln.id_pedido_detalle);
    const qtyToFill = Number(ln.qty || 0);
    if (!id_pedido_detalle || qtyToFill <= 0) continue;

    const [[line]] = await conn.query(
      `SELECT * FROM pedido_detalle WHERE id_pedido_detalle=? AND id_pedido=? FOR UPDATE`,
      [id_pedido_detalle, id_pedido]
    );
    if (!line) continue;
    if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
      skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "LINEA_ANULADA" });
      continue;
    }

    const remainingToFill = Number(line.cantidad_solicitada) - Number(line.cantidad_surtida);
    if (remainingToFill <= 0) continue;

    const requested = Math.max(Number(qtyToFill || 0), 0);
    if (requested !== remainingToFill) requiresJustificacion = true;

    const { picks } = await pickLotsFEFO(conn, pe.id_bodega_surtidor, line.id_producto, requested);
    if (!picks.length) {
      requiresJustificacion = true;
      skipped.push({ id_pedido_detalle, id_producto: line.id_producto, motivo: "SIN_STOCK_NO_VIGENTE" });
      continue;
    }
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
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id_movimiento, line.id_producto, p.lote || null, p.fecha_vencimiento || null, p.qty, costo_unitario, `Pedido #${id_pedido}`]
      );
      const id_detalle = d.insertId;

      await conn.query(
        `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id_movimiento, id_detalle, pe.id_bodega_surtidor, line.id_producto,
         p.lote || null, p.fecha_vencimiento || null, -p.qty, costo_unitario]
      );

      if (useTransfer && cfg?.maneja_stock === 1) {
        await conn.query(
          `INSERT INTO kardex
           (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_movimiento, id_detalle, pe.id_bodega_solicita, line.id_producto,
           p.lote || null, p.fecha_vencimiento || null, +p.qty, costo_unitario]
        );
      }

      await conn.query(
        `INSERT INTO pedido_movimiento_vinculo (id_pedido_detalle, id_movimiento, id_detalle)
         VALUES (?, ?, ?)`,
        [id_pedido_detalle, id_movimiento, id_detalle]
      );
    }

    const fulfilledNow = picks.reduce((a, b) => a + Number(b.qty), 0);
    const projectedSurtida = Number(line.cantidad_surtida) + fulfilledNow;
    if (projectedSurtida < Number(line.cantidad_solicitada)) requiresJustificacion = true;

    await conn.query(
      `UPDATE pedido_detalle
       SET estado_linea = CASE
             WHEN (cantidad_surtida + ?) >= cantidad_solicitada THEN 'DESPACHADO'
             ELSE 'PENDIENTE'
           END,
           justificacion_linea = CASE
             WHEN ? IS NULL OR ?='' THEN justificacion_linea
             WHEN (cantidad_surtida + ?) != cantidad_solicitada THEN ?
             ELSE justificacion_linea
           END,
           cantidad_surtida = cantidad_surtida + ?
       WHERE id_pedido_detalle=?`,
      [fulfilledNow, justificacionTxt || null, justificacionTxt || null,
       fulfilledNow, justificacionTxt || null, fulfilledNow, id_pedido_detalle]
    );
  }

  if (!anyFulfilled) {
    await conn.query(`ROLLBACK TO SAVEPOINT sp_fulfill`);
    await conn.query(`RELEASE SAVEPOINT sp_fulfill`);
    return { ok: false, error: "Sin stock en las lineas seleccionadas", skipped };
  }
  if (requiresJustificacion && !justificacionTxt) {
    await conn.query(`ROLLBACK TO SAVEPOINT sp_fulfill`);
    await conn.query(`RELEASE SAVEPOINT sp_fulfill`);
    return { ok: false, error: "Para despacho parcial debes ingresar una justificacion.", skipped };
  }

  const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId, justificacion: justificacionTxt || null });
  const newStatus = recalc.estado;

  const requiereConf = Number(cfg?.requiere_confirmacion_recepcion || 0) === 1;
  if (requiereConf && ["COMPLETADO", "COMPLETADO_JUSTIFICADO"].includes(newStatus)) {
    await conn.query(`UPDATE pedido_encabezado SET confirmacion_requerida=1 WHERE id_pedido=?`, [id_pedido]);
  }

  await conn.query(`RELEASE SAVEPOINT sp_fulfill`);
  return { ok: true, id_movimiento, estado: newStatus, skipped };
}

// POST /api/orders/:id/cancel-line — replica con SAVEPOINT.
async function replicaCancelLine(conn, { id_pedido, id_pedido_detalle, justificacion, actorWarehouse, actorUserId }) {
  await conn.query(`SAVEPOINT sp_cancel`);
  const justTxt = String(justificacion || "").trim();
  const fail = async (error) => {
    await conn.query(`RELEASE SAVEPOINT sp_cancel`);
    return { ok: false, error };
  };
  if (!id_pedido_detalle) return fail("Falta linea");
  if (!justTxt) return fail("La justificacion es obligatoria para anular una linea.");

  const [[pe]] = await conn.query(
    `SELECT id_bodega_solicita, id_bodega_surtidor FROM pedido_encabezado WHERE id_pedido=? FOR UPDATE`,
    [id_pedido]
  );
  if (!pe) return fail("Pedido no existe");
  if (Number(pe.id_bodega_surtidor || 0) !== actorWarehouse) {
    return fail("No puedes anular lineas de otra bodega");
  }

  const [[line]] = await conn.query(
    `SELECT id_pedido_detalle, cantidad_solicitada, cantidad_surtida, COALESCE(estado_linea, 'PENDIENTE') AS estado_linea
     FROM pedido_detalle
     WHERE id_pedido_detalle=? AND id_pedido=? FOR UPDATE`,
    [id_pedido_detalle, id_pedido]
  );
  if (!line) return fail("Linea no encontrada");
  if (String(line.estado_linea || "").toUpperCase() === "ANULADO") {
    return fail("La linea ya esta anulada.");
  }
  const pendiente = Math.max(0, Number(line.cantidad_solicitada || 0) - Number(line.cantidad_surtida || 0));
  if (pendiente <= 0) return fail("La linea ya fue despachada completamente.");

  await conn.query(
    `UPDATE pedido_detalle
     SET estado_linea='ANULADO',
         justificacion_linea=?,
         anulado_por=?,
         anulado_en=NOW()
     WHERE id_pedido_detalle=?`,
    [justTxt, actorUserId, id_pedido_detalle]
  );

  const recalc = await recomputePedidoEstado(conn, id_pedido, { actorUserId, justificacion: justTxt });
  await conn.query(`RELEASE SAVEPOINT sp_cancel`);
  return { ok: true, estado: recalc.estado, id_pedido_detalle };
}

// ── Setup helpers ────────────────────────────────────────────────────────────
async function insertEntrada(conn, { id_motivo, id_bodega, id_usuario, id_producto, lote, fec, cantidad, costo }) {
  const [r] = await conn.query(
    `INSERT INTO movimiento_encabezado
     (tipo_movimiento, id_motivo, id_bodega_destino, observaciones, creado_por, estado)
     VALUES ('ENTRADA', ?, ?, ?, ?, 'CONFIRMADO')`,
    [id_motivo, id_bodega, `Entrada test lote ${lote}`, id_usuario]
  );
  const idMov = r.insertId;
  const [d] = await conn.query(
    `INSERT INTO movimiento_detalle (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [idMov, id_producto, lote, fec, cantidad, costo]
  );
  await conn.query(
    `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [idMov, d.insertId, id_bodega, id_producto, lote, fec, cantidad, costo]
  );
  return idMov;
}

async function createPedido(conn, { id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, lines }) {
  const [r] = await conn.query(
    `INSERT INTO pedido_encabezado (id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, estado)
     VALUES (?, ?, ?, 'PENDIENTE')`,
    [id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor]
  );
  const idPedido = r.insertId;
  const dets = [];
  for (const ln of lines) {
    const [d] = await conn.query(
      `INSERT INTO pedido_detalle (id_pedido, id_producto, cantidad_solicitada, cantidad_surtida, estado_linea)
       VALUES (?, ?, ?, 0, 'PENDIENTE')`,
      [idPedido, ln.id_producto, ln.cantidad]
    );
    dets.push({ id_pedido_detalle: d.insertId, id_producto: ln.id_producto, cantidad: ln.cantidad });
  }
  return { idPedido, dets };
}

// Salidas (kardex delta<0) de un movimiento: map `lote|fec` → delta.
async function movimientoSalidas(conn, idMov) {
  const [rows] = await conn.query(
    `SELECT k.lote, DATE_FORMAT(k.fecha_vencimiento, '%Y-%m-%d') AS fec, SUM(k.delta_cantidad) AS d
     FROM kardex k
     WHERE k.id_movimiento = ? AND k.delta_cantidad < 0
     GROUP BY k.lote, k.fecha_vencimiento`,
    [idMov]
  );
  const m = new Map();
  for (const r of rows) m.set(`${r.lote || ""}|${r.fec || ""}`, Number(r.d));
  return m;
}

async function getLinea(conn, idPedDet) {
  const [[l]] = await conn.query(
    `SELECT cantidad_solicitada, cantidad_surtida, estado_linea, justificacion_linea, anulado_por
     FROM pedido_detalle WHERE id_pedido_detalle=?`,
    [idPedDet]
  );
  return l;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  await conn.beginTransaction();
  try {
    // ── Datos base reales (FKs válidas) ──
    const [[sur]] = await conn.query(
      `SELECT c.id_bodega FROM configuracion_bodega c
       JOIN bodegas b ON b.id_bodega=c.id_bodega
       WHERE c.maneja_stock=1 AND c.puede_despachar=1 AND b.activo=1
       ORDER BY c.id_bodega LIMIT 1`);
    const [[sol]] = await conn.query(
      `SELECT c.id_bodega FROM configuracion_bodega c
       JOIN bodegas b ON b.id_bodega=c.id_bodega
       WHERE c.maneja_stock=0 AND c.modo_despacho_auto='SALIDA'
         AND b.tipo_bodega <> 'RECEPTORA' AND b.activo=1
       ORDER BY c.id_bodega LIMIT 1`);
    const [[usrSur]] = await conn.query(
      `SELECT id_usuario FROM usuarios WHERE id_bodega=? AND activo=1 LIMIT 1`, [sur?.id_bodega]);
    const [[usrSol]] = await conn.query(
      `SELECT id_usuario FROM usuarios WHERE id_bodega=? AND activo=1 LIMIT 1`, [sol?.id_bodega]);
    const prods = await conn.query(
      `SELECT p.id_producto FROM productos p
       WHERE p.activo=1
         AND NOT EXISTS (SELECT 1 FROM stock_actual sa WHERE sa.id_bodega=? AND sa.id_producto=p.id_producto)
       ORDER BY p.id_producto LIMIT 3`,
      [sur?.id_bodega]);
    const [[motEnt]] = await conn.query(
      `SELECT id_motivo FROM motivos_movimiento WHERE tipo_movimiento='ENTRADA' ORDER BY id_motivo LIMIT 1`);
    const [[motSal]] = await conn.query(
      `SELECT id_motivo FROM motivos_movimiento WHERE tipo_movimiento='SALIDA' ORDER BY id_motivo LIMIT 1`);
    if (!sur || !sol || !usrSur || !usrSol || prods[0].length < 3 || !motEnt || !motSal) {
      throw new Error("Faltan datos base (bodegas, usuarios, 3 productos, motivos) para el test de despacho rápido");
    }

    const BOD_SUR = sur.id_bodega;
    const BOD_SOL = sol.id_bodega;
    const USR_SUR = usrSur.id_usuario;
    const USR_SOL = usrSol.id_usuario;
    const [P_A, P_B, P_C] = prods[0].map((p) => p.id_producto);
    const MOT_ENT = motEnt.id_motivo;
    const MOT_SAL = motSal.id_motivo;

    const ts = Date.now();
    const L_A1 = `ZZDESP_${ts}_A1`; // vence 2027-06-01 (FEFO primero)
    const L_A2 = `ZZDESP_${ts}_A2`; // vence 2028-01-01
    const L_AX = `ZZDESP_${ts}_AX`; // vencida 2020-01-01 → NO despachable
    const L_A3 = `ZZDESP_${ts}_A3`; // vence 2029-01-01 (S6: regresión estado_linea)
    const L_B1 = `ZZDESP_${ts}_B1`;
    const L_CX = `ZZDESP_${ts}_CX`; // vencida 2021-01-01 → NO despachable

    const [[countBefore]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);

    console.log(
      `Despacho rápido: surtidor=${BOD_SUR}, solicitante=${BOD_SOL}, ` +
      `productos A=${P_A}/B=${P_B}/C=${P_C}\n`
    );

    // ── Entradas (replica POST /api/entradas): A1=100, A2=50, AX(vencida)=200,
    //    B1=80, CX(vencida)=30 ──
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_A, lote: L_A1, fec: "2027-06-01", cantidad: 100, costo: 10 });
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_A, lote: L_A2, fec: "2028-01-01", cantidad: 50, costo: 12 });
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_A, lote: L_AX, fec: "2020-01-01", cantidad: 200, costo: 8 });
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_B, lote: L_B1, fec: "2027-09-01", cantidad: 80, costo: 15 });
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_C, lote: L_CX, fec: "2021-01-01", cantidad: 30, costo: 5 });

    // ── PEDIDO 1: A(70), B(30) ──
    const p1 = await createPedido(conn, {
      id_usuario_solicita: USR_SOL, id_bodega_solicita: BOD_SOL, id_bodega_surtidor: BOD_SUR,
      lines: [{ id_producto: P_A, cantidad: 70 }, { id_producto: P_B, cantidad: 30 }],
    });
    const [L1, L2] = p1.dets;

    // S1: ⚡ por línea — solo L1 (A=70). FEFO: A1 (2027) antes que A2 (2028);
    // la vencida AX no debe tocarse. L2 (B) debe quedar intacta.
    const r1 = await replicaFulfill(conn, {
      id_pedido: p1.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR,
      lines: [{ id_pedido_detalle: L1.id_pedido_detalle, qty: 70 }],
    });
    check("S1a) fulfill ⚡ por línea responde ok", r1.ok === true, r1.ok ? `id_mov=${r1.id_movimiento}` : r1.error);
    check("S1a) skipped vacío (cobertura completa)", Array.isArray(r1.skipped) && r1.skipped.length === 0, JSON.stringify(r1.skipped));
    if (r1.ok) {
      const sal = await movimientoSalidas(conn, r1.id_movimiento);
      check("S1b) FEFO: solo lote A1 consumido (-70)", sal.get(`${L_A1}|2027-06-01`) === -70, JSON.stringify([...sal.entries()]));
      check("S1b) FEFO: A2 NO consumido aún", !sal.has(`${L_A2}|2028-01-01`));
      check("S1b) Lote vencido AX NO consumido", !sal.has(`${L_AX}|2020-01-01`));
      check("S1b) B no despachado", !sal.has(`${L_B1}|2027-09-01`));
    }
    let l1 = await getLinea(conn, L1.id_pedido_detalle);
    let l2 = await getLinea(conn, L2.id_pedido_detalle);
    check("S1c) L1 surtida 70/70 DESPACHADO", Number(l1.cantidad_surtida) === 70 && String(l1.estado_linea) === "DESPACHADO", `${l1.cantidad_surtida}/${l1.cantidad_solicitada} ${l1.estado_linea}`);
    check("S1c) L2 intacta 0/30 PENDIENTE", Number(l2.cantidad_surtida) === 0 && String(l2.estado_linea) === "PENDIENTE", `${l2.cantidad_surtida}/${l2.cantidad_solicitada} ${l2.estado_linea}`);
    const [[p1e1]] = await conn.query(`SELECT estado FROM pedido_encabezado WHERE id_pedido=?`, [p1.idPedido]);
    check("S1d) Pedido PARCIAL tras ⚡ por línea", p1e1.estado === "PARCIAL", p1e1.estado);
    await assertGroup("S1e) stock_actual A1=30", conn, BOD_SUR, P_A, L_A1, "2027-06-01");
    await assertGroup("S1e) stock_actual A2=50 intacto", conn, BOD_SUR, P_A, L_A2, "2028-01-01");
    await assertGroup("S1e) stock_actual AX(vencida)=200 intacto", conn, BOD_SUR, P_A, L_AX, "2020-01-01");
    await assertGroup("S1e) stock_actual B1=80 intacto", conn, BOD_SUR, P_B, L_B1, "2027-09-01");

    // S2: ⚡ Despachar todo — líneas pendientes (solo L2, B=30).
    const r2 = await replicaFulfill(conn, {
      id_pedido: p1.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR,
      lines: [{ id_pedido_detalle: L2.id_pedido_detalle, qty: 30 }],
    });
    check("S2a) fulfill ⚡ despachar todo responde ok", r2.ok === true, r2.ok ? `id_mov=${r2.id_movimiento}` : r2.error);
    check("S2a) estado final COMPLETADO", r2.ok && r2.estado === "COMPLETADO", r2.estado);
    if (r2.ok) {
      const sal2 = await movimientoSalidas(conn, r2.id_movimiento);
      check("S2b) B1 consumido -30", sal2.get(`${L_B1}|2027-09-01`) === -30, JSON.stringify([...sal2.entries()]));
    }
    l2 = await getLinea(conn, L2.id_pedido_detalle);
    check("S2c) L2 surtida 30/30 DESPACHADO", Number(l2.cantidad_surtida) === 30 && String(l2.estado_linea) === "DESPACHADO", `${l2.cantidad_surtida}/${l2.cantidad_solicitada} ${l2.estado_linea}`);
    await assertGroup("S2d) stock_actual B1=50", conn, BOD_SUR, P_B, L_B1, "2027-09-01");

    // ── PEDIDO 2: A(40), B(10), A(5 anulada localmente) ──
    // quickDispatch([L3,L4]) + cancelAnuladas([L5]) — como hace DespachoForm.
    const p2 = await createPedido(conn, {
      id_usuario_solicita: USR_SOL, id_bodega_solicita: BOD_SOL, id_bodega_surtidor: BOD_SUR,
      lines: [{ id_producto: P_A, cantidad: 40 }, { id_producto: P_B, cantidad: 10 }, { id_producto: P_A, cantidad: 5 }],
    });
    const [L3, L4, L5] = p2.dets;

    const r3 = await replicaFulfill(conn, {
      id_pedido: p2.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR,
      lines: [
        { id_pedido_detalle: L3.id_pedido_detalle, qty: 40 },
        { id_pedido_detalle: L4.id_pedido_detalle, qty: 10 },
      ],
    });
    check("S3a) fulfill L3+L4 ok", r3.ok === true, r3.ok ? `id_mov=${r3.id_movimiento}` : r3.error);
    if (r3.ok) {
      // FEFO: A1 quedó en 30 → toma 30 de A1 + 10 de A2 (vencida AX intacta).
      const sal3 = await movimientoSalidas(conn, r3.id_movimiento);
      check("S3b) FEFO A: A1 -30 y A2 -10 (vencida intacta)", sal3.get(`${L_A1}|2027-06-01`) === -30 && sal3.get(`${L_A2}|2028-01-01`) === -10 && !sal3.has(`${L_AX}|2020-01-01`), JSON.stringify([...sal3.entries()]));
      check("S3b) B1 -10", sal3.get(`${L_B1}|2027-09-01`) === -10);
    }
    // La línea anulada NO se incluyó en el fulfill (quickDispatch filtra anuladas).
    const r4 = await replicaCancelLine(conn, {
      id_pedido: p2.idPedido, id_pedido_detalle: L5.id_pedido_detalle,
      justificacion: "Anulado manualmente", actorWarehouse: BOD_SUR, actorUserId: USR_SUR,
    });
    check("S3c) cancel-line de la anulada responde ok", r4.ok === true, r4.ok ? r4.estado : r4.error);
    check("S3c) pedido COMPLETADO_JUSTIFICADO tras anular", r4.ok && r4.estado === "COMPLETADO_JUSTIFICADO", r4.estado);
    const l5 = await getLinea(conn, L5.id_pedido_detalle);
    check("S3d) L5 ANULADO con cantidad_surtida=0", String(l5.estado_linea) === "ANULADO" && Number(l5.cantidad_surtida) === 0, `${l5.estado_linea} surtida=${l5.cantidad_surtida}`);
    check("S3d) L5 justificación y anulado_por registrados", String(l5.justificacion_linea || "") === "Anulado manualmente" && Number(l5.anulado_por) === USR_SUR, `just=${l5.justificacion_linea} por=${l5.anulado_por}`);
    // El kardex del fulfill L3+L4 no debe tener la fila del 5 de A anulado.
    if (r3.ok) {
      const sal3b = await movimientoSalidas(conn, r3.id_movimiento);
      check("S3e) anulada no consumió stock (A total -40 exacto)", sal3b.get(`${L_A1}|2027-06-01`) === -30 && sal3b.get(`${L_A2}|2028-01-01`) === -10 && sal3b.size === 3, JSON.stringify([...sal3b.entries()]));
    }
    await assertGroup("S3f) stock_actual A1=0", conn, BOD_SUR, P_A, L_A1, "2027-06-01");
    await assertGroup("S3f) stock_actual A2=40", conn, BOD_SUR, P_A, L_A2, "2028-01-01");
    await assertGroup("S3f) stock_actual AX(vencida)=200 intacto", conn, BOD_SUR, P_A, L_AX, "2020-01-01");

    // ── PEDIDO 3: A(100) con solo 40 vigentes (A1=0, A2=40) + 200 vencidas ──
    // SIN_STOCK_PARCIAL: despacha 40 y reporta faltante 60 sin tocar vencidas.
    const p3 = await createPedido(conn, {
      id_usuario_solicita: USR_SOL, id_bodega_solicita: BOD_SOL, id_bodega_surtidor: BOD_SUR,
      lines: [{ id_producto: P_A, cantidad: 100 }],
    });
    const L6 = p3.dets[0];
    const r5 = await replicaFulfill(conn, {
      id_pedido: p3.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR, justificacion: "Prueba parcial test",
      lines: [{ id_pedido_detalle: L6.id_pedido_detalle, qty: 100 }],
    });
    check("S4a) fulfill parcial con justificación responde ok", r5.ok === true, r5.ok ? r5.estado : r5.error);
    const skipParcial = (r5.skipped || []).find((s) => s.motivo === "SIN_STOCK_PARCIAL");
    check("S4b) skipped SIN_STOCK_PARCIAL {solicitado:100, despachado:40, faltante:60}",
      !!skipParcial && Number(skipParcial.solicitado) === 100 && Number(skipParcial.despachado) === 40 && Number(skipParcial.faltante) === 60,
      JSON.stringify(r5.skipped));
    if (r5.ok) {
      const sal5 = await movimientoSalidas(conn, r5.id_movimiento);
      check("S4c) solo A2 -40 (vencida AX intacta)", sal5.get(`${L_A2}|2028-01-01`) === -40 && !sal5.has(`${L_AX}|2020-01-01`), JSON.stringify([...sal5.entries()]));
    }
    const l6 = await getLinea(conn, L6.id_pedido_detalle);
    check("S4d) L6 surtida 40/100 PENDIENTE", Number(l6.cantidad_surtida) === 40 && String(l6.estado_linea) === "PENDIENTE", `${l6.cantidad_surtida}/${l6.cantidad_solicitada} ${l6.estado_linea}`);
    const [[p3e]] = await conn.query(`SELECT estado FROM pedido_encabezado WHERE id_pedido=?`, [p3.idPedido]);
    check("S4e) Pedido PARCIAL tras parcial", p3e.estado === "PARCIAL", p3e.estado);
    await assertGroup("S4f) stock_actual A2=0", conn, BOD_SUR, P_A, L_A2, "2028-01-01");
    await assertGroup("S4f) stock_actual AX(vencida)=200 intacto", conn, BOD_SUR, P_A, L_AX, "2020-01-01");

    // ── PEDIDO 4: C(5) con SOLO stock vencido (CX=30) ──
    // SIN_STOCK_NO_VIGENTE: no despacha nada, 400 + rollback del movimiento.
    const p4 = await createPedido(conn, {
      id_usuario_solicita: USR_SOL, id_bodega_solicita: BOD_SOL, id_bodega_surtidor: BOD_SUR,
      lines: [{ id_producto: P_C, cantidad: 5 }],
    });
    const L7 = p4.dets[0];
    const r6 = await replicaFulfill(conn, {
      id_pedido: p4.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR,
      lines: [{ id_pedido_detalle: L7.id_pedido_detalle, qty: 5 }],
    });
    check("S5a) fulfill sin stock vigente responde 400", r6.ok === false && r6.error === "Sin stock en las lineas seleccionadas", JSON.stringify(r6));
    const skipNoVig = (r6.skipped || []).find((s) => s.motivo === "SIN_STOCK_NO_VIGENTE");
    check("S5b) skipped SIN_STOCK_NO_VIGENTE", !!skipNoVig, JSON.stringify(r6.skipped));
    const l7 = await getLinea(conn, L7.id_pedido_detalle);
    check("S5c) L7 sin surtir (0/5 PENDIENTE)", Number(l7.cantidad_surtida) === 0 && String(l7.estado_linea) === "PENDIENTE", `${l7.cantidad_surtida}/${l7.cantidad_solicitada} ${l7.estado_linea}`);
    const [[p4e]] = await conn.query(`SELECT estado FROM pedido_encabezado WHERE id_pedido=?`, [p4.idPedido]);
    check("S5d) Pedido sigue PENDIENTE", p4e.estado === "PENDIENTE", p4e.estado);
    const [[movP4]] = await conn.query(
      `SELECT COUNT(*) AS c FROM movimiento_encabezado WHERE observaciones LIKE 'Despacho Pedido #${p4.idPedido}%'`);
    check("S5e) movimiento del fulfill fallido revertido (0 huérfanos)", Number(movP4.c) === 0, `movs=${movP4.c}`);
    await assertGroup("S5f) stock_actual CX(vencida)=30 intacto", conn, BOD_SUR, P_C, L_CX, "2021-01-01");

    // ── PEDIDO 5: regresión estado_linea — despacho PARCIAL ≥50% en un solo call ──
    // MySQL evalúa las asignaciones del UPDATE de una sola tabla de izquierda a
    // derecha: si `cantidad_surtida` se actualizara antes que `estado_linea`,
    // la condición (cantidad_surtida + add) duplicaría el add y marcaría
    // DESPACHADO una línea solo surtida a la mitad (50/100). El endpoint
    // actualiza cantidad_surtida al FINAL del SET; aquí se verifica que 50/100
    // queda PENDIENTE (y no DESPACHADO prematuro).
    await insertEntrada(conn, { id_motivo: MOT_ENT, id_bodega: BOD_SUR, id_usuario: USR_SUR, id_producto: P_A, lote: L_A3, fec: "2029-01-01", cantidad: 100, costo: 10 });
    const p5 = await createPedido(conn, {
      id_usuario_solicita: USR_SOL, id_bodega_solicita: BOD_SOL, id_bodega_surtidor: BOD_SUR,
      lines: [{ id_producto: P_A, cantidad: 100 }],
    });
    const L8 = p5.dets[0];
    const r7 = await replicaFulfill(conn, {
      id_pedido: p5.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR, justificacion: "Mitad por ahora",
      lines: [{ id_pedido_detalle: L8.id_pedido_detalle, qty: 50 }],
    });
    check("S6a) fulfill parcial 50/100 responde ok", r7.ok === true, r7.ok ? r7.estado : r7.error);
    const l8 = await getLinea(conn, L8.id_pedido_detalle);
    check("S6b) L8 surtida 50/100 PENDIENTE (no DESPACHADO prematuro)",
      Number(l8.cantidad_surtida) === 50 && String(l8.estado_linea) === "PENDIENTE",
      `${l8.cantidad_surtida}/${l8.cantidad_solicitada} ${l8.estado_linea}`);
    check("S6c) L8 justificacion_linea registrada en el parcial",
      String(l8.justificacion_linea || "") === "Mitad por ahora", `just=${l8.justificacion_linea}`);
    const r8 = await replicaFulfill(conn, {
      id_pedido: p5.idPedido, actorWarehouse: BOD_SUR, actorUserId: USR_SUR, justificacion: "Mitad por ahora",
      lines: [{ id_pedido_detalle: L8.id_pedido_detalle, qty: 50 }],
    });
    check("S6d) fulfill 50 restantes responde ok", r8.ok === true, r8.ok ? r8.estado : r8.error);
    const l8b = await getLinea(conn, L8.id_pedido_detalle);
    check("S6e) L8 100/100 DESPACHADO al completar",
      Number(l8b.cantidad_surtida) === 100 && String(l8b.estado_linea) === "DESPACHADO",
      `${l8b.cantidad_surtida}/${l8b.cantidad_solicitada} ${l8b.estado_linea}`);
    const [[p5e]] = await conn.query(`SELECT estado FROM pedido_encabezado WHERE id_pedido=?`, [p5.idPedido]);
    check("S6f) Pedido COMPLETADO tras completar", p5e.estado === "COMPLETADO", p5e.estado);
    await assertGroup("S6g) stock_actual A3=0 tras despachar 100", conn, BOD_SUR, P_A, L_A3, "2029-01-01");

    // ── Consistencia global ──
    const { mism, exp, act } = await fullConsistency(conn);
    check("Consistencia global stock_actual vs kardex", mism === 0, `grupos kardex=${exp} | filas stock_actual=${act}`);

    await conn.rollback();
    const [[countAfter]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);
    check("ROLLBACK: stock_actual vuelve a su tamaño original", Number(countAfter.c) === Number(countBefore.c),
      `antes=${countBefore.c} | después=${countAfter.c}`);
    const [[kt]] = await conn.query(`SELECT COUNT(*) AS c FROM kardex WHERE lote LIKE 'ZZDESP%'`);
    check("ROLLBACK: sin filas de prueba en kardex", Number(kt.c) === 0);
    const [[st]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual WHERE lote LIKE 'ZZDESP%'`);
    check("ROLLBACK: sin filas de prueba en stock_actual", Number(st.c) === 0);
    const [[pe]] = await conn.query(
      `SELECT COUNT(*) AS c FROM pedido_encabezado WHERE id_pedido IN (?, ?, ?, ?, ?)`,
      [p1.idPedido, p2.idPedido, p3.idPedido, p4.idPedido, p5.idPedido]);
    check("ROLLBACK: sin pedidos de prueba", Number(pe.c) === 0);
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error("\nERROR:", e?.code || "", e?.message || e);
    process.exit(2);
  } finally {
    await conn.end();
  }

  console.log(`\n${fail === 0 ? "🎉 TODOS LOS TESTS PASARON" : "❌ HAY FALLOS"}: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail === 0 ? 0 : 1);
})();
