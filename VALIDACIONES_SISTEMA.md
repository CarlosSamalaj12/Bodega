# Validaciones Del Sistema

## Backend (`server.js`)

### 1) Auth
- Token obligatorio y válido en middleware `auth`.
- Login valida:
  - `username` y `password` obligatorios.
  - Usuario activo.
  - Contraseña correcta.

### 2) Productos
- Crear producto:
  - `nombre_producto` obligatorio.
  - `id_medida` obligatorio.
  - `id_categoria` obligatorio.
  - Duplicado controlado (`El producto ya existe`).
- Editar producto:
  - `id_producto` obligatorio.
  - `nombre_producto`, `id_medida`, `id_categoria` obligatorios.
  - `404` si no existe.
  - Duplicado controlado.

### 3) Categorias
- Crear:
  - `nombre_categoria` obligatorio.
  - Duplicado controlado.
- Editar:
  - `id_categoria` obligatorio.
  - Nombre no vacio si viene en payload.
  - Debe existir al menos un cambio.
  - `404` si no existe.
- Desactivar:
  - `id_categoria` obligatorio.
  - `404` si no existe.

### 4) Subcategorias
- Crear:
  - `id_categoria` obligatorio.
  - `nombre_subcategoria` obligatorio.
  - Duplicado por categoria controlado.
- Editar:
  - `id_subcategoria` obligatorio.
  - Si se envia `id_categoria`, debe ser valido.
  - Nombre no vacio si viene.
  - Debe existir al menos un cambio.
  - `404` si no existe.
- Desactivar:
  - `id_subcategoria` obligatorio.
  - `404` si no existe.

### 5) Limites Min/Max
- Crear:
  - `id_bodega` obligatorio.
  - `id_producto` obligatorio.
  - `minimo <= maximo` cuando `maximo > 0`.
- Editar:
  - Llaves (`id_bodega`, `id_producto`) obligatorias.
  - `minimo <= maximo` cuando `maximo > 0`.
  - `404` si no existe.
- Desactivar:
  - Llaves obligatorias.
  - `404` si no existe.

### 6) Reglas Subcategorias
- `id_subcategoria` obligatorio en crear/editar/desactivar.
- `404` si regla no existe.

### 7) Proveedores
- Crear:
  - `nombre_proveedor` obligatorio.
  - Duplicado controlado.
- Editar:
  - `id_proveedor` obligatorio.
  - Nombre no vacio si viene.
  - Debe existir al menos un cambio.
  - `404` si no existe.
- Desactivar:
  - `id_proveedor` obligatorio.
  - `404` si no existe.

### 8) Motivos De Movimiento
- Crear:
  - `nombre_motivo` obligatorio.
  - `tipo_movimiento` solo: `ENTRADA`, `SALIDA`, `TRANSFERENCIA`, `AJUSTE`.
  - Duplicado controlado.

### 9) Stock/Bodegas
- `GET /api/productos/:id/stock`:
  - `id_producto` obligatorio.
  - `id_bodega` obligatorio.
- `GET /api/bodegas/:id`:
  - `id_bodega` obligatorio.
  - `404` si no existe.





- Sí, pero no solo con “acepta transferencia = sí”.

- Hoy en tu código, para que esa bodega opere como quieres, necesitas esto:

-Configuración de bodega:
-tipo_bodega = RECEPTORA o modo_despacho_auto = TRANSFERENCIA
-puede_recibir = 1 (acepta transferencia)
-maneja_stock = 1 (para que realmente sume stock en transferencias)
-puede_despachar = 1 (si también quieres que haga salidas)
-Referencias: server.js (line 2488), server.js (line 2489), server.js (line 2490), server.js (line 2468).
-Permisos de menú/módulo del usuario:
-section.view.entradas, section.view.salidas, y reportes (section.view.r-*)
-Referencias: server.js (line 45), server.js (line 46), server.js (line 58), app.js (line 46), app.js (line 47), app.-js (line 59).
-Para ver reportes de existencias/entradas/salidas:
-Además del menú, el backend exige perfil con can_view_existencias (rol tipo BODEGUERO o REPORTE) y aplica alcance -por bodega.
-Referencias: server.js (line 504), server.js (line 512), server.js (line 513), server.js (line 1442), server.js -----(line 1851), server.js (line 1924).
-Resumen:
-acepta transferencia = sí ayuda a recibir, pero para manejar stock + entradas/salidas + reportes también debes -activar maneja_stock, puede_despachar (si aplica) y permisos/rol del usuario.

