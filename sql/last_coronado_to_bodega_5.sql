-- ============================================================
-- Última vez que se dio LECHE ENTERA CORONADO a bodega 5
-- ============================================================
-- Producto: LECHE ENTERA CORONADO - LITRO (id 525)
-- Destino:  Bodega Nilas Bakery (id 5)
--
-- Considera DOS fuentes de movimientos "hacia" B5:
--   1) TRANSFERENCIA con id_bodega_destino = 5
--   2) SALIDA / DESPACHO de pedido con destino B5 (en kardex,
--      para esos el id_bodega del kardex es la surtidora, pero
--      la bodega destino está en movimiento_encabezado)
-- ============================================================

-- 0) Sanity check: que existan producto y bodega
SELECT id_producto, nombre_producto, sku
FROM productos
WHERE id_producto = 525;
-- Si no devuelve 1 fila, buscá por nombre/SKU y reemplazá el id.

SELECT id_bodega, nombre_bodega, tipo_bodega
FROM bodegas
WHERE id_bodega = 5;

-- 1) RESUMEN: última fecha y total acumulado
SELECT
  MAX(me.creado_en) AS ultima_fecha,
  DATEDIFF(NOW(), MAX(me.creado_en)) AS dias_desde_ultimo,
  COUNT(*) AS total_movimientos_hacia_b5,
  SUM(ABS(k.delta_cantidad)) AS total_unidades_recibidas
FROM kardex k
JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
WHERE k.id_producto = 525
  AND k.id_bodega = 5
  AND k.delta_cantidad > 0
  AND me.estado <> 'ANULADO'
  AND me.tipo_movimiento IN ('TRANSFERENCIA', 'SALIDA');

-- 2) ÚLTIMOS 20 movimientos hacia B5
SELECT
  me.id_movimiento,
  me.tipo_movimiento,
  me.creado_en,
  DATE(me.creado_en) AS fecha,
  TIME(me.creado_en) AS hora,
  me.estado,
  bo.nombre_bodega AS bodega_origen,
  bd.nombre_bodega AS bodega_destino,
  k.id_bodega AS kardex_bodega,
  ABS(k.delta_cantidad) AS cantidad,
  k.lote,
  k.costo_unitario,
  u.nombre_completo AS usuario,
  pm.id_pedido,
  pm.solicitante_pedido
FROM kardex k
JOIN movimiento_encabezado me ON me.id_movimiento = k.id_movimiento
LEFT JOIN bodegas bo ON bo.id_bodega = me.id_bodega_origen
LEFT JOIN bodegas bd ON bd.id_bodega = me.id_bodega_destino
LEFT JOIN usuarios u ON u.id_usuario = me.creado_por
LEFT JOIN (
  SELECT pmv.id_detalle,
         MIN(pd.id_pedido) AS id_pedido,
         MIN(us.nombre_completo) AS solicitante_pedido
  FROM pedido_movimiento_vinculo pmv
  JOIN pedido_detalle pd ON pd.id_pedido_detalle = pmv.id_pedido_detalle
  JOIN pedido_encabezado pe ON pe.id_pedido = pd.id_pedido
  LEFT JOIN usuarios us ON us.id_usuario = pe.id_usuario_solicita
  GROUP BY pmv.id_detalle
) pm ON pm.id_detalle = k.id_detalle
WHERE k.id_producto = 525
  AND k.id_bodega = 5
  AND k.delta_cantidad > 0
  AND me.estado <> 'ANULADO'
  AND me.tipo_movimiento IN ('TRANSFERENCIA', 'SALIDA')
ORDER BY me.creado_en DESC
LIMIT 20;

-- 3) Stock actual en bodega 5 (cuánto le queda)
SELECT
  vs.stock AS stock_actual_b5,
  b.nombre_bodega,
  (SELECT MAX(me.creado_en) FROM kardex k2
   JOIN movimiento_encabezado me ON me.id_movimiento = k2.id_movimiento
   WHERE k2.id_producto = 525 AND k2.id_bodega = 5 AND k2.delta_cantidad <> 0
     AND me.estado <> 'ANULADO'
  ) AS fecha_ultimo_cualquier_movimiento
FROM v_stock_resumen vs
JOIN bodegas b ON b.id_bodega = vs.id_bodega
WHERE vs.id_producto = 525 AND vs.id_bodega = 5;
