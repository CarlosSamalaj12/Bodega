// server-dashboard.js  |  Barrel — monta submodulos de cierre de dia
import { Router } from 'express';
import estadoRouter from './server-dashboard-estado.js';
import cierreRouter from './server-dashboard-cierre.js';

const router = Router();
router.use(estadoRouter);
router.use(cierreRouter);

export default router;
