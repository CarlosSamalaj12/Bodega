// server-reportes.js  |  Report routes — BARREL
import { Router } from 'express';
import dashboardRouter from './server-reportes-dashboard.js';
import entradasSalidasRouter from './server-reportes-entradas-salidas.js';
import tendenciaRouter from './server-reportes-tendencia.js';
import kardexRouter from './server-reportes-kardex.js';
import auditoriaRouter from './server-reportes-auditoria.js';

const router = Router();
router.use(dashboardRouter);
router.use(entradasSalidasRouter);
router.use(tendenciaRouter);
router.use(kardexRouter);
router.use(auditoriaRouter);

export default router;
