// ─────────────────────────────────────────────────────────────────────────────
// test_bench_stock.cjs
// Benchmark comparativo de las consultas de stock con datos reales:
//   ANTES  (vistas originales que agregaban todo el kardex con GROUP BY)
//   DESPUÉS(vistas redefinidas que leen la tabla materializada stock_actual)
//
// Las vistas en la BD ya apuntan a stock_actual (Fase 4 aplicada), por eso el
// lado ANTES se reconstruye inline con el GROUP BY original sobre kardex, que es
// exactamente lo que hacían las vistas antes del cambio.
//
// Cubre:
//   1. v_stock_por_lote  (scan completo, todas las bodegas y una bodega)
//   2. v_stock_resumen   (resumen por bodega+producto)
//   3. GET /api/stock con includeLots=1 (detalle por lote, una bodega)
//   4. GET /api/stock con includeLots=0 (agregado por producto, una bodega)
//
// Uso: node test_bench_stock.cjs
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv/config");
const mysql = require("mysql2/promise");

// ── Definiciones ORIGINALES de las vistas (antes de la Fase 4) ──
const OLD_POR_LOTE_VIEW = `
  SELECT k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento,
         SUM(k.delta_cantidad) AS stock
  FROM kardex k
  GROUP BY k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento`;

const OLD_RESUMEN_VIEW = `
  SELECT k.id_bodega, k.id_producto, SUM(k.delta_cantidad) AS stock
  FROM kardex k
  GROUP BY k.id_bodega, k.id_producto`;

// ── Pares ANTES/DESPUÉS por caso ──
const CASES = [
  {
    label: "v_stock_por_lote (ALL)",
    old: `SELECT * FROM (${OLD_POR_LOTE_VIEW}) t`,
    new: `SELECT id_bodega, id_producto, lote, fecha_vencimiento, stock FROM stock_actual`,
    params: () => ({}),
  },
  {
    label: "v_stock_por_lote (Bodega 1)",
    old: `SELECT * FROM (${OLD_POR_LOTE_VIEW}) t WHERE id_bodega = ?`,
    new: `SELECT id_bodega, id_producto, lote, fecha_vencimiento, stock FROM stock_actual WHERE id_bodega = ?`,
    params: () => [1],
  },
  {
    label: "v_stock_resumen (ALL)",
    old: `SELECT * FROM (${OLD_RESUMEN_VIEW}) t`,
    new: `SELECT id_bodega, id_producto, SUM(stock) AS stock FROM stock_actual GROUP BY id_bodega, id_producto`,
    params: () => ({}),
  },
  {
    label: "v_stock_resumen (Bodega 1)",
    old: `SELECT * FROM (${OLD_RESUMEN_VIEW}) t WHERE id_bodega = ?`,
    new: `SELECT id_bodega, id_producto, SUM(stock) AS stock FROM stock_actual WHERE id_bodega = ? GROUP BY id_bodega, id_producto`,
    params: () => [1],
  },
];

// GET /api/stock includeLots=1 (onlyWithStock=1, notExpiredOnly=1 por defecto)
const STOCK_LOTS_OLD = `
  SELECT v.id_bodega, v.id_producto, p.nombre_producto, p.sku,
         v.lote, v.fecha_vencimiento, v.stock
  FROM (${OLD_POR_LOTE_VIEW}) v
  JOIN productos p ON p.id_producto = v.id_producto
  WHERE v.id_bodega = ?
    AND v.stock > 0
    AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
  ORDER BY p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC`;

const STOCK_LOTS_NEW = `
  SELECT v.id_bodega, v.id_producto, p.nombre_producto, p.sku,
         v.lote, v.fecha_vencimiento, v.stock
  FROM v_stock_por_lote v
  JOIN productos p ON p.id_producto = v.id_producto
  WHERE v.id_bodega = ?
    AND v.stock > 0
    AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
  ORDER BY p.nombre_producto ASC, (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC`;

