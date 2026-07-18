// server-admin.js  |  Admin routes — BARREL
import { Router } from 'express';
import impresionRouter from './server-admin-impresion.js';
import usuariosRouter from './server-admin-usuarios.js';
import configRouter from './server-admin-config.js';
import opsRouter from './server-admin-ops.js';

const router = Router();
router.use(impresionRouter);
router.use(usuariosRouter);
router.use(configRouter);
router.use(opsRouter);

export default router;
