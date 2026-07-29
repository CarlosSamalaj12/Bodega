/**
 * Script para generar cierres diarios retroactivos (Julio 7 - Julio 28)
 * Ejecutar: node generar_cierres.js
 *
 * Requisitos:
 * - El servidor NO debe estar corriendo (para evitar conflictos de conexión)
 * - O puede correr con el servidor detenido
 */

import { pool } from './db.js';

// Helper: formatear fecha a YYYY-MM-DD
function ymd(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// Helper: sumar días a una fecha YYYY-MM-DD
function addDaysYmd(baseYmd, days) {
  const d = new Date(`${baseYmd}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula las filas de cierre para una bodega y fecha específicas.
 * Réplica exacta de buildDailyCloseRows() en server.js
 */
async function buildDailyCloseRows(conn, id_bodega, fecha_cierre) {
  const nextDay = addDaysYmd(fecha_cierre, 1);
  const [rows] = await conn.query(
    `SELECT p.id_producto,
            p.sku,
            p.nombre_producto,
            COALESCE(SUM(CASE WHEN k.creado_en < :fecha_cierre THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_inicial,
            COALESCE(SUM(CASE WHEN DATE(k.creado_en) = :fecha_cierre AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_dia,
            COALESCE(SUM(CASE WHEN DATE(k.creado_en) = :fecha_cierre AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_dia,
            COALESCE(SUM(CASE WHEN k.creado_en < :next_day THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_cierre
     FROM productos p
     LEFT JOIN kardex k
       ON k.id_producto = p.id_producto
      AND k.id_bodega = :id_bodega
     WHERE p.activo = 1
     GROUP BY p.id_producto, p.sku, p.nombre_producto
     HAVING ABS(existencia_inicial) > 0
         OR ABS(entradas_dia) > 0
         OR ABS(salidas_dia) > 0
         OR ABS(existencia_cierre) > 0
     ORDER BY p.nombre_producto ASC`,
    { id_bodega, fecha_cierre, next_day: nextDay }
  );
  return rows || [];
}

/**
 * Crea un cierre diario para una bodega y fecha específicas.
 * Réplica exacta de createDailyCloseForDate() en server.js
 */
async function createDailyCloseForDate(conn, { id_bodega, fecha_cierre, creado_por, origen = "MANUAL", observaciones = null }) {
  // Verificar si ya existe
  const [[already]] = await conn.query(
    `SELECT id_cierre, fecha_cierre
     FROM cierre_dia
     WHERE id_bodega=:id_bodega AND fecha_cierre=:fecha_cierre
     LIMIT 1`,
    { id_bodega, fecha_cierre }
  );
  if (already) {
    console.log(`  ⏭️  YA EXISTE cierre para bodega ${id_bodega}, fecha ${fecha_cierre} (id_cierre=${already.id_cierre})`);
    return {
      id_cierre: already.id_cierre,
      fecha_cierre: ymd(already.fecha_cierre),
      already_exists: true,
    };
  }

  // Calcular filas de cierre
  const rows = await buildDailyCloseRows(conn, id_bodega, fecha_cierre);
  const total_entradas = rows.reduce((acc, r) => acc + Number(r.entradas_dia || 0), 0);
  const total_salidas = rows.reduce((acc, r) => acc + Number(r.salidas_dia || 0), 0);
  const total_existencia_cierre = rows.reduce((acc, r) => acc + Number(r.existencia_cierre || 0), 0);

  // Insertar encabezado
  const [ins] = await conn.query(
    `INSERT INTO cierre_dia
      (id_bodega, fecha_cierre, total_entradas, total_salidas, total_existencia_cierre, creado_por, origen, observaciones)
     VALUES
      (:id_bodega, :fecha_cierre, :total_entradas, :total_salidas, :total_existencia_cierre, :creado_por, :origen, :observaciones)`,
    {
      id_bodega,
      fecha_cierre,
      total_entradas,
      total_salidas,
      total_existencia_cierre,
      creado_por: creado_por || null,
      origen,
      observaciones: observaciones || null,
    }
  );
  const id_cierre = Number(ins.insertId || 0);

  // Insertar detalle por producto
  for (const r of rows) {
    await conn.query(
      `INSERT INTO cierre_dia_detalle
        (id_cierre, id_producto, sku, nombre_producto, existencia_inicial, entradas_dia, salidas_dia, existencia_cierre)
       VALUES
        (:id_cierre, :id_producto, :sku, :nombre_producto, :existencia_inicial, :entradas_dia, :salidas_dia, :existencia_cierre)`,
      {
        id_cierre,
        id_producto: r.id_producto,
        sku: r.sku || null,
        nombre_producto: r.nombre_producto || null,
        existencia_inicial: Number(r.existencia_inicial || 0),
        entradas_dia: Number(r.entradas_dia || 0),
        salidas_dia: Number(r.salidas_dia || 0),
        existencia_cierre: Number(r.existencia_cierre || 0),
      }
    );
  }

  return {
    id_cierre,
    fecha_cierre,
    already_exists: false,
    rows_count: rows.length,
    total_entradas,
    total_salidas,
    total_existencia_cierre,
  };
}

async function main() {
  const fechaInicio = '2026-07-07';
  const fechaFin = '2026-07-28';
  const creadoPor = 1; // Usuario admin/sistema (ajustar según sea necesario)
  const origen = 'MANUAL'; // O 'AUTO' si se prefiere

  console.log('============================================');
  console.log('🔄 GENERANDO CIERRES DIARIOS RETROACTIVOS');
  console.log(`   Desde: ${fechaInicio}`);
  console.log(`   Hasta: ${fechaFin}`);
  console.log(`   Creado por: usuario #${creadoPor}`);
  console.log('============================================\n');

  const conn = await pool.getConnection();
  try {
    // Obtener bodegas activas
    const [bodegas] = await conn.query(
      `SELECT id_bodega, nombre_bodega
       FROM bodegas
       WHERE activo = 1
       ORDER BY id_bodega ASC`
    );

    if (bodegas.length === 0) {
      console.log('❌ No se encontraron bodegas activas.');
      process.exit(1);
    }

    console.log(`📦 Bodegas activas encontradas: ${bodegas.length}`);
    for (const b of bodegas) {
      console.log(`   - #${b.id_bodega}: ${b.nombre_bodega}`);
    }
    console.log('');

    // Generar lista de fechas
    const fechas = [];
    let current = fechaInicio;
    while (current <= fechaFin) {
      fechas.push(current);
      current = addDaysYmd(current, 1);
    }
    console.log(`📅 Total de días a cerrar: ${fechas.length} (${fechaInicio} → ${fechaFin})\n`);

    let totalCreados = 0;
    let totalYaExistentes = 0;
    let totalErrores = 0;

    for (const bodega of bodegas) {
      const id_bodega = Number(bodega.id_bodega);
      console.log(`\n═══ BODEGA #${id_bodega}: ${bodega.nombre_bodega} ═══`);

      for (const fecha of fechas) {
        process.stdout.write(`   📆 ${fecha} ... `);
        try {
          const resultado = await createDailyCloseForDate(conn, {
            id_bodega,
            fecha_cierre: fecha,
            creado_por: creadoPor,
            origen,
            observaciones: `Generado retroactivamente por script (${fechaInicio} a ${fechaFin})`,
          });

          if (resultado.already_exists) {
            console.log(`⏭️  Ya existía (id=${resultado.id_cierre})`);
            totalYaExistentes++;
          } else {
            console.log(`✅ Creado (id=${resultado.id_cierre}, ${resultado.rows_count} productos, entradas=${resultado.total_entradas}, salidas=${resultado.total_salidas})`);
            totalCreados++;
          }
        } catch (err) {
          console.log(`❌ ERROR: ${err.message}`);
          totalErrores++;
        }
      }
    }

    console.log('\n============================================');
    console.log('📊 RESUMEN FINAL');
    console.log(`   ✅ Cierres creados:     ${totalCreados}`);
    console.log(`   ⏭️  Ya existían:         ${totalYaExistentes}`);
    console.log(`   ❌ Errores:             ${totalErrores}`);
    console.log(`   📦 Bodegas procesadas:  ${bodegas.length}`);
    console.log(`   📅 Días procesados:     ${fechas.length}`);
    console.log(`   🎯 Total ejecuciones:   ${bodegas.length * fechas.length}`);
    console.log('============================================');
  } catch (err) {
    console.error('\n❌ Error general:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
