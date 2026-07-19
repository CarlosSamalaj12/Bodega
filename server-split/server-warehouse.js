// server-warehouse.js  |  Barrel — monta submodulos de inventario, lotes y movimientos
import { Router } from 'express';
import inventarioRouter from './server-warehouse-inventario.js';
import lotesRouter from './server-warehouse-lotes.js';
import movimientosRouter from './server-warehouse-movimientos.js';

const router = Router();
router.use(inventarioRouter);
router.use(lotesRouter);
router.use(movimientosRouter);

export default router;
