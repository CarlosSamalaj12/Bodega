import { pool } from './db.js';

async function main() {
  const sku = 'SHE-FRE';
  
  // Find the product
  const [prod] = await pool.query("SELECT id_producto, nombre_producto, sku FROM productos WHERE sku = ?", [sku]);
  if (prod.length === 0) {
    console.log("Producto no encontrado con SKU:", sku);
    process.exit(0);
  }
  const id_producto = prod[0].id_producto;
  console.log("Producto:", JSON.stringify(prod[0]));

  // Get all kardex entries for this product
  const [kardex] = await pool.query(`
    SELECT k.id_kardex, k.id_bodega, k.delta_cantidad, k.lote, k.creado_en, 
           me.id_movimiento, me.tipo_movimiento, me.estado, me.id_bodega_origen, me.id_bodega_destino,
           md.cantidad AS detalle_cantidad
    FROM kardex k
    JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
    LEFT JOIN movimiento_detalle md ON md.id_detalle = k.id_detalle
    WHERE k.id_producto = ?
    ORDER BY k.creado_en, k.id_kardex
  `, [id_producto]);
  
  console.log("\n=== TODOS LOS KARDEX ===");
  console.log("Total rows:", kardex.length);
  
  // Group by bodega
  const byBodega = {};
  for (const row of kardex) {
    if (!byBodega[row.id_bodega]) byBodega[row.id_bodega] = [];
    byBodega[row.id_bodega].push(row);
  }
  
  for (const [bodega, rows] of Object.entries(byBodega)) {
    console.log(`\n--- BODEGA ${bodega} (${rows.length} registros) ---`);
    
    let total_entradas = 0, total_salidas = 0;
    let borrador_entradas = 0, borrador_salidas = 0;
    let confirmado_entradas = 0, confirmado_salidas = 0;
    
    for (const r of rows) {
      if (r.delta_cantidad > 0) {
        total_entradas += Number(r.delta_cantidad);
        if (r.estado === 'BORRADOR') borrador_entradas += Number(r.delta_cantidad);
        else confirmado_entradas += Number(r.delta_cantidad);
      } else {
        total_salidas += Math.abs(Number(r.delta_cantidad));
        if (r.estado === 'BORRADOR') borrador_salidas += Math.abs(Number(r.delta_cantidad));
        else confirmado_salidas += Math.abs(Number(r.delta_cantidad));
      }
    }
    
    console.log(`  Entradas totales: ${total_entradas} (BORRADOR: ${borrador_entradas}, CONFIRMADO: ${confirmado_entradas})`);
    console.log(`  Salidas totales: ${total_salidas} (BORRADOR: ${borrador_salidas}, CONFIRMADO: ${confirmado_salidas})`);
    console.log(`  Stock actual (sum): ${total_entradas - total_salidas}`);
    
    // Show individual entries
    for (const r of rows) {
      console.log(`  [${r.id_kardex}] ${r.creado_en} | bod:${r.id_bodega} | delta:${r.delta_cantidad} | ${r.tipo_movimiento} | ${r.estado} | lote:${r.lote || '-'} | mov:${r.id_movimiento} | det:${r.detalle_cantidad || '-'}`);
    }

    // Check for duplicate id_movimiento + id_detalle + id_bodega + id_producto
    const seen = {};
    for (const r of rows) {
      const key = `${r.id_movimiento}-${r.id_bodega}-${r.id_producto}`;
      if (!seen[key]) seen[key] = [];
      seen[key].push(r);
    }
    for (const [key, vals] of Object.entries(seen)) {
      if (vals.length > 1) {
        console.log(`  *** DUPLICADO: ${key} aparece ${vals.length} veces`);
      }
    }
  }

  // Run the corte-diario query for this product to see what it returns
  const [corte] = await pool.query(`
    SELECT p.id_producto, p.nombre_producto, p.sku,
      COALESCE(SUM(CASE WHEN k.creado_en < CURDATE() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_ayer,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad > 0 THEN k.delta_cantidad ELSE 0 END), 0) AS entradas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en >= CURDATE() AND k.delta_cantidad < 0 THEN ABS(k.delta_cantidad) ELSE 0 END), 0) AS salidas_hoy,
      COALESCE(SUM(CASE WHEN k.creado_en <= NOW() THEN k.delta_cantidad ELSE 0 END), 0) AS existencia_actual
    FROM productos p
    LEFT JOIN kardex k ON k.id_producto = p.id_producto
    WHERE p.sku = ?
    GROUP BY p.id_producto, p.nombre_producto, p.sku
  `, [sku]);
  
  console.log("\n=== CORTE-DIARIO (SIN FILTRO BODEGA) ===");
  console.log(JSON.stringify(corte, null, 2));

  process.exit(0);
}
main();
