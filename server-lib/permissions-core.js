// server-lib/permissions-core.js  —  Permission catalog, utils, and requirePermission middleware
import { pool } from "./core.js";

const PERM_CATALOG = [
  { key: "section.view.home", label: "Ver modulo Inicio", group: "Secciones" },
  { key: "section.view.entradas", label: "Ver modulo Entradas", group: "Secciones" },
  { key: "section.view.salidas", label: "Ver modulo Salidas", group: "Secciones" },
  { key: "section.view.ajustes", label: "Ver modulo Ajustes", group: "Secciones" },
  { key: "section.view.pedidos", label: "Ver modulo Realizar pedidos", group: "Secciones" },
  { key: "section.view.pedidos-despachar", label: "Ver modulo Pedidos x Despachar", group: "Secciones" },
  { key: "section.view.cuadre-caja", label: "Ver modulo Cuadre de Caja", group: "Secciones" },
  { key: "section.view.categorias", label: "Ver modulo Categorias", group: "Secciones" },
  { key: "section.view.subcategorias", label: "Ver modulo Subcategorias", group: "Secciones" },
  { key: "section.view.motivos-movimiento", label: "Ver modulo Motivo movimiento", group: "Secciones" },
  { key: "section.view.proveedores", label: "Ver modulo Proveedores", group: "Secciones" },
  { key: "section.view.productos", label: "Ver modulo Productos", group: "Secciones" },
  { key: "section.view.limites", label: "Ver modulo Minimos/Maximos", group: "Secciones" },
  { key: "section.view.reglas-subcategorias", label: "Ver modulo Reglas subcategorias", group: "Secciones" },
  { key: "section.view.usuarios", label: "Ver modulo Usuarios", group: "Secciones" },
  { key: "section.view.bodegas", label: "Ver modulo Bodegas", group: "Secciones" },
  { key: "section.view.r-existencias", label: "Ver Reporte Existencias", group: "Reportes" },
  { key: "section.view.r-corte-diario", label: "Ver Reporte Corte Diario", group: "Reportes" },
  { key: "section.view.r-entradas", label: "Ver Reporte Entradas", group: "Reportes" },
  { key: "section.view.r-salidas", label: "Ver Reporte Salidas", group: "Reportes" },
  { key: "section.view.r-pedidos", label: "Ver Reporte Pedidos", group: "Reportes" },
  { key: "section.view.r-transferencias", label: "Ver Reporte Kardex", group: "Reportes" },
  { key: "section.view.r-auditoria-sensibles", label: "Ver Reporte Auditoria sensible", group: "Reportes" },
  { key: "action.filter", label: "Usar filtros y busquedas", group: "Acciones" },
  { key: "action.export_excel", label: "Exportar reportes a Excel", group: "Acciones" },
  { key: "action.create_update", label: "Crear y editar registros", group: "Acciones" },
  { key: "action.delete", label: "Eliminar / desactivar registros", group: "Acciones" },
  { key: "action.dispatch", label: "Despachar pedidos", group: "Acciones" },
  { key: "action.sensitive_approve", label: "Aprobar acciones sensibles", group: "Acciones", default_active: 0 },
  { key: "action.manage_permissions", label: "Administrar permisos de usuarios", group: "Acciones" },
];

function permissionDefaults() {
  const map = {};
  PERM_CATALOG.forEach((p) => { map[p.key] = Number(typeof p.default_active === "number" ? p.default_active : 1) ? 1 : 0; });
  return map;
}

async function getUserPermissionsMap(idUsuario) {
  const base = permissionDefaults();
  const [rows] = await pool.query(`SELECT permiso, activo FROM usuario_permisos WHERE id_usuario=:id_usuario`, { id_usuario: idUsuario });
  for (const r of rows || []) { if (Object.prototype.hasOwnProperty.call(base, r.permiso)) base[r.permiso] = Number(r.activo) ? 1 : 0; }
  return base;
}

async function canManageUserPermissions(idUsuario) {
  const map = await getUserPermissionsMap(idUsuario);
  return Number(map["action.manage_permissions"] || 0) === 1;
}

async function userHasPermission(idUsuario, permiso) {
  const map = await getUserPermissionsMap(idUsuario);
  return Number(map?.[permiso] || 0) === 1;
}

function requirePermission(permiso, etiqueta = "esta accion") {
  return async (req, res, next) => {
    try {
      const idUsuario = Number(req.user?.id_user || 0);
      if (!idUsuario) return res.status(401).json({ error: "Usuario invalido" });
      const allowed = await userHasPermission(idUsuario, permiso);
      if (!allowed) return res.status(403).json({ error: `Sin permiso para ${etiqueta}` });
      return next();
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  };
}

export {
  PERM_CATALOG, permissionDefaults,
  getUserPermissionsMap, canManageUserPermissions, userHasPermission, requirePermission,
};
