// server-admin.js  |  Admin routes — BARREL
import { Router } from 'express';
import impresionRouter from './server-admin-impresion.js';
import usuariosCrudRouter from './server-admin-usuarios-crud.js';
import rolesPermisosRouter from './server-admin-roles-permisos.js';
import accesoBodegasRouter from './server-admin-acceso-bodegas.js';
import configRouter from './server-admin-config.js';
import opsRouter from './server-admin-ops.js';

const router = Router();
router.use(impresionRouter);
router.use(usuariosCrudRouter);
router.use(rolesPermisosRouter);
router.use(accesoBodegasRouter);
router.use(configRouter);
router.use(opsRouter);

export default router;