-Si quieres, te hago una regla en código para que al marcar “acepta transferencia” se autoconfigure todo eso -automáticamente.

### 10) Entradas
- `POST /api/entradas`:
  - `id_motivo` obligatorio.
  - `lines` obligatorio (array con elementos).
  - Usuario debe tener bodega.
  - Cada linea debe tener `id_producto`.
  - Lineas con cantidad `<= 0` se omiten.

### 11) Salidas
- `POST /api/salidas`:
  - `id_bodega_destino` obligatorio y valido.
  - `lines` obligatorio.
  - Usuario debe tener bodega origen.
  - Bodega origen debe poder despachar.
  - Bodega destino debe estar activa/disponible.
  - Debe existir motivo compatible con tipo de movimiento.
  - Valida stock suficiente por producto.
  - Bloquea salida de vencidos salvo motivos de merma/descomposicion.
  - Si no hay lineas validas a procesar: error.

### 12) Pedidos
- `POST /api/orders`:
  - Bodega solicitante y bodega surtidor obligatorias.
  - Usuario solicitante obligatorio.
  - `lines` obligatorio.
  - Lineas invalidas se omiten (`id_product` faltante o `qty_requested <= 0`).
- `GET /api/orders/:id/details`:
  - `404` si pedido no existe.

### 13) Despacho De Pedidos
- `POST /api/orders/:id/fulfill`:
  - `lines` obligatorio.
  - Pedido debe existir.
  - Pedido no puede estar `CANCELADO` o `COMPLETADO`.
  - Debe existir motivo para movimiento.
  - Si no se pudo despachar ninguna linea: error.

### 14) Reversiones
- `POST /api/orders/:id/revert`:
  - Solo revierte movimientos del mismo dia.
- `POST /api/orders/:id/revert-line`:
  - `id_pedido_detalle` obligatorio.
  - Solo revierte movimientos del mismo dia.

### 15) Usuarios Y Permisos
- Crear usuario:
  - `username` obligatorio.
  - `full_name` obligatorio.
  - `password` minimo 6 caracteres.
  - `id_role` obligatorio.
  - Duplicado controlado.
- Editar usuario:
  - `id_user`, `username`, `full_name`, `id_role` obligatorios.
  - `404` si no existe.
  - Duplicado controlado.
- Reset password:
  - `id_user` obligatorio.
  - Password minimo 6.
  - `404` si no existe.
- Desactivar usuario:
  - `id_user` obligatorio.
  - No permite desactivar el propio usuario.
  - `404` si no existe.
- Permisos:
  - Usuario solicitante valido.
  - Requiere permiso para administrar permisos.
  - `id_usuario` valido.
  - Formato de permisos valido.

---

## Tabla materializada `stock_actual` (Fase 4)

### Qué es
- `stock_actual` es una tabla materializada con **una fila por combinación** `(id_bodega, id_producto, lote, fecha_vencimiento)`, con columnas `stock` (suma de `delta_cantidad` del kardex) y `fecha_entrada_lote` (primer `DATE(creado_en)` entre las filas con `delta_cantidad > 0`).
- La mantienen **3 triggers transaccionales** sobre `kardex` (se ejecutan en la misma transacción del movimiento):
  - `trg_kardex_stock_ai` (AFTER INSERT): suma `delta` con `ON DUPLICATE KEY UPDATE` y actualiza `fecha_entrada_lote` con `LEAST()`.
  - `trg_kardex_stock_ad` (AFTER DELETE): resta `delta` y, si `OLD.delta_cantidad > 0`, **recomputa** `fecha_entrada_lote` con `MIN(DATE(creado_en))`; elimina la fila si quedó `stock = 0` sin filas de kardex.
  - `trg_kardex_stock_au` (AFTER UPDATE): combina ambos comportamientos (resta en el grupo viejo, suma en el nuevo, recomputo si `OLD.delta > 0`).
