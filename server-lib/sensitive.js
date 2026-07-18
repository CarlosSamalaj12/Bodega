// server-lib/sensitive.js  —  Barrel module re-exporting sensitive submodules
// ==============================================================
// Sensitive action approval    →  sensitive-approval.js
// Daily close enforcement      →  sensitive-daily-close.js
// Dashboard cache              →  sensitive-dashboard-cache.js
// ==============================================================

export {
  verifySensitiveApproval, toSensitiveApprovalPayload, writeSensitiveActionAudit,
  requireSensitiveApproval,
} from "./sensitive-approval.js";

export { enforceDailyCloseBeforeMutations, createDailyCloseForDate } from "./sensitive-daily-close.js";

export { readDashboardResumenCache } from "./sensitive-dashboard-cache.js";
