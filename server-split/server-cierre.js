// server-cierre.js  |  Cierre routes — BARREL
import { Router } from 'express';
import conteoRouter from './server-cierre-conteo.js';
import bodegasRouter from './server-cierre-bodegas.js';
import existenciasRouter from './server-cierre-existencias.js';
import cuadreContextRouter from './server-cierre-cuadre-context.js';
import cuadreCrudRouter from './server-cierre-cuadre-crud.js';
import cuadrePrintRouter from './server-cierre-cuadre-print.js';

const router = Router();
router.use(conteoRouter);
router.use(bodegasRouter);
router.use(existenciasRouter);
router.use(cuadreContextRouter);
router.use(cuadreCrudRouter);
router.use(cuadrePrintRouter);

export default router;
