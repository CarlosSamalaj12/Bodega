// server-auth.js  |  Barrel — monta submodulos de auth
import { Router } from 'express';
import loginRouter from './server-auth-login.js';
import registroRouter from './server-auth-registro.js';
import middlewareRouter from './server-auth-middleware.js';

const router = Router();
router.use(loginRouter);
router.use(registroRouter);
router.use(middlewareRouter);

export default router;