// GET /api/stock includeLots=0 (agregado por producto)
const STOCK_AGG_OLD = `
  SELECT v.id_bodega, v.id_producto, p.nombre_producto, p.sku,
         SUM(v.stock) AS stock
  FROM (${OLD_POR_LOTE_VIEW}) v
  JOIN productos p ON p.id_producto = v.id_producto
  WHERE v.id_bodega = ?
    AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
  GROUP BY v.id_bodega, v.id_producto, p.nombre_producto, p.sku
  HAVING SUM(v.stock) > 0
  ORDER BY p.nombre_producto ASC`;

const STOCK_AGG_NEW = `
  SELECT v.id_bodega, v.id_producto, p.nombre_producto, p.sku,
         SUM(v.stock) AS stock
  FROM v_stock_por_lote v
  JOIN productos p ON p.id_producto = v.id_producto
  WHERE v.id_bodega = ?
    AND (v.fecha_vencimiento IS NULL OR v.fecha_vencimiento >= CURDATE())
  GROUP BY v.id_bodega, v.id_producto, p.nombre_producto, p.sku
  HAVING SUM(v.stock) > 0
  ORDER BY p.nombre_producto ASC`;

CASES.push(
  { label: "GET /api/stock includeLots=1 (Bodega 1)", old: STOCK_LOTS_OLD, new: STOCK_LOTS_NEW, params: () => [1] },
  { label: "GET /api/stock includeLots=1 (Bodega 5)", old: STOCK_LOTS_OLD, new: STOCK_LOTS_NEW, params: () => [5] },
  { label: "GET /api/stock includeLots=0 (Bodega 1)", old: STOCK_AGG_OLD, new: STOCK_AGG_NEW, params: () => [1] },
  { label: "GET /api/stock includeLots=0 (Bodega 5)", old: STOCK_AGG_OLD, new: STOCK_AGG_NEW, params: () => [5] }
);

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
  return ms.toFixed(2) + " ms";
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  console.log("=== Verificación de equivalencia (filas + Σstock) ===");
  for (const c of CASES) {
    const params = c.params();
    const [[o]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(stock),0) AS tot FROM (${c.old}) t`,
      params
    );
    const [[n]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(stock),0) AS tot FROM (${c.new}) t`,
      params
    );
    const sameN = Number(o.n) === Number(n.n);
    const sameTot = Math.abs(Number(o.tot) - Number(n.tot)) < 0.01;
    console.log(
      `  ${c.label}: filas old=${o.n} new=${n.n} ${sameN ? "✅" : "❌"} | Σstock old=${Number(o.tot).toFixed(2)} new=${Number(n.tot).toFixed(2)} ${sameTot ? "✅" : "❌"}`
    );
  }

  console.log("\nNota: se mide el tiempo de ejecución SQL (sin auth ni serialización JSON, constante en ambas).");
  console.log(`\n=== Benchmark (${ITERATIONS} corridas, ${WARMUP} warmup) ===`);

  for (const c of CASES) {
    const params = c.params();
    for (let i = 0; i < WARMUP; i++) {
      await timeQuery(conn, c.old, params);
      await timeQuery(conn, c.new, params);
    }
    const results = [];
    for (let i = 0; i < ITERATIONS; i++) {
      if (i % 2 === 0) {
        results.push(await timeQuery(conn, c.old, params));
        results.push(await timeQuery(conn, c.new, params));
      } else {
        results.push(await timeQuery(conn, c.new, params));
        results.push(await timeQuery(conn, c.old, params));
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

    console.log(`\n── ${c.label} ──`);
    console.log("  ANTES (GROUP BY kardex):");
    console.log(`    min=${fmt(o.min)}  mediana=${fmt(o.median)}  promedio=${fmt(o.avg)}  max=${fmt(o.max)}`);
    console.log("  DESPUÉS (stock_actual):");
    console.log(`    min=${fmt(n.min)}  mediana=${fmt(n.median)}  promedio=${fmt(n.avg)}  max=${fmt(n.max)}`);
    console.log(`  ➜ Diferencia en mediana: ${pct}% ${n.median <= o.median ? "🚀 más rápido" : "⚠️ más lento"}`);
  }

  await conn.end();
})().catch((e) => {
  console.error("ERR:", e.code, e.message);
  process.exit(1);
});
