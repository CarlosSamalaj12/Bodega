// ─────────────────────────────────────────────────────────────────────────────
// test_reversa_e2e.cjs
// Test end-to-end de reversa de movimiento que pasa por los triggers REALES de
// stock_actual (trg_kardex_stock_ai / _ad / _au):
//
//   Entrada  → replica POST /api/entradas        (INSERT kardex delta>0 → ai)
//   Despacho → replica POST /api/orders/:id/fulfill (INSERT kardex delta<0 → ai)
//   Reversa  → replica POST /api/orders/:id/revert  (DELETE kardex → ad)
//   Extra    → UPDATE de creado_en en kardex (→ au) y reversa de la entrada
//              (DELETE kardex delta>0 → ad con recomputo + limpieza de fila)
//
// Replica el SQL exacto de los endpoints (movimiento_encabezado/detalle,
// pedido_encabezado/detalle, pedido_movimiento_vinculo y las sentencias de
// kardex) para que las operaciones disparen los triggers transaccionales reales
// ai, ad y au. Tras cada paso verifica que stock y fecha_entrada_lote en
// stock_actual coinciden con el agregado real de kardex (ground truth).
//
// Nota: el despacho se fuerza al path SALIDA (bodega solicitante con
// modo_despacho_auto='SALIDA'); el path TRANSFERENCIA (que además inserta un
// kardex positivo en la bodega solicitante) queda fuera de este test.
//
// IMPORTANTE: todo corre dentro de una transacción con ROLLBACK al final
// (los triggers escriben en la misma transacción), así que NO modifica datos
// reales. Usa bodegas/productos/usuarios existentes y lotes únicos ZZE2E_*.
//
// Uso: node test_reversa_e2e.cjs
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

// Agregado REAL de kardex para un grupo (ground truth). null si no hay filas.
async function expectedGroup(conn, id_bodega, id_producto, lote, fec) {
  const [[r]] = await conn.query(
    `SELECT SUM(delta_cantidad) AS stock,
            COALESCE(DATE_FORMAT(MIN(IF(delta_cantidad > 0, DATE(creado_en), NULL)), '%Y-%m-%d'), '') AS fel
     FROM kardex
     WHERE id_bodega = ? AND id_producto = ?
       AND (lote <=> ?) AND (fecha_vencimiento <=> ?)`,
    [id_bodega, id_producto, lote, fec]
  );
  if (r.stock === null) return null;
  return { stock: Number(r.stock), fel: r.fel };
}

async function actualGroup(conn, id_bodega, id_producto, lote, fec) {
  const [rows] = await conn.query(
    `SELECT stock,
            COALESCE(DATE_FORMAT(fecha_entrada_lote, '%Y-%m-%d'), '') AS fel
     FROM stock_actual
     WHERE id_bodega = ? AND id_producto = ?
       AND (lote <=> ?) AND (fecha_vencimiento <=> ?)`,
    [id_bodega, id_producto, lote, fec]
  );
  return rows[0] ? { stock: Number(rows[0].stock), fel: rows[0].fel } : null;
}

const fmtG = (g) => (g ? `stock=${g.stock}, fel=${g.fel || "(NULL)"}` : "AUSENTE");

async function assertGroup(name, conn, id_bodega, id_producto, lote, fec) {
  const exp = await expectedGroup(conn, id_bodega, id_producto, lote, fec);
  const act = await actualGroup(conn, id_bodega, id_producto, lote, fec);
  let ok;
  if (exp === null) {
    ok = act === null;
  } else {
    ok = act !== null && Math.abs(act.stock - exp.stock) < 1e-6 && act.fel === exp.fel;
  }
  check(name, ok, `esperado=${fmtG(exp)} | real=${fmtG(act)}`);
}

