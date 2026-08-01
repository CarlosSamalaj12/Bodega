// Benchmark comparativo: /api/dashboard/detalle (kind=vigentes)
// Query ORIGINAL (subconsultas correlacionadas) vs REFACTORIZADA (ROW_NUMBER)
// Uso: node test_bench_detalle.cjs
require('dotenv/config');
const mysql = require('mysql2/promise');

// ── Subconsulta preferida (sin AJUSTE / no_contar_dashboard=0) ──
const PREF_SQL = `(SELECT k1.costo_unitario
      FROM kardex k1
      LEFT JOIN movimiento_encabezado me1 ON me1.id_movimiento=k1.id_movimiento
      WHERE k1.id_bodega=v.id_bodega
        AND k1.id_producto=v.id_producto
        AND k1.delta_cantidad > 0
        AND (me1.id_movimiento IS NULL OR me1.tipo_movimiento <> 'AJUSTE')
        AND COALESCE(me1.no_contar_dashboard, 0) = 0
      ORDER BY k1.creado_en DESC, k1.id_kardex DESC
      LIMIT 1)`;
// ── Subconsulta fallback (cualquier entrada) ──
const FB_SQL = `(SELECT k2.costo_unitario
      FROM kardex k2
      WHERE k2.id_bodega=v.id_bodega
        AND k2.id_producto=v.id_producto
        AND k2.delta_cantidad > 0
      ORDER BY k2.creado_en DESC, k2.id_kardex DESC
      LIMIT 1)`;

const COST_COALESCE_OLD = `COALESCE(${PREF_SQL}, ${FB_SQL}, 0)`;

// ── QUERY ORIGINAL (antes del refactor) ──
const OLD_SQL = `SELECT v.id_bodega,
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
        ${COST_COALESCE_OLD} AS costo_unitario,
        (v.stock * ${COST_COALESCE_OLD}) AS total_linea
 FROM v_stock_por_lote v
 JOIN bodegas b ON b.id_bodega=v.id_bodega
 JOIN productos p ON p.id_producto=v.id_producto
 WHERE v.stock > 0
   AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
   AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
 ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
 LIMIT 300`;

// ── QUERY REFACTORIZADA (ROW_NUMBER) ──
const NEW_SQL = `SELECT v.id_bodega,
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
        COALESCE(pref.costo_pref, fb.costo_fallback, 0) AS costo_unitario,
        (v.stock * COALESCE(pref.costo_pref, fb.costo_fallback, 0)) AS total_linea
 FROM v_stock_por_lote v
 JOIN bodegas b ON b.id_bodega=v.id_bodega
 JOIN productos p ON p.id_producto=v.id_producto
 LEFT JOIN (
   SELECT k.id_bodega, k.id_producto, k.costo_unitario AS costo_pref,
          ROW_NUMBER() OVER (
            PARTITION BY k.id_bodega, k.id_producto
            ORDER BY k.creado_en DESC, k.id_kardex DESC
          ) AS rn
   FROM kardex k
   LEFT JOIN movimiento_encabezado me ON me.id_movimiento=k.id_movimiento
   WHERE k.delta_cantidad > 0
     AND (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
     AND (me.id_movimiento IS NULL OR me.tipo_movimiento <> 'AJUSTE')
     AND COALESCE(me.no_contar_dashboard, 0) = 0
 ) pref ON pref.id_bodega=v.id_bodega
       AND pref.id_producto=v.id_producto
       AND pref.rn=1
 LEFT JOIN (
   SELECT k.id_bodega, k.id_producto, k.costo_unitario AS costo_fallback,
          ROW_NUMBER() OVER (
            PARTITION BY k.id_bodega, k.id_producto
            ORDER BY k.creado_en DESC, k.id_kardex DESC
          ) AS rn
   FROM kardex k
   WHERE k.delta_cantidad > 0
     AND (:id_bodega IS NULL OR k.id_bodega=:id_bodega)
 ) fb ON fb.id_bodega=v.id_bodega
      AND fb.id_producto=v.id_producto
      AND fb.rn=1
 WHERE v.stock > 0
   AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
   AND (:id_bodega IS NULL OR v.id_bodega=:id_bodega)
 ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
 LIMIT 300`;

