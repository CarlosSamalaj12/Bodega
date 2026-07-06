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