async function fullConsistency(conn) {
  const KEY_EXPR = `CONCAT(IF(lote IS NULL, 'N', 'Y'), COALESCE(lote, '')) AS lote_key,
                    IF(fecha_vencimiento IS NULL, '1000-01-01', DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d')) AS fecha_key`;
  const [expRows] = await conn.query(`
    SELECT id_bodega, id_producto, ${KEY_EXPR}, SUM(delta_cantidad) AS stock,
           COALESCE(DATE_FORMAT(MIN(IF(delta_cantidad > 0, DATE(creado_en), NULL)), '%Y-%m-%d'), '') AS fel
    FROM kardex
    GROUP BY id_bodega, id_producto, lote_key, fecha_key`);
  const [actRows] = await conn.query(`
    SELECT id_bodega, id_producto, lote_key,
           DATE_FORMAT(fecha_key, '%Y-%m-%d') AS fecha_key, stock,
           COALESCE(DATE_FORMAT(fecha_entrada_lote, '%Y-%m-%d'), '') AS fel
    FROM stock_actual`);
  const keyOf = (r) => `${r.id_bodega}|${r.id_producto}|${r.lote_key}|${r.fecha_key}`;
  const expMap = new Map(expRows.map((r) => [keyOf(r), { stock: Number(r.stock), fel: r.fel }]));
  const actMap = new Map(actRows.map((r) => [keyOf(r), { stock: Number(r.stock), fel: r.fel }]));
  let mism = 0;
  for (const [k, v] of expMap) {
    const a = actMap.get(k);
    if (!a || Math.abs(a.stock - v.stock) > 1e-6 || a.fel !== v.fel) mism++;
  }
  for (const k of actMap.keys()) if (!expMap.has(k)) mism++;
  return { mism, exp: expMap.size, act: actMap.size };
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
    // Solicitante NO RECEPTORA y modo SALIDA: garantiza que el endpoint real
    // calcularía useTransfer=false (tipo_bodega='RECEPTORA' o modo TRANSFERENCIA
    // activarían el path TRANSFERENCIA con un segundo kardex positivo).
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
    const [[prod]] = await conn.query(
      `SELECT id_producto FROM productos WHERE activo=1 ORDER BY id_producto LIMIT 1`);
    const [[motEnt]] = await conn.query(
      `SELECT id_motivo FROM motivos_movimiento WHERE tipo_movimiento='ENTRADA' ORDER BY id_motivo LIMIT 1`);
    const [[motSal]] = await conn.query(
      `SELECT id_motivo FROM motivos_movimiento WHERE tipo_movimiento='SALIDA' ORDER BY id_motivo LIMIT 1`);
    if (!sur || !sol || !usrSur || !usrSol || !prod || !motEnt || !motSal) {
      throw new Error("Faltan datos base (bodegas con config, usuarios, producto, motivos) para el test E2E");
    }

    const BOD_SUR = sur.id_bodega; // bodega surtidora (despacha)
    const BOD_SOL = sol.id_bodega; // bodega solicitante (receptora)
    const USR_SUR = usrSur.id_usuario; // usuario de la bodega surtidora
    const USR_SOL = usrSol.id_usuario; // usuario de la bodega solicitante
    const PROD = prod.id_producto;
    const MOT_ENT = motEnt.id_motivo;
    const MOT_SAL = motSal.id_motivo;

    const ts = Date.now();
    const LOTE = `ZZE2E_${ts}`;
    const FEC = "2027-01-01"; // fecha de vencimiento futura
    const CANT = 100; // unidades de la entrada
    const DESP = 60; // unidades despachadas
    const COSTO = 12.5;

    const [[countBefore]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);

    console.log(
      `E2E: bodega surtidor=${BOD_SUR}, solicitante=${BOD_SOL}, producto=${PROD}, ` +
      `motivos entrada=${MOT_ENT}/salida=${MOT_SAL}, lote=${LOTE}\n`
    );

    // ── PASO 1: ENTRADA (replica POST /api/entradas) ──
    // movimiento_encabezado: tipo ENTRADA, motivo ENTRADA, bodega destino = surtidor
    const [rEnt] = await conn.query(
      `INSERT INTO movimiento_encabezado
         (tipo_movimiento, id_motivo, id_bodega_destino, observaciones, creado_por, estado)
       VALUES ('ENTRADA', ?, ?, ?, ?, 'CONFIRMADO')`,
      [MOT_ENT, BOD_SUR, `Entrada E2E lote ${LOTE}`, USR_SUR]
    );
    const idMovEnt = rEnt.insertId;
    const [dEnt] = await conn.query(
      `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idMovEnt, PROD, LOTE, FEC, CANT, COSTO]
    );
    const idDetEnt = dEnt.insertId;
    // kardex con delta > 0 → dispara trg_kardex_stock_ai (crea grupo, fel=fecha)
    await conn.query(
      `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idMovEnt, idDetEnt, BOD_SUR, PROD, LOTE, FEC, CANT, COSTO]
    );
    await assertGroup("1) ENTRADA +100 → grupo creado (stock=100, fel=hoy)", conn, BOD_SUR, PROD, LOTE, FEC);

    // ── PASO 1b: UPDATE de kardex → dispara trg_kardex_stock_au ──
    // Keys sin cambio, OLD.delta>0 → recomputa fel = MIN(DATE(creado_en)) de los
    // positivos; al mover creado_en a una fecha anterior, fel debe bajar.
    await conn.query(`UPDATE kardex SET creado_en = '2026-01-15 08:00:00' WHERE id_movimiento = ? AND id_detalle = ?`, [idMovEnt, idDetEnt]);
    await assertGroup("1b) UPDATE creado_en (trigger au) → fel baja a la fecha anterior", conn, BOD_SUR, PROD, LOTE, FEC);

    // ── PASO 2: DESPACHO (replica POST /api/orders/:id/fulfill) ──
    // pedido_encabezado: solicitante (bodega 2), surtidor (bodega 1)
    const [rPed] = await conn.query(
      `INSERT INTO pedido_encabezado
         (id_usuario_solicita, id_bodega_solicita, id_bodega_surtidor, estado)
       VALUES (?, ?, ?, 'PENDIENTE')`,
      [USR_SOL, BOD_SOL, BOD_SUR]
    );
    const idPedido = rPed.insertId;
    const [rPd] = await conn.query(
      `INSERT INTO pedido_detalle
         (id_pedido, id_producto, cantidad_solicitada, cantidad_surtida, estado_linea)
       VALUES (?, ?, ?, 0, 'PENDIENTE')`,
      [idPedido, PROD, DESP]
    );
    const idPedDet = rPd.insertId;

    // movimiento_encabezado de SALIDA (despacho) del surtidor
    const [rSal] = await conn.query(
      `INSERT INTO movimiento_encabezado
         (tipo_movimiento, id_motivo, id_bodega_origen, id_bodega_destino, observaciones, creado_por, confirmado_en, estado)
       VALUES ('SALIDA', ?, ?, ?, ?, ?, NOW(), 'CONFIRMADO')`,
      [MOT_SAL, BOD_SUR, BOD_SOL, `Despacho Pedido #${idPedido}`, USR_SUR]
    );
    const idMovSal = rSal.insertId;
    const [dSal] = await conn.query(
      `INSERT INTO movimiento_detalle
         (id_movimiento, id_producto, lote, fecha_vencimiento, cantidad, costo_unitario, observacion_linea)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idMovSal, PROD, LOTE, FEC, DESP, COSTO, `Pedido #${idPedido}`]
    );
    const idDetSal = dSal.insertId;
    // kardex con delta < 0 (salida del surtidor) → ai: stock baja, fel no cambia
    await conn.query(
      `INSERT INTO kardex
         (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [idMovSal, idDetSal, BOD_SUR, PROD, LOTE, FEC, -DESP, COSTO]
    );
    // vínculo pedido↔movimiento
    await conn.query(
      `INSERT INTO pedido_movimiento_vinculo (id_pedido_detalle, id_movimiento, id_detalle)
       VALUES (?, ?, ?)`,
      [idPedDet, idMovSal, idDetSal]
    );
    // update pedido_detalle (como el endpoint)
    await conn.query(
      `UPDATE pedido_detalle
         SET cantidad_surtida = cantidad_surtida + ?,
             estado_linea = CASE WHEN (cantidad_surtida + ?) >= cantidad_solicitada THEN 'DESPACHADO' ELSE 'PENDIENTE' END
       WHERE id_pedido_detalle = ?`,
      [DESP, DESP, idPedDet]
    );
    await assertGroup("2) DESPACHO -60 → stock=40, fel intacto", conn, BOD_SUR, PROD, LOTE, FEC);

    // ── PASO 3: REVERSA (replica POST /api/orders/:id/revert) ──
    // 3a. links del pedido (movimientos de hoy)
    const [links] = await conn.query(
      `SELECT pmv.id_movimiento, pmv.id_detalle, pmv.id_pedido_detalle, md.cantidad
       FROM pedido_movimiento_vinculo pmv
       JOIN movimiento_detalle md ON md.id_detalle = pmv.id_detalle
       JOIN movimiento_encabezado me ON me.id_movimiento = pmv.id_movimiento
       WHERE pmv.id_pedido_detalle IN (SELECT id_pedido_detalle FROM pedido_detalle WHERE id_pedido = ?)
         AND DATE(me.creado_en) = CURDATE()`,
      [idPedido]
    );
    check("3a) Reversa encuentra vínculo del despacho de hoy", links.length > 0, `links=${links.length}`);
    if (links.length) {
      const movIds = [...new Set(links.map((x) => x.id_movimiento))];
      // 3b. revertir cantidad surtida en el pedido (como el endpoint)
      for (const ln of links) {
        await conn.query(
          `UPDATE pedido_detalle
             SET cantidad_surtida = GREATEST(cantidad_surtida - ?, 0),
                 estado_linea = CASE
                   WHEN COALESCE(estado_linea, 'PENDIENTE') = 'ANULADO' THEN 'ANULADO'
                   WHEN GREATEST(cantidad_surtida - ?, 0) >= cantidad_solicitada THEN 'DESPACHADO'
                   ELSE 'PENDIENTE'
                 END
           WHERE id_pedido_detalle = ?`,
          [ln.cantidad, ln.cantidad, ln.id_pedido_detalle]
        );
      }
      // 3c. DELETE de kardex → dispara trg_kardex_stock_ad (restaura stock)
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
      await assertGroup("3) REVERSA del despacho → stock=100 (vuelve la entrada), fel intacto", conn, BOD_SUR, PROD, LOTE, FEC);
    }

    // ── PASO 4 (extra): REVERSA de la ENTRADA → dispara ad con OLD.delta>0:
    //    recomputo de fel → NULL (sin positivos) y limpieza de la fila ──
    await conn.query(`DELETE FROM kardex WHERE id_movimiento = ?`, [idMovEnt]);
    await conn.query(`DELETE FROM movimiento_detalle WHERE id_movimiento = ?`, [idMovEnt]);
    await conn.query(`DELETE FROM movimiento_encabezado WHERE id_movimiento = ?`, [idMovEnt]);
    await assertGroup("4) REVERSA de la entrada → fila eliminada (stock=0 sin kardex)", conn, BOD_SUR, PROD, LOTE, FEC);

    // ── Consistencia global + integridad post-rollback ──
    const { mism, exp, act } = await fullConsistency(conn);
    check("Consistencia global stock_actual vs kardex", mism === 0, `grupos kardex=${exp} | filas stock_actual=${act}`);

    await conn.rollback();
    const [[countAfter]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);
    check("ROLLBACK: stock_actual vuelve a su tamaño original", Number(countAfter.c) === Number(countBefore.c),
      `antes=${countBefore.c} | después=${countAfter.c}`);
    const [[kt]] = await conn.query(`SELECT COUNT(*) AS c FROM kardex WHERE lote LIKE 'ZZE2E%'`);
    check("ROLLBACK: sin filas de prueba en kardex", Number(kt.c) === 0);
    const [[st]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual WHERE lote LIKE 'ZZE2E%'`);
    check("ROLLBACK: sin filas de prueba en stock_actual", Number(st.c) === 0);
    const [[pe]] = await conn.query(`SELECT COUNT(*) AS c FROM pedido_encabezado WHERE id_pedido = ?`, [idPedido]);
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
