// ─────────────────────────────────────────────────────────────────────────────
// test_reconcile_stock.cjs
// Reconciliación de la tabla materializada `stock_actual` contra el agregado
// real de `kardex`. La tabla la mantienen los triggers trg_kardex_stock_ai/ad/au;
// este script detecta cualquier desviación (p.ej. inserciones hechas a mano en
// kardex, reversas mal aplicadas, o un bug de trigger) y opcionalmente la
// reconstruye desde cero.
//
// Uso:
//   node test_reconcile_stock.cjs            # asegura esquema, backfill si vacía y compara (exit 0 = OK)
//   node test_reconcile_stock.cjs --fix      # compara, reconstruye si difiere y re-verifica
//   node test_reconcile_stock.cjs --rebuild  # reconstruye SIEMPRE (ignora la comparación)
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv/config");
const mysql = require("mysql2/promise");

const FIX = process.argv.includes("--fix");
const REBUILD = process.argv.includes("--rebuild");

// La clave NULL-safe debe coincidir EXACTAMENTE con las columnas generadas de
// stock_actual (lote_key, fecha_key). NULL -> prefijo 'N', valor -> 'Y'.
// fecha_key es DATE con sentinela '1000-01-01' (MariaDB no permite DATE_FORMAT
// en columnas generadas); aquí se formatea a string para comparar consistente.
const KEY_EXPR =
  "CONCAT(IF(lote IS NULL,'N','Y'),COALESCE(lote,'')) AS lote_key, " +
  "IF(fecha_vencimiento IS NULL, '1000-01-01', DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d')) AS fecha_key";

// Normaliza fecha_entrada_lote a string comparable en SQL (igual que fecha_key):
// evita depender de cómo mysql2 serialice DATE (Date object vs string vs timezone).
const FEL_EXPR = "COALESCE(DATE_FORMAT(fecha_entrada_lote, '%Y-%m-%d'), '')";

const DDL_TABLE = `
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function ensureIndex(conn) {
  const [rows] = await conn.query(`
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND INDEX_NAME='ix_sa_base'
    GROUP BY INDEX_NAME`);
  if (!rows.length) {
    await conn.query(`ALTER TABLE stock_actual ADD INDEX ix_sa_base (id_bodega, id_producto, lote, fecha_vencimiento)`);
  }
}

// Añade la columna materializada fecha_entrada_lote si la tabla ya existía sin
// ella (CREATE TABLE IF NOT EXISTS no la añade a una tabla existente). Devuelve
// true si la columna es nueva (en ese caso el rebuild es obligatorio).
async function ensureColumn(conn) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND COLUMN_NAME='fecha_entrada_lote'`);
  if (Number(rows[0]?.c || 0) === 0) {
    await conn.query(`ALTER TABLE stock_actual ADD COLUMN fecha_entrada_lote DATE NULL AFTER stock`);
    return true;
  }
  return false;
}

// Alinea la collation de stock_actual.lote con la de kardex.lote (idempotente).
// Si difieren, cualquier `<=>` entre ambas columnas (triggers ad/au, reportes)
// lanza ER_CANT_AGGREGATE_2COLLATIONS. Mismo bloque que ensureStockActualTable
// en server.js.
async function ensureCollation(conn) {
  const [[kardexLote]] = await conn.query(`
    SELECT COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='kardex'
      AND COLUMN_NAME='lote'`);
  const [[stockLote]] = await conn.query(`
    SELECT COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='stock_actual'
      AND COLUMN_NAME='lote'`);
  const target = kardexLote?.COLLATION_NAME || "utf8mb4_unicode_ci";
  if (stockLote?.COLLATION_NAME && stockLote.COLLATION_NAME !== target) {
    await conn.query(`
      ALTER TABLE stock_actual
        MODIFY lote VARCHAR(60) CHARACTER SET utf8mb4 COLLATE ${target} NULL,
        MODIFY lote_key VARCHAR(61) CHARACTER SET utf8mb4 COLLATE ${target}
          GENERATED ALWAYS AS (CONCAT(IF(lote IS NULL, 'N', 'Y'), COALESCE(lote, ''))) STORED`);
    console.log(`→ stock_actual.lote alineada a collation ${target}`);
  }
}

// IMPORTANTE: este DDL debe mantenerse sincronizado con ensureStockActualTable()
// de server.js. Si se cambia la expresión de lote_key/fecha_key o los triggers,
// hay que cambiarlo en AMBOS lugares.
const TRIGGERS = [
  {
    name: "trg_kardex_stock_ai",
    sql: `CREATE TRIGGER trg_kardex_stock_ai
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
    END`,
  },
  {
    name: "trg_kardex_stock_ad",
    sql: `CREATE TRIGGER trg_kardex_stock_ad
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
    END`,
  },
  {
    name: "trg_kardex_stock_au",
    sql: `CREATE TRIGGER trg_kardex_stock_au
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
    END`,
  },
];

async function ensureTable(conn) {
  await conn.query(DDL_TABLE);
}

async function ensureTriggers(conn) {
  for (const t of TRIGGERS) {
    await conn.query(`DROP TRIGGER IF EXISTS ${t.name}`);
    await conn.query(t.sql);
  }
}

