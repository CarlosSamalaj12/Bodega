// ==============================================================
// index.js  —  Modular entry point for Bodega API server
// ==============================================================
// This file imports the shared application context (which sets up
// Express, middleware, database pool, Socket.IO, auth, and all
// utility functions) and then imports each route module.
// Route modules self-register by importing `app` from the shared
// context and defining routes on it.
// ==============================================================

// 1) Shared context: Express app, middleware, pool, io, auth,
//    permissions, utility functions, and table-creation routines.
import {
  app, pool, io, httpServer, HOST, PORT,
  OPS_BACKUP_AUTO_ENABLED, OPS_BACKUP_INTERVAL_MS,
  OPS_RECOVERY_CHECK_INTERVAL_MS,
  DASHBOARD_PREWARM_ENABLED, DASHBOARD_PREWARM_MS,
  createLogicalBackup, maybeRunMonthlyRecoveryTest, prewarmDashboardCache,
} from './server-shared.js';

// 2) Auto‑register route modules (each imports `app` from shared
//    and defines its routes at module‑load time).
import './server-split/server-auth.js';
import './server-split/server-catalog.js';
import './server-split/server-warehouse.js';
import './server-split/server-cierre.js';
import './server-split/server-cierre-dia.js';
import './server-split/server-dashboard.js';
import './server-split/server-reportes.js';
import './server-split/server-orders.js';
import './server-split/server-admin.js';

// 3) Start the server
httpServer.listen(PORT, HOST, () => {
  console.log(`Bodega API en ${HOST}:${PORT}`);

  if (OPS_BACKUP_AUTO_ENABLED) {
    setTimeout(() => {
      createLogicalBackup({ trigger: "AUTO_STARTUP" }).catch((e) =>
        console.error("Backup inicial fallo:", e)
      );
      maybeRunMonthlyRecoveryTest().catch((e) =>
        console.error("Recovery test inicial fallo:", e)
      );
    }, 8000);

    setInterval(() => {
      createLogicalBackup({ trigger: "AUTO_DAILY" }).catch((e) =>
        console.error("Backup programado fallo:", e)
      );
    }, OPS_BACKUP_INTERVAL_MS);

    setInterval(() => {
      maybeRunMonthlyRecoveryTest().catch((e) =>
        console.error("Recovery test programado fallo:", e)
      );
    }, OPS_RECOVERY_CHECK_INTERVAL_MS);
  } else {
    console.log("Backup automatico deshabilitado por BACKUP_AUTO_ENABLED=0");
  }

  if (DASHBOARD_PREWARM_ENABLED) {
    setTimeout(() => {
      prewarmDashboardCache().catch((e) =>
        console.error("Prewarm inicial fallo:", e)
      );
    }, 12000);

    setInterval(() => {
      prewarmDashboardCache().catch((e) =>
        console.error("Prewarm programado fallo:", e)
      );
    }, DASHBOARD_PREWARM_MS);
  } else {
    console.log("Dashboard prewarm deshabilitado por DASHBOARD_PREWARM=0");
  }
});