const ITERATIONS = 9;
const WARMUP = 3;

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function timeQuery(conn, sql, params) {
  const t0 = process.hrtime.bigint();
  await conn.query(sql, params);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6; // ms
}

function fmt(ms) {
  return ms.toFixed(2) + ' ms';
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  const scopes = [null, 1]; // null = todas las bodegas, 1 = bodega específica
  const scopeLabels = { null: 'ALL (todas las bodegas)', 1: 'Bodega 1' };

  // Verificación de integridad: mismo conteo, mismo SUM(total_linea) y mismo
  // SUM(costo_unitario) para descartar errores compensados entre filas.
  console.log('=== Verificación de equivalencia ===');
  for (const id of scopes) {
    const [[o]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_linea),0) AS tot, COALESCE(SUM(costo_unitario),0) AS cost FROM (${OLD_SQL}) t`,
      { id_bodega: id }
    );
    const [[n]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_linea),0) AS tot, COALESCE(SUM(costo_unitario),0) AS cost FROM (${NEW_SQL}) t`,
      { id_bodega: id }
    );
    const sameN = Number(o.n) === Number(n.n);
    const sameTot = Math.abs(Number(o.tot) - Number(n.tot)) < 0.01;
    const sameCost = Math.abs(Number(o.cost) - Number(n.cost)) < 0.01;
    console.log(
      `  ${scopeLabels[id]}: filas old=${o.n} new=${n.n} ${sameN ? '✅' : '❌'} | Σtotal_linea old=${Number(o.tot).toFixed(2)} new=${Number(n.tot).toFixed(2)} ${sameTot ? '✅' : '❌'} | Σcosto_unit old=${Number(o.cost).toFixed(4)} new=${Number(n.cost).toFixed(4)} ${sameCost ? '✅' : '❌'}`
    );
  }

  console.log(`\nNota: se mide el tiempo de ejecución SQL (sin auth ni serialización JSON, constantes en ambas).`);

  console.log(`\n=== Benchmark (${ITERATIONS} corridas, ${WARMUP} warmup, LIMIT 300) ===`);
  for (const id of scopes) {
    const params = { id_bodega: id };
    // Alternar orden para no favorecer a ninguna (buffer pool ya caliente)
    const results = [];
    for (let i = 0; i < ITERATIONS; i++) {
      if (i % 2 === 0) {
        results.push(await timeQuery(conn, OLD_SQL, params));
        results.push(await timeQuery(conn, NEW_SQL, params));
      } else {
        results.push(await timeQuery(conn, NEW_SQL, params));
        results.push(await timeQuery(conn, OLD_SQL, params));
      }
    }
    const oldSamples = results.filter((_, i) => i % 2 === 0);
    const newSamples = results.filter((_, i) => i % 2 === 1);

    const o = {
      min: Math.min(...oldSamples),
      median: median(oldSamples),
      avg: oldSamples.reduce((a, b) => a + b, 0) / oldSamples.length,
      max: Math.max(...oldSamples),
    };
    const n = {
      min: Math.min(...newSamples),
      median: median(newSamples),
      avg: newSamples.reduce((a, b) => a + b, 0) / newSamples.length,
      max: Math.max(...newSamples),
    };
    const pct = ((1 - n.median / Math.max(o.median, 0.0001)) * 100).toFixed(1);

    console.log(`\n── ${scopeLabels[id]} ──`);
    console.log('  ORIGINAL (correlacionadas):');
    console.log(`    min=${fmt(o.min)}  mediana=${fmt(o.median)}  promedio=${fmt(o.avg)}  max=${fmt(o.max)}`);
    console.log('  REFACTORIZADA (ROW_NUMBER):');
    console.log(`    min=${fmt(n.min)}  mediana=${fmt(n.median)}  promedio=${fmt(n.avg)}  max=${fmt(n.max)}`);
    console.log(`  ➜ Mejora en mediana: ${pct}% ${n.median <= o.median ? '🚀' : '⚠️'}`);
  }

  await conn.end();
})().catch((e) => {
  console.error('ERR:', e.code, e.message);
  process.exit(1);
});