async function ensureViews(conn) {
  // CREATE OR REPLACE (no DROP) para no romper v_stock_disponible, que depende
  // de v_stock_por_lote.
  await conn.query(`
    CREATE OR REPLACE VIEW v_stock_por_lote AS
    SELECT id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote
    FROM stock_actual`);
  await conn.query(`
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
  await conn.query(`
    CREATE OR REPLACE VIEW v_stock_resumen AS
    SELECT id_bodega, id_producto, SUM(stock) AS stock
    FROM stock_actual
    GROUP BY id_bodega, id_producto`);
}

// Reconstruye stock_actual desde kardex bajo LOCK TABLES para que ninguna
// escritura concurrente quede fuera del agregado.
async function rebuild(conn) {
  await conn.query(`LOCK TABLES kardex WRITE, stock_actual WRITE`);
  try {
    await conn.query(`DELETE FROM stock_actual`);
    await conn.query(`
      INSERT INTO stock_actual (id_bodega, id_producto, lote, fecha_vencimiento, stock, fecha_entrada_lote)
      SELECT k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento, SUM(k.delta_cantidad),
             MIN(IF(k.delta_cantidad > 0, DATE(k.creado_en), NULL))
      FROM kardex k
      GROUP BY k.id_bodega, k.id_producto, k.lote, k.fecha_vencimiento`);
  } finally {
    await conn.query(`UNLOCK TABLES`).catch(() => {});
  }
}

// Devuelve { expected, actual, mismatches: [{ key, expected, actual }] }
async function compare(conn) {
  const [[{ c }]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);
  console.log(`stock_actual: ${c} filas`);

  const [expRows] = await conn.query(`
    SELECT id_bodega, id_producto, ${KEY_EXPR}, SUM(delta_cantidad) AS stock,
           COALESCE(DATE_FORMAT(MIN(IF(delta_cantidad > 0, DATE(creado_en), NULL)), '%Y-%m-%d'), '') AS fecha_entrada_lote
    FROM kardex
    GROUP BY id_bodega, id_producto, lote_key, fecha_key`);
  const [actRows] = await conn.query(`
    SELECT id_bodega, id_producto, lote_key,
           DATE_FORMAT(fecha_key, '%Y-%m-%d') AS fecha_key, stock, ${FEL_EXPR} AS fecha_entrada_lote
    FROM stock_actual`);

  const keyOf = (r) => `${r.id_bodega}|${r.id_producto}|${r.lote_key}|${r.fecha_key}`;
  const expMap = new Map(
    expRows.map((r) => [keyOf(r), { stock: Number(r.stock), fel: r.fecha_entrada_lote }])
  );
  const actMap = new Map(
    actRows.map((r) => [keyOf(r), { stock: Number(r.stock), fel: r.fecha_entrada_lote }])
  );

  const mismatches = [];
  for (const [k, v] of expMap) {
    if (!actMap.has(k)) {
      mismatches.push({ key: k, expected: v, actual: "AUSENTE" });
    } else if (Math.abs(actMap.get(k).stock - v.stock) > 1e-9 || actMap.get(k).fel !== v.fel) {
      mismatches.push({ key: k, expected: v, actual: actMap.get(k) });
    }
  }
  for (const [k, v] of actMap) {
    if (!expMap.has(k)) {
      mismatches.push({ key: k, expected: "AUSENTE", actual: v });
    }
  }
  return { expected: expMap.size, actual: actMap.size, mismatches };
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  try {
    console.log("→ Asegurando tabla stock_actual...");
    await ensureTable(conn);
    await ensureIndex(conn);
    const columnAdded = await ensureColumn(conn);
    await ensureCollation(conn);

    // Triggers ANTES del backfill (mismo orden que ensureStockActualTable en server.js):
    // si el servidor está vivo, ninguna escritura de kardex queda fuera del agregado.
    console.log("→ Asegurando triggers...");
    await ensureTriggers(conn);

    const [[{ c }]] = await conn.query(`SELECT COUNT(*) AS c FROM stock_actual`);
    if (REBUILD || Number(c) === 0 || columnAdded) {
      console.log("→ Backfill (tabla vacía o --rebuild)...");
      await rebuild(conn);
    }

    let { expected, actual, mismatches } = await compare(conn);
    if (mismatches.length > 0) {
      console.log(`\n❌ DESVIACIONES: ${mismatches.length}`);
      console.log(`   esperados: ${expected} | reales: ${actual}`);
      for (const m of mismatches.slice(0, 10)) {
        console.log(`   - ${m.key}: esperado=${m.expected} actual=${m.actual}`);
      }
      if (mismatches.length > 10) console.log(`   ... y ${mismatches.length - 10} más`);
      if (FIX || REBUILD) {
        console.log("\n→ Reconstruyendo y re-verificando...");
        await rebuild(conn);
        ({ expected, actual, mismatches } = await compare(conn));
        if (mismatches.length === 0) {
          console.log("✅ Reconciliado correctamente.");
          await ensureViews(conn);
          console.log("✅ Vistas re-aseguradas.");
          process.exit(0);
        }
        console.log("❌ Siguen habiendo desviaciones tras el rebuild.");
      } else {
        console.log("\n⚠️ Las vistas NO se tocaron (modo comparación). Revisa o usa --fix.");
      }
      process.exit(1);
    }
    console.log(`\n✅ OK: stock_actual coincide con kardex (${expected} grupos).`);
    console.log("→ Asegurando vistas...");
    await ensureViews(conn);
    console.log("✅ Vistas listas.");
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e?.code || "", e?.message || e);
    process.exit(2);
  } finally {
    await conn.end();
  }
}

main();
