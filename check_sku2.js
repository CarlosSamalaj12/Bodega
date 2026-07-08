import { pool } from './db.js';

async function main() {
  const id_producto = 1816;
  const conn = await pool.getConnection();
  
  try {
    console.log("Producto 1816 - SHECAS FRESA/QUESO");
    
    // Get all kardex entries grouped by bodega
    const [rows] = await conn.query(`
      SELECT k.id_kardex, k.id_bodega, k.id_movimiento, k.delta_cantidad, 
             k.lote, k.creado_en,
             me.tipo_movimiento, me.estado
      FROM kardex k
      JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
      WHERE k.id_producto = ?
      ORDER BY k.id_bodega, k.creado_en, k.id_kardex
    `, [id_producto]);
    
    console.log("\nTotal kardex rows:", rows.length);
    
    const byBodega = {};
    for (const row of rows) {
      const b = Number(row.id_bodega);
      if (!byBodega[b]) byBodega[b] = [];
      byBodega[b].push(row);
    }
    
    for (const [bodega, krows] of Object.entries(byBodega)) {
      console.log(`\n========== BODEGA ${bodega} (${krows.length} reg) ==========`);
      let total = 0, ent = 0, sal = 0;
      
      for (const r of krows) {
        const d = Number(r.delta_cantidad);
        total += d;
        if (d > 0) ent += d;
        else sal += Math.abs(d);
        
        const fecha = r.creado_en ? new Date(r.creado_en).toISOString().slice(0, 16).replace('T', ' ') : '-';
        console.log(`  [${String(r.id_kardex).padStart(5)}] ${fecha} | delta:${String(d).padStart(8)} | ${(r.tipo_movimiento || '').padStart(13)} | ${(r.estado || '').padStart(10)} | lote:${((r.lote || '-')+'').padStart(20)} | mov:${String(r.id_movimiento).padStart(5)}`);
      }
      
      console.log(`  --- TOTALES: entradas=${ent}, salidas=${sal}, stock=${total} ---`);
      
      // Run the corte-diario query
      const [corte] = await conn.query(`
        SELECT
          COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
          COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
          COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
          COALESCE(SUM(CASE WHEN k.creado_en <= NOW() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual
        FROM kardex k
        JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
        WHERE k.id_producto = ? AND k.id_bodega = ?
      `, [id_producto, Number(bodega)]);
      
      console.log("  CORTE-DIARIO:", JSON.stringify(corte[0]));
      
      const c = corte[0];
      const expected = Number(c.existencia_ayer) + Number(c.entradas_hoy) - Number(c.salidas_hoy);
      console.log(`  VERIF: ${c.existencia_ayer} + ${c.entradas_hoy} - ${c.salidas_hoy} = ${expected} (actual=${c.existencia_actual}) ${expected === Number(c.existencia_actual) ? 'OK' : 'DIF!'}`);
    }
    
  } finally {
    conn.release();
  }
  
  process.exit(0);
}
main();
