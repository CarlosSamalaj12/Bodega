// ─────────────────────────────────────────────────────────────────────────────
// test_kardex_triggers.cjs
// Test funcional de los triggers de mantenimiento de la tabla materializada
// stock_actual (trg_kardex_stock_ai / _ad / _au).
//
// Verifica que tras cada INSERT/UPDATE/DELETE en kardex, las columnas stock y
// fecha_entrada_lote de stock_actual coinciden EXACTAMENTE con el agregado real
// de kardex (SUM(delta_cantidad) y MIN(DATE(creado_en)) sobre delta>0), que es
// el "ground truth" que también usa test_reconcile_stock.cjs.
//
// Casos cubiertos:
//   S1  INSERT positivo (grupo nuevo)          → stock=+delta, fel=fecha
//   S2  INSERT positivo con fecha MÁS temprana → fel baja (LEAST en ON DUPLICATE)
//   S3  INSERT con delta<=0 en grupo existente → stock baja, fel no cambia
//   S4  INSERT con delta<=0 creando grupo nuevo → fila con fel NULL
//   S5  UPDATE positivo→negativo (mismo lote)  → recomputo: fel pasa al siguiente
//   S6  UPDATE negativo→positivo con fecha anterior → fel baja (vía LEAST)
//   S7  UPDATE que CAMBIA de lote (keys) con OLD.delta>0 → recomputo del grupo
//       viejo + creación del grupo nuevo
//   S8  DELETE del único positivo restante     → fel pasa a NULL
//   S8b DELETE de la última fila del grupo     → fila de stock_actual eliminada
//   S9  DELETE de un positivo que NO es el mínimo → fel se mantiene
//   S10 DELETE con delta<=0                    → stock ajusta, fel no cambia
//   +  Chequeo de consistencia global de TODOS los grupos (como el reconcile)
//   +  ROLLBACK final + verificación de que la BD quedó intacta
//
// IMPORTANTE: todo corre dentro de una transacción con ROLLBACK al final, así
// que NO modifica datos reales (los triggers escriben en la misma transacción).
// Uso: node test_kardex_triggers.cjs
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

// Agregado REAL de kardex para un grupo (ground truth). Devuelve null si el
// grupo no tiene ninguna fila en kardex.
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

// Estado actual en stock_actual para un grupo. Devuelve null si no existe fila.
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
    ok = act === null; // grupo sin filas en kardex → sin fila en stock_actual
  } else {
    ok =
      act !== null &&
      Math.abs(act.stock - exp.stock) < 1e-6 &&
      act.fel === exp.fel;
  }
  check(name, ok, `esperado=${fmtG(exp)} | real=${fmtG(act)}`);
}