- Las vistas `v_stock_por_lote`, `v_stock_disponible` y `v_stock_resumen` leen de `stock_actual` (ya NO agregan kardex). Las ~30 consultas que las usan no cambiaron.

### ⚠️ Bug de collations corregido (crítico)
- **Síntoma**: `ER_CANT_AGGREGATE_2COLLATIONS Illegal mix of collations ... for operation '<=>'` al hacer UPDATE/DELETE de kardex (triggers `ad`/`au`) o al ejecutar el reporte de existencias (subconsultas `k2/k3` que comparan `lote` contra la vista).
- **Causa raíz**: `stock_actual` se creó con `DEFAULT CHARSET=utf8mb4` **sin `COLLATE` explícito**, y en MariaDB 12 el default de `utf8mb4` es `utf8mb4_uca1400_ai_ci`, mientras `kardex.lote` usa `utf8mb4_unicode_ci`. Todo `<=>` entre ambas columnas `lote` fallaba.
- **Era latente**: el script de reconciliación solo crea triggers y hace backfill, nunca dispara un UPDATE/DELETE real de kardex, así que la desalineación pasaba desapercibida.
- **Fix (raíz)**: el DDL de `stock_actual` ahora declara `COLLATE=utf8mb4_unicode_ci` y `ensureStockActualTable()` (server.js) incluye un bloque idempotente que lee la collation de `kardex.lote` desde `information_schema` y, si difiere, ejecuta `ALTER TABLE stock_actual MODIFY lote ... MODIFY lote_key ...` para alinearla.
- **Regla de mantenimiento**: `stock_actual.lote` (y `lote_key`) **deben usar SIEMPRE la misma collation que `kardex.lote`**. Si se recrea `stock_actual` a mano, se cambia el COLLATE por defecto de la BD o se restaura la BD desde un backup viejo, ejecutar `npm run test:stock:fix` para realinear y reconstruir.

### Autenticación: JWT en cookie HttpOnly
- El JWT de sesión vive en una **cookie `token` HttpOnly + SameSite=Lax** (no legible por JS): se setea en `POST /api/auth/login` y se limpia en `POST /api/auth/logout`.
- **Doble canal en el server**: `auth()` acepta el token por header `Authorization: Bearer` > query `?token=` > cookie (orden de prioridad). El socket (`io.use`) lee la cookie del handshake además de `auth`/query.
- **`Secure`**: se activa con `NODE_ENV=production` o `COOKIE_SECURE=1`. En producción (HTTPS) debe quedar activa; en dev HTTP va sin `Secure` para que el navegador la acepte.
- El cliente ya no persiste el token en `localStorage` (solo el perfil `user`); `isAuthenticated()` usa la presencia de `user` y la validación real la hace el server (401 → login). Tras desplegar, los usuarios re-loguean una vez (el token viejo en localStorage queda huérfano).
- Los prints (`utils/print.js`) sanitizan los interpolados dinámicos con `esc()` antes de `document.write` (anti-XSS).

