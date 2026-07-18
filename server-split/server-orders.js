// server-orders.js  |  Barrel — re-exports orders submodule routers
// ==============================================================
// Orders CRUD / List / Print  →  server-orders-pedidos.js
// Direct salidas              →  server-orders-salidas.js
// Dispatch / Revert / Cancel  →  server-orders-despacho.js
// ==============================================================
import { Router } from 'express';
import pedidosRouter from './server-orders-pedidos.js';
import salidasRouter from './server-orders-salidas.js';
import despachoRouter from './server-orders-despacho.js';

const router = Router();
router.use(pedidosRouter);
router.use(salidasRouter);
router.use(despachoRouter);

export default router;
