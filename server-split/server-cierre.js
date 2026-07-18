// server-cierre.js  |  Cierre routes — BARREL
import { Router } from 'express';
import conteoRouter from './server-cierre-conteo.js';
import bodegasRouter from './server-cierre-bodegas.js';
import existenciasRouter from './server-cierre-existencias.js';
import cuadreRouter from './server-cierre-cuadre.js';

const router = Router();
router.use(conteoRouter);
router.use(bodegasRouter);
router.use(existenciasRouter);
router.use(cuadreRouter);

export default router;