### Scripts de validación (CI)
- `npm run test:stock` — encadena:
  1. `node test_reconcile_stock.cjs` — compara `stock_actual` contra el agregado real de kardex (clave NULL-safe `lote_key`/`fecha_key`). Exit 0 = coincide 100%.
  2. `node test_kardex_triggers.cjs` — test funcional de los 3 triggers dentro de una transacción (con ROLLBACK final, no contamina datos): INSERT/UPDATE/DELETE con casos borde (positivo→negativo, cambio de lote, delete del único positivo, etc.) verificando `stock` y `fecha_entrada_lote` tras cada operación.
  3. `node test_reversa_e2e.cjs` — test end-to-end de reversa de movimiento replicando el SQL de `POST /api/entradas`, `POST /api/orders/:id/fulfill` y `POST /api/orders/:id/revert` (entrada → despacho → reversa → reversa de la entrada), pasando por los triggers reales `ai`/`ad`/`au` dentro de una transacción con ROLLBACK.
  4. `node test_despacho_rapido.cjs` — test funcional del **despacho rápido** (⚡ por línea y ⚡ Despachar todo del flujo Pedidos por despachar) replicando el SQL exacto de `POST /api/orders/:id/fulfill` y `POST /api/orders/:id/cancel-line` (con SAVEPOINTs que imitan el rollback del endpoint sin romper la transacción externa, y ROLLBACK final): verifica que el despacho por línea solo toca la línea indicada (las demás quedan intactas), que respeta **FEFO** (lote con vencimiento más cercano primero) y que **NO despacha lotes vencidos** (`allowExpired:false`), que la línea anulada localmente se cancela vía `cancel-line` (estado `ANULADO`, `justificacion_linea`, `anulado_por`, sin consumo de stock) dejando el pedido `COMPLETADO_JUSTIFICADO`, y los escenarios `SIN_STOCK_PARCIAL` (despacha lo que hay + reporta `solicitado/despachado/faltante` sin tocar vencidas) y `SIN_STOCK_NO_VIGENTE` (con solo stock vencido no despacha nada y revierte el movimiento).
  5. `node test_bench_reportes.cjs` — benchmark comparativo de los reportes de existencias/alertas (ANTES con derived table sobre kardex vs DESPUÉS con `fecha_entrada_lote` materializada) + verificación de equivalencia (falla el CI si hay divergencias).
  6. `node test_stock_history.cjs` — test funcional (unitario, **sin BD**: extrae `checkStockActualConsistency()` real de `server.js` con un extractor de balanceo de llaves y la ejecuta con mocks de `pool`/`opsMetrics`/`io`) que verifica el historial del healthcheck: escenarios ok/desync/error, `ms` del historial == `ms` del log (medición única), `io.emit("stock:desync")` en desync, y trim FIFO a `STOCK_HC_HISTORY_LIMIT` (solo se descartan las corridas más viejas).
- `npm run test:stock:fix` — igual pero `test_reconcile_stock.cjs --fix` reconstruye si hay desviaciones (para entornos donde se detectó desalineación).
- `npm run deploy:stock` — **paso de despliegue en producción** (equivale a `npm run test:stock:fix`): debe correrse **inmediatamente después de aplicar la Fase 4 en el servidor de producción** (tras desplegar el código nuevo y reiniciar el server, que aplica `ensureStockActualTable()` de forma idempotente: crea/alínea `stock_actual`, triggers y vistas; o tras correr `node test_reconcile_stock.cjs --fix` a mano). Verifica que la tabla materializada quedó alineada al 100%, que los triggers funcionan (E2E de reversa) y que los reportes no tienen regresiones de rendimiento. Exit 0 = despliegue verificado; exit ≠ 0 = hay que corregir antes de dar el servicio por bueno.
- Uso típico: `npm run test:stock` en CI tras desplegar, `npm run deploy:stock` como paso obligatorio post-Fase-4 en producción (idéntico a `test:stock:fix`), y `npm run test:stock:fix` cuando el paso 1 reporta desviaciones. Los pasos 1-5 asumen una BD poblada (requieren datos base reales: bodegas, usuarios, productos, motivos); el paso 6 (historial) es unitario y corre sin BD.

### Healthcheck en runtime de `stock_actual` (server.js)
- El servidor ejecuta un **healthcheck periódico** (`checkStockActualConsistency()`) que compara `stock_actual` contra el agregado real de `kardex` con la misma lógica NULL-safe del reconcile, **sin bloquear** (fire-and-forget con `setInterval`). La comparación usa un **diff 100% SQL-side** (UNION ALL de dos LEFT JOINs entre el agregado esperado de kardex y `stock_actual`) que devuelve **solo las claves divergentes** (0 filas en estado alineado), de modo que el agregado de kardex no viaja a JS; los conteos esperados/reales se obtienen con una query de escalares en paralelo.
- Comportamiento ante desviaciones (p.ej. INSERT manual en kardex, trigger roto, restore de backup viejo):
  - Loguea `[stock_actual] ⚠️ DESALINEACIÓN` con el detalle de las primeras 10 desviaciones y sugiere `npm run deploy:stock`.
  - Emite un evento socket **`stock:desync`** (los clientes conectados pueden alertar en vivo).
  - Actualiza `opsMetrics.stock_actual` (status `ok`/`desync`/`error`, conteos, último error), expuesto en `GET /api/health` y `GET /api/ops/metrics`.