// Consistencia global: TODOS los grupos de stock_actual vs el agregado real de
// kardex (misma lógica y clave NULL-safe que test_reconcile_stock.cjs).
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
  for (const k of actMap.keys()) {
    if (!expMap.has(k)) mism++;
  }
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
    // Padres válidos para las FKs de kardex (filas reales existentes).
    const [[mv]] = await conn.query(`SELECT id_movimiento FROM movimiento_encabezado ORDER BY id_movimiento LIMIT 1`);
    const [[md]] = await conn.query(`SELECT id_detalle FROM movimiento_detalle ORDER BY id_detalle LIMIT 1`);
    const [[prod]] = await conn.query(`SELECT id_producto FROM productos WHERE activo = 1 ORDER BY id_producto LIMIT 1`);
    const [[bod]] = await conn.query(`SELECT id_bodega FROM bodegas ORDER BY id_bodega LIMIT 1`);
    if (!mv || !md || !prod || !bod) {
      throw new Error("No hay filas base (movimiento_encabezado/movimiento_detalle/productos/bodegas) para el test");
    }
    const [ID_MOV, ID_DET, PROD, BOD] = [mv.id_movimiento, md.id_detalle, prod.id_producto, bod.id_bodega];
    const ts = Date.now();
    const LOTA = `ZZTESTA_${ts}`; // grupo principal
    const LOTB = `ZZTESTB_${ts}`; // para el cambio de lote
    const LOTN = `ZZTESTN_${ts}`; // grupo creado solo con negativo
    const FEC = null; // fecha_vencimiento NULL en los grupos de prueba

    const [[countBefore]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);

    const insertK = async (lote, delta, creado) => {
      const [r] = await conn.query(
        `INSERT INTO kardex (id_movimiento, id_detalle, id_bodega, id_producto, lote, fecha_vencimiento, delta_cantidad, costo_unitario, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [ID_MOV, ID_DET, BOD, PROD, lote, FEC, delta, creado]
      );
      return r.insertId;
    };
    const updateK = async (idK, sets, params) => {
      await conn.query(`UPDATE kardex SET ${sets} WHERE id_kardex = ?`, [...params, idK]);
    };
    const deleteK = async (idK) => {
      await conn.query(`DELETE FROM kardex WHERE id_kardex = ?`, [idK]);
    };

    console.log(`Test con bodega=${BOD}, producto=${PROD}, mov=${ID_MOV}, det=${ID_DET}\n`);

    // ── S1: INSERT positivo (grupo nuevo) ──
    const id1 = await insertK(LOTA, 100, "2026-06-01 10:00:00");
    await assertGroup("S1 INSERT +100 (grupo nuevo)", conn, BOD, PROD, LOTA, FEC);

    // ── S2: INSERT positivo con fecha MÁS temprana → fel baja (LEAST) ──
    const id2 = await insertK(LOTA, 50, "2026-05-15 08:00:00");
    await assertGroup("S2 INSERT +50 fecha más temprana (fel baja)", conn, BOD, PROD, LOTA, FEC);

    // ── S3: INSERT con delta<=0 en grupo existente → fel no cambia ──
    const id3 = await insertK(LOTA, -30, "2026-06-10 12:00:00");
    await assertGroup("S3 INSERT -30 en grupo existente (fel intacto)", conn, BOD, PROD, LOTA, FEC);

    // ── S4: INSERT con delta<=0 creando grupo nuevo → fel NULL ──
    await insertK(LOTN, -10, "2026-06-11 09:00:00");
    await assertGroup("S4 INSERT -10 grupo nuevo (fel NULL)", conn, BOD, PROD, LOTN, FEC);

    // ── S5: UPDATE positivo→negativo (mismo lote) → recomputo de fel ──
    // Nota: el SET usa placeholder `?` (nunca valores inline) para que el id_kardex
    // sea el único id ligado al WHERE.
    await updateK(id2, `delta_cantidad = ?`, [-50]);
    await assertGroup("S5 UPDATE +50→-50 (fel al siguiente positivo)", conn, BOD, PROD, LOTA, FEC);

    // ── S6: UPDATE negativo→positivo con fecha anterior → fel baja (LEAST) ──
    await updateK(id2, `delta_cantidad = ?, creado_en = ?`, [60, "2026-04-01 09:00:00"]);
    await assertGroup("S6 UPDATE -50→+60 fecha anterior (fel baja)", conn, BOD, PROD, LOTA, FEC);

    // ── S7: UPDATE que CAMBIA de lote (keys) con OLD.delta>0 ──
    await updateK(id1, `lote = ?`, [LOTB]);
    await assertGroup("S7 cambio de lote: grupo viejo recomputado", conn, BOD, PROD, LOTA, FEC);
    await assertGroup("S7 cambio de lote: grupo nuevo creado", conn, BOD, PROD, LOTB, FEC);

    // ── S8: DELETE del único positivo restante → fel NULL ──
    await deleteK(id2);
    await assertGroup("S8 DELETE único positivo (fel NULL)", conn, BOD, PROD, LOTA, FEC);

    // ── S8b: DELETE de la última fila del grupo → fila eliminada ──
    await deleteK(id3);
    await assertGroup("S8b DELETE última fila (fila eliminada)", conn, BOD, PROD, LOTA, FEC);

    // ── S9: DELETE de un positivo que NO es el mínimo → fel se mantiene ──
    const id5 = await insertK(LOTB, 20, "2026-07-01 11:00:00");
    await deleteK(id5);
    await assertGroup("S9 DELETE positivo no-mínimo (fel intacto)", conn, BOD, PROD, LOTB, FEC);

    // ── S10: DELETE con delta<=0 → stock ajusta, fel no cambia ──
    const id6 = await insertK(LOTB, -10, "2026-07-02 11:00:00");
    await deleteK(id6);
    await assertGroup("S10 DELETE -10 (fel intacto)", conn, BOD, PROD, LOTB, FEC);

    // ── Consistencia global de todos los grupos ──
    const { mism, exp, act } = await fullConsistency(conn);
    check("Consistencia global stock_actual vs kardex", mism === 0, `grupos kardex=${exp} | filas stock_actual=${act}`);

    // ── ROLLBACK + verificación de que la BD quedó intacta ──
    await conn.rollback();
    const [[countAfter]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);
    check("ROLLBACK: stock_actual vuelve a su tamaño original", Number(countAfter.c) === Number(countBefore.c),
      `antes=${countBefore.c} | después=${countAfter.c}`);
    const [[kt]] = await conn.query(`SELECT COUNT(*) AS c FROM kardex WHERE lote LIKE 'ZZTEST%'`);
    check("ROLLBACK: sin filas de prueba en kardex", Number(kt.c) === 0);
    const [[st]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual WHERE lote LIKE 'ZZTEST%'`);
    check("ROLLBACK: sin filas de prueba en stock_actual", Number(st.c) === 0);
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
