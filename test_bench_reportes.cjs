// ─────────────────────────────────────────────────────────────────────────────
// test_bench_reportes.cjs
// Benchmark comparativo de los reportes de existencias y alertas con datos reales:
//   ANTES  (reportes con el derived table `e` que agregaba kardex por request:
//           MIN(DATE(creado_en)) WHERE delta_cantidad > 0 GROUP BY bodega,
//           producto, lote, fecha_vencimiento — el LEFT JOIN sobre ~72k filas)
//   DESPUÉS(reportes que leen v.fecha_entrada_lote de la tabla materializada
//           stock_actual, mantenida por triggers)
//
// La BD ya tiene las vistas sobre stock_actual (Fase 4), por eso el lado ANTES
// se reconstruye inline con el LEFT JOIN del derived table original, que es
// exactamente lo que hacían los reportes antes de materializar la columna.
//
// Cubre:
//   1. GET /api/reportes/existencias       (reporte principal, con costo por
//                                           fila en subconsultas k2/k3)
//   2. GET /api/reportes/existencias/alertas (próximos a vencer / regla de vida)
//   Ambas variantes: Bodega 1 y todas las bodegas (id_bodega NULL).
//
// Uso: node test_bench_reportes.cjs
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv/config");
const mysql = require("mysql2/promise");

// Derived table ORIGINAL (antes de materializar fecha_entrada_lote): agrega
// TODO el kardex (filas con delta>0) agrupando por bodega+producto+lote+fecha.
// Derived table ORIGINAL (antes de materializar fecha_entrada_lote): agrega
// TODO el kardex (filas con delta>0) agrupando por bodega+producto+lote+fecha.
// Nota: stock_actual está alineada a la collation de kardex (utf8mb4_unicode_ci)
// por ensureCollation, así que el <=> del escenario ANTES (reconstruido) es
// ejecutable sin forzar COLLATE.
const E_DERIVED = `
  LEFT JOIN (
    SELECT id_bodega, id_producto, lote, fecha_vencimiento,
           MIN(DATE(creado_en)) AS fecha_entrada_lote
    FROM kardex
    WHERE delta_cantidad > 0
    GROUP BY id_bodega, id_producto, lote, fecha_vencimiento
  ) e ON e.id_bodega=v.id_bodega
      AND e.id_producto=v.id_producto
      AND (e.lote <=> v.lote)
      AND (e.fecha_vencimiento <=> v.fecha_vencimiento)
`;

// Subconsultas de costo del reporte 1 (costo_unitario_ref y total_linea), tal cual
// están en server.js (GET /api/reportes/existencias). Se incluyen en AMBOS lados
// para que el benchmark sea fiel al endpoint real.
const COST_SUBQUERIES = `
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
`;

// SELECT compartido del reporte 1 (existencias). {fel} se sustituye por
// e.fecha_entrada_lote (ANTES) o v.fecha_entrada_lote (DESPUÉS). Incluye las
// subconsultas de costo k2/k3 para fidelidad con el endpoint real.
const REPORT1_SELECT = (fel) => `
  SELECT v.id_bodega,
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
         CASE WHEN v.fecha_vencimiento IS NULL THEN NULL
              ELSE DATEDIFF(v.fecha_vencimiento, CURDATE()) END AS dias_para_vencer,
         rs.max_dias_vida,
         rs.dias_alerta_antes,
         ${fel} AS fecha_entrada_lote,
         CASE WHEN ${fel} IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), ${fel}) END AS dias_en_bodega,
         CASE WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR ${fel} IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), ${fel}) END AS dias_restantes_regla,
         ${COST_SUBQUERIES}
  FROM v_stock_por_lote v
  JOIN bodegas b ON b.id_bodega=v.id_bodega
  JOIN productos p ON p.id_producto=v.id_producto
  LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
  LEFT JOIN limites_producto_bodega lpb
         ON lpb.id_bodega=v.id_bodega AND lpb.id_producto=v.id_producto AND lpb.activo=1
  LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
`;

// SELECT compartido del reporte 2 (alertas).
const REPORT2_SELECT = (fel) => `
  SELECT v.id_bodega,
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
         ${fel} AS fecha_entrada_lote,
         CASE WHEN ${fel} IS NULL THEN NULL
              ELSE DATEDIFF(CURDATE(), ${fel}) END AS dias_en_bodega,
         CASE WHEN COALESCE(rs.max_dias_vida,0) <= 0 OR ${fel} IS NULL THEN NULL
              ELSE rs.max_dias_vida - DATEDIFF(CURDATE(), ${fel}) END AS dias_restantes_regla
  FROM v_stock_por_lote v
  JOIN bodegas b ON b.id_bodega=v.id_bodega
  JOIN productos p ON p.id_producto=v.id_producto
  LEFT JOIN subcategorias sc ON sc.id_subcategoria=p.id_subcategoria
  LEFT JOIN reglas_subcategoria rs ON rs.id_subcategoria=p.id_subcategoria AND rs.activo=1
`;