- **NO reconstruye automáticamente**: la reparación es deliberada vía `npm run deploy:stock` para no hacer LOCK TABLES en runtime.
- **Historial en `/api/ops/metrics`**: cada corrida se guarda en `stock_actual.history` (últimas 50 por defecto, configurable con `STOCK_HC_HISTORY_LIMIT`) con `{ at, status, mismatches, expected_groups, actual_groups, ms }` (+ `error` en corridas fallidas), para detectar patrones de desalineación intermitente (p.ej. ok→desync→ok) sin depender solo del último estado.
- Configuración por env: `STOCK_HC_ENABLED=0` deshabilita; `STOCK_HC_INTERVAL_MS` (default 30 min, mínimo 1 min); `STOCK_HC_HISTORY_LIMIT` (default 50).

---

## Frontend (`public/app.js`)

### 1) Sesion Y Accesos
- Sin token redirige a login.
- Bloquea acciones sin permiso:
  - exportar,
  - editar/crear,
  - eliminar/desactivar,
  - despachar/revertir.
- Bloquea entrada a modulos sin permiso.

### 2) Entradas
- Agregar linea:
  - Producto seleccionado desde buscador.
  - Lote obligatorio.
  - Caducidad obligatoria.
  - Cantidad > 0.
  - Precio > 0.
  - Producto con `id_producto` valido.
  - Caducidad no vencida.
- Guardar entrada:
  - Lista con lineas.
  - Motivo obligatorio.
  - Proveedor obligatorio.
  - Numero de documento obligatorio.

### 3) Salidas
- Agregar linea:
  - Producto valido.
  - Cantidad > 0.
  - Cantidad no mayor al stock disponible.
- Guardar salida:
  - Bodega destino obligatoria.
  - Motivo obligatorio.
  - No permite lineas con cantidad invalida.

### 4) Pedidos
- Agregar al carro:
  - Producto valido.
  - Cantidad > 0.
- Guardar pedido:
  - Bodega solicitante obligatoria.
  - Usuario solicitante obligatorio.
  - Bodega surtidor obligatoria.

### 5) Despacho (UI)
- En despacho por linea o masivo:
  - Cantidad > 0.
  - Cantidad no mayor que `max` (stock/pendiente).
- Reversiones requieren confirmacion del usuario.

### 6) Formularios De Catalogos
- Bodegas: nombre y tipo obligatorios.
- Categorias: nombre obligatorio.
- Subcategorias: categoria y nombre obligatorios.
- Motivos: nombre y tipo obligatorios.
- Proveedores: nombre obligatorio.
- Productos: nombre, medida y categoria obligatorios.
- Limites: bodega/producto obligatorios y minimo <= maximo.
- Reglas: subcategoria obligatoria.
- Usuarios:
  - crear: usuario, nombre, rol y password >= 6.
  - reset: usuario, password >= 6 y confirmacion de password.
  - editar: usuario, nombre y rol obligatorios.

### 7) Importaciones CSV
- Importar productos:
  - Archivo `.csv` obligatorio.
  - CSV no vacio.
  - Encabezados requeridos.
  - Validacion por fila (nombre, medida/categoria, subcategoria, activo).
- Importar stock:
  - Archivo `.csv` obligatorio.
  - Motivo obligatorio.
  - CSV no vacio.
  - Producto identificable por `id_producto` o `sku` o `nombre_producto`.
  - Cantidad > 0.
  - Precio >= 0.

---

## Nota
- En frontend se muestran errores con `showEntToast(...)` y resaltado con `markError(...)`.
- En backend la mayor parte de validaciones retornan `400`, `401`, `403` o `404` segun el caso.
