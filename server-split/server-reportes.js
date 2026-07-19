// server-reportes.js  |  Report routes — BARREL
import { Router } from 'express';
import stockScopeRouter from './server-reportes-stock-scope.js';
import dashboardResumenRouter from './server-reportes-dashboard-resumen.js';
import dashboardDetalleRouter from './server-reportes-dashboard-detalle.js';
import entradasSalidasRouter from './server-reportes-entradas-salidas.js';
import tendenciaRouter from './server-reportes-tendencia.js';
import kardexRouter from './server-reportes-kardex.js';
import auditoriaRouter from './server-reportes-auditoria.js';

const router = Router();
router.use(stockScopeRouter);
router.use(dashboardResumenRouter);
router.use(dashboardDetalleRouter);
router.use(entradasSalidasRouter);
router.use(tendenciaRouter);
router.use(kardexRouter);
router.use(auditoriaRouter);

export default router;