// ── Casos ANTES/DESPUÉS ──
// Params posicionales (mysql2 sin namedPlaceholders).
const CASES = [
  {
    label: "Reporte existencias (Bodega 1)",
    base: (fel, ejoin) =>
      `${REPORT1_SELECT(fel)} ${ejoin}
       WHERE v.stock > 0
         AND (? IS NULL OR v.id_bodega=?)`,
    orderBy: `ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC,
              (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
              LIMIT 500 OFFSET 0`,
    params: () => [1, 1],
  },
  {
    label: "Reporte existencias (TODAS)",
    base: (fel, ejoin) =>
      `${REPORT1_SELECT(fel)} ${ejoin}
       WHERE v.stock > 0
         AND (? IS NULL OR v.id_bodega=?)`,
    orderBy: `ORDER BY b.nombre_bodega ASC, p.nombre_producto ASC,
              (v.fecha_vencimiento IS NULL), v.fecha_vencimiento ASC
              LIMIT 500 OFFSET 0`,
    params: () => [null, null],
  },
  {
    label: "Reporte alertas (Bodega 1, days=15)",
    base: (fel, ejoin) =>
      `${REPORT2_SELECT(fel)} ${ejoin}
       WHERE v.stock > 0
         AND (
           (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) <= ?)
           OR (
             COALESCE(rs.max_dias_vida,0) > 0
             AND ${fel} IS NOT NULL
             AND (rs.max_dias_vida - DATEDIFF(CURDATE(), ${fel})) <= GREATEST(COALESCE(rs.dias_alerta_antes,0),0)
           )
         )
         AND (? IS NULL OR v.id_bodega=?)`,
    orderBy: `ORDER BY DATEDIFF(v.fecha_vencimiento, CURDATE()) ASC,
              b.nombre_bodega ASC, p.nombre_producto ASC
              LIMIT 500`,
    params: () => [15, 1, 1],
  },
  {
    label: "Reporte alertas (TODAS, days=15)",
    base: (fel, ejoin) =>
      `${REPORT2_SELECT(fel)} ${ejoin}
       WHERE v.stock > 0
         AND (
           (v.fecha_vencimiento IS NOT NULL AND DATEDIFF(v.fecha_vencimiento, CURDATE()) <= ?)
           OR (
             COALESCE(rs.max_dias_vida,0) > 0
             AND ${fel} IS NOT NULL
             AND (rs.max_dias_vida - DATEDIFF(CURDATE(), ${fel})) <= GREATEST(COALESCE(rs.dias_alerta_antes,0),0)
           )
         )
         AND (? IS NULL OR v.id_bodega=?)`,
    orderBy: `ORDER BY DATEDIFF(v.fecha_vencimiento, CURDATE()) ASC,
              b.nombre_bodega ASC, p.nombre_producto ASC
              LIMIT 500`,
    params: () => [15, null, null],
  },
];

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
  let eqFailures = 0;
  for (const c of CASES) {
    const oldSql = c.base("e.fecha_entrada_lote", E_DERIVED);
    const newSql = c.base("v.fecha_entrada_lote", "");
    const params = c.params();
    const [[o]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(stock),0) AS tot FROM (${oldSql}) t`,
      params
    );
    const [[n]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(stock),0) AS tot FROM (${newSql}) t`,
      params
    );
    const sameN = Number(o.n) === Number(n.n);
    const sameTot = Math.abs(Number(o.tot) - Number(n.tot)) < 0.01;
    const ok = sameN && sameTot;
    if (!ok) eqFailures++;
    console.log(
      `  ${c.label}: filas old=${o.n} new=${n.n} ${sameN ? "✅" : "❌"} | Σstock old=${Number(o.tot).toFixed(2)} new=${Number(n.tot).toFixed(2)} ${sameTot ? "✅" : "❌"} ${ok ? "" : "⚠️ EQUIVALENCIA ROTA"}`
    );
  }
  if (eqFailures > 0) {
    console.error(`\n❌ ${eqFailures} caso(s) con equivalencia rota: el CI debe fallar.`);
    await conn.end();
    process.exit(1);
  }

  console.log("\nNota: se mide el tiempo de ejecución SQL completo del reporte (SELECT con joins, subconsultas k2/k3 y ORDER BY + LIMIT, sin auth ni serialización JSON).");
  console.log(`\n=== Benchmark (${ITERATIONS} corridas, ${WARMUP} warmup) ===`);

  for (const c of CASES) {
    const oldSql = c.base("e.fecha_entrada_lote", E_DERIVED) + " " + c.orderBy;
    const newSql = c.base("v.fecha_entrada_lote", "") + " " + c.orderBy;
    const params = c.params();

    for (let i = 0; i < WARMUP; i++) {
      await timeQuery(conn, oldSql, params);
      await timeQuery(conn, newSql, params);
    }
    const results = [];
    for (let i = 0; i < ITERATIONS; i++) {
      if (i % 2 === 0) {
        results.push(await timeQuery(conn, oldSql, params));
        results.push(await timeQuery(conn, newSql, params));
      } else {
        results.push(await timeQuery(conn, newSql, params));
        results.push(await timeQuery(conn, oldSql, params));
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
    console.log("  ANTES (derived table sobre kardex):");
    console.log(`    min=${fmt(o.min)}  mediana=${fmt(o.median)}  promedio=${fmt(o.avg)}  max=${fmt(o.max)}`);
    console.log("  DESPUÉS (fecha_entrada_lote materializada):");
    console.log(`    min=${fmt(n.min)}  mediana=${fmt(n.median)}  promedio=${fmt(n.avg)}  max=${fmt(n.max)}`);
    console.log(`  ➜ Diferencia en mediana: ${pct}% ${n.median <= o.median ? "🚀 más rápido" : "⚠️ más lento"}`);
  }

  await conn.end();
})().catch((e) => {
  console.error("ERR:", e.code, e.message);
  process.exit(1);
});
