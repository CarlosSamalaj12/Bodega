// server-catalog.js  |  Barrel — re-exports catalog submodule routers
// ==============================================================
// Categories / Subcategories   →  server-catalog-categorias.js
// Products / Stock             →  server-catalog-productos.js
// Limits / Reglas / Prov / Mot →  server-catalog-entidades.js
// ==============================================================
import { Router } from 'express';
import categoriasRouter from './server-catalog-categorias.js';
import productosRouter from './server-catalog-productos.js';
import entidadesRouter from './server-catalog-entidades.js';

const router = Router();
router.use(categoriasRouter);
router.use(productosRouter);
router.use(entidadesRouter);

export default router;

