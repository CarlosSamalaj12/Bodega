import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usuariosService } from '@/services/usuarios.service';
import { catalogosService } from '@/services/catalogos.service';
import './UsuariosPage.scss';

const ORDER_KEY = 'usr-order-v1';

function loadOrder() {
  try { const r = localStorage.getItem(ORDER_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveOrder(ids) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* */ }
}

// ================== DragItem ==================
function DragItem({ row, children, onReorder }) {
  const ref = useRef(null);
  const rowId = Number(row.id_user);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('usuarios-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('usuarios-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="usuarios-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

export default function UsuariosPage() {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // ---- Estado de lista ----
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // ---- Catálogos ----
  const [roles, setRoles] = useState([]);
  const [bodegas, setBodegas] = useState([]);

  // ---- Modal crear/editar ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // ---- Formulario ----
  const emptyForm = {
    username: '',
    full_name: '',
    password: '',
    id_role: '',
    id_warehouse: '',
    active: true,
    can_supervisor: false,
    no_auto_logout: false,
    order_pin: '',
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState(null);

  // ---- Permisos ----
  const [permisosOpen, setPermisosOpen] = useState(false);
  const [permisosCatalogo, setPermisosCatalogo] = useState([]);
  const [permisosValues, setPermisosValues] = useState({});
  const [permisosLoading, setPermisosLoading] = useState(false);
  const [permisosSaving, setPermisosSaving] = useState(false);

  // ---- Bodegas acceso ----
  const [bodegasAccesoOpen, setBodegasAccesoOpen] = useState(false);
  const [bodegasAccesoIds, setBodegasAccesoIds] = useState([]);
  const [bodegasAccesoAll, setBodegasAccesoAll] = useState(false);
  const [bodegasAccesoLoading, setBodegasAccesoLoading] = useState(false);
  const [bodegasAccesoSaving, setBodegasAccesoSaving] = useState(false);

  // ---- Reset password modal ----
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [resetPwSubmitting, setResetPwSubmitting] = useState(false);

  // ---- Reset PIN modal ----
  const [resetPinOpen, setResetPinOpen] = useState(false);
  const [resetPinUser, setResetPinUser] = useState(null);
  const [resetPinValue, setResetPinValue] = useState('');
  const [resetPinSubmitting, setResetPinSubmitting] = useState(false);

  // ---- Cargar datos iniciales ----
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [users, rs, bgs] = await Promise.all([
        usuariosService.list(showInactive),
        usuariosService.getRoles(),
        catalogosService.getBodegas(),
      ]);
      setUsuarios(users);
      setRoles(rs);
      setBodegas(bgs.filter((b) => Number(b.activo) === 1));
    } catch (e) {
      toast.error('No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Orden + búsqueda ----
  const ordered = useMemo(() => {
    const order = loadOrder();
    const map = new Map();
    order.forEach((id, i) => map.set(id, i));
    const known = [], unknown = [];
    for (const item of usuarios) {
      if (map.has(Number(item.id_user))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_user)) - map.get(Number(b.id_user)));
    return [...known, ...unknown];
  }, [usuarios]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((u) =>
      [u.username, u.full_name, u.role_name, u.warehouse_name].some(
        (v) => v != null && String(v).toLowerCase().includes(q)
      )
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag reorder ----
  const handleReorder = useCallback((fromId, toId) => {
    setUsuarios((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_user) === fromId);
      const ti = next.findIndex((r) => Number(r.id_user) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_user)));
      return next;
    });
  }, []);

  // ---- Abrir modal crear ----
  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setFormError(null);
    setPermisosOpen(false);
    setPermisosValues({});
    setBodegasAccesoOpen(false);
    setBodegasAccesoIds([]);
    setBodegasAccesoAll(false);
    setModalOpen(true);
  };

  // ---- Abrir modal editar ----
  const openEdit = async (user) => {
    setEditingId(user.id_user);
    setForm({
      username: user.username || '',
      full_name: user.full_name || '',
      password: '',
      id_role: String(user.id_role || ''),
      id_warehouse: String(user.id_warehouse || ''),
      active: Number(user.active) === 1,
      can_supervisor: Number(user.can_supervisor) === 1,
      no_auto_logout: Number(user.no_auto_logout) === 1,
      order_pin: '',
    });
    setFormError(null);
    setPermisosOpen(false);
    setPermisosValues({});
    setPermisosCatalogo([]);
    setBodegasAccesoOpen(false);
    setBodegasAccesoIds([]);
    setBodegasAccesoAll(false);
    setModalOpen(true);

    loadPermisos(user.id_user);
    loadBodegasAcceso(user.id_user);
  };

  // ---- Cargar permisos del usuario ----
  const loadPermisos = async (id) => {
    setPermisosLoading(true);
    try {
      const data = await usuariosService.getPermisos(id);
      setPermisosCatalogo(data?.catalogo || []);
      setPermisosValues(data?.permisos || {});
    } catch {
      // silencioso
    } finally {
      setPermisosLoading(false);
    }
  };

  // ---- Cargar bodegas de acceso ----
  const loadBodegasAcceso = async (id) => {
    setBodegasAccesoLoading(true);
    try {
      const data = await usuariosService.getBodegasAcceso(id);
      setBodegasAccesoIds(data?.ids || []);
      setBodegasAccesoAll(data?.all || false);
    } catch {
      // silencioso
    } finally {
      setBodegasAccesoLoading(false);
    }
  };

  // ---- Actualizar un permiso ----
  const togglePermiso = (key) => {
    setPermisosValues((prev) => ({
      ...prev,
      [key]: prev[key] ? 0 : 1,
    }));
  };

  // ---- Guardar permisos ----
  const savePermisos = async () => {
    if (!editingId) return;
    setPermisosSaving(true);
    try {
      await usuariosService.updatePermisos(editingId, permisosValues);
      toast.success('Permisos actualizados');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron guardar los permisos');
    } finally {
      setPermisosSaving(false);
    }
  };

  // ---- Toggle bodega acceso ----
  const toggleBodegaAcceso = (id) => {
    setBodegasAccesoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // ---- Guardar bodegas acceso ----
  const saveBodegasAcceso = async () => {
    if (!editingId) return;
    setBodegasAccesoSaving(true);
    try {
      await usuariosService.updateBodegasAcceso(editingId, bodegasAccesoIds);
      toast.success('Acceso a bodegas actualizado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudieron guardar los accesos');
    } finally {
      setBodegasAccesoSaving(false);
    }
  };

  // ---- Enviar formulario crear/editar ----
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.username.trim()) return setFormError('El nombre de usuario es requerido');
    if (!form.full_name.trim()) return setFormError('El nombre completo es requerido');
    if (!editingId && !form.password) return setFormError('La contraseña es requerida');
    if (!editingId && form.password.length < 6) return setFormError('La contraseña debe tener al menos 6 caracteres');
    if (!form.id_role) return setFormError('El rol es requerido');

    setSubmitting(true);
    try {
      if (editingId) {
        await usuariosService.update(editingId, {
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          id_role: Number(form.id_role),
          id_warehouse: form.id_warehouse ? Number(form.id_warehouse) : null,
          active: form.active ? 1 : 0,
          can_supervisor: form.can_supervisor ? 1 : 0,
          no_auto_logout: form.no_auto_logout ? 1 : 0,
        });
        toast.success('Usuario actualizado');
      } else {
        await usuariosService.create({
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          password: form.password,
          id_role: Number(form.id_role),
          id_warehouse: form.id_warehouse ? Number(form.id_warehouse) : null,
          active: form.active ? 1 : 0,
          can_supervisor: form.can_supervisor ? 1 : 0,
          no_auto_logout: form.no_auto_logout ? 1 : 0,
          order_pin: form.order_pin || null,
        });
        toast.success('Usuario creado');
      }
      setModalOpen(false);
      loadData();
    } catch (e) {
      const msg = e?.response?.data?.error || 'Error al guardar usuario';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Desactivar usuario ----
  const handleDeactivate = async (user) => {
    if (!window.confirm(`¿Desactivar a "${user.full_name || user.username}"?`)) return;
    try {
      await usuariosService.deactivate(user.id_user);
      toast.success('Usuario desactivado');
      loadData();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo desactivar');
    }
  };

  // ---- Reset password ----
  const openResetPw = (user) => {
    setResetPwUser(user);
    setResetPwValue('');
    setResetPwOpen(true);
  };

  const handleResetPw = async (e) => {
    e.preventDefault();
    if (!resetPwValue || resetPwValue.length < 6) {
      return toast.error('La contraseña debe tener al menos 6 caracteres');
    }
    setResetPwSubmitting(true);
    try {
      await usuariosService.resetPassword(resetPwUser.id_user, resetPwValue);
      toast.success('Contraseña actualizada');
      setResetPwOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cambiar la contraseña');
    } finally {
      setResetPwSubmitting(false);
    }
  };

  // ---- Reset PIN ----
  const openResetPin = (user) => {
    setResetPinUser(user);
    setResetPinValue('');
    setResetPinOpen(true);
  };

  const handleResetPin = async (e) => {
    e.preventDefault();
    if (!resetPinValue || resetPinValue.length < 6 || resetPinValue.length > 12) {
      return toast.error('El PIN debe tener entre 6 y 12 dígitos');
    }
    if (!/^\d+$/.test(resetPinValue)) {
      return toast.error('El PIN debe contener solo dígitos');
    }
    setResetPinSubmitting(true);
    try {
      await usuariosService.resetOrderPin(resetPinUser.id_user, resetPinValue);
      toast.success('PIN de pedidos actualizado');
      setResetPinOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo cambiar el PIN');
    } finally {
      setResetPinSubmitting(false);
    }
  };

  // ---- Agrupar permisos por grupo ----
  const permisosPorGrupo = useMemo(() => {
    const map = {};
    for (const p of permisosCatalogo) {
      const g = p.group || 'Otros';
      if (!map[g]) map[g] = [];
      map[g].push(p);
    }
    return map;
  }, [permisosCatalogo]);

  // ===================== RENDER =====================
  return (
    <>
      <Header
        title="Usuarios"
        subtitle={`${filtered.length} usuario${filtered.length === 1 ? '' : 's'}`}
        actions={
          <Button size={isMobile ? 'sm' : 'md'} onClick={openCreate}>
            Nuevo usuario
          </Button>
        }
      />

      <div className="usuarios-page">
        {/* Filtros */}
        <Card>
          <div className="usuarios-page__filters">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar usuarios…"
            />
            <label className="usuarios-page__toggle-inactive">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={() => setShowInactive((x) => !x)}
              />
              <span>Mostrar inactivos</span>
            </label>
          </div>
        </Card>

        {/* Lista de usuarios */}
        {loading ? (
          <div className="usuarios-page__state">
            <Spinner size={20} label="Cargando usuarios…" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="◐"
            title={search ? 'Sin resultados' : 'Sin usuarios'}
            message={search ? 'Intenta con otros términos de búsqueda.' : 'No hay usuarios registrados todavía.'}
            action={!search ? <Button onClick={openCreate}>Crear usuario</Button> : null}
          />
        ) : (
          <div className="usuarios-page__list">
            {filtered.map((row) => (
              <DragItem key={`usu-${row.id_user}`} row={row} onReorder={handleReorder}>
                <span className="usuarios-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="usuarios-page__item-info">
                  <div className="usuarios-page__item-main">
                    <span className="usuarios-page__item-name">
                      <span className="usuarios-page__username">{row.username}</span>
                      {row.full_name && <span className="usuarios-page__item-fullname">{row.full_name}</span>}
                    </span>
                    <div className="usuarios-page__item-meta">
                      {row.role_name && <Badge variant="info">{row.role_name}</Badge>}
                      {row.warehouse_name
                        ? <Badge variant="primary">{row.warehouse_name}</Badge>
                        : <span className="usuarios-page__muted">Sin bodega</span>}
                    </div>
                  </div>
                  <div className="usuarios-page__item-badges">
                    <span className={`usuarios-page__item-badge ${Number(row.active) === 1 ? 'usuarios-page__item-badge--active' : 'usuarios-page__item-badge--inactive'}`}>
                      {Number(row.active) === 1 ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
                <div className="usuarios-page__item-actions">
                  <div className="usuarios-page__item-actions-row">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title="Editar">✎</Button>
                    <Button size="sm" variant="ghost" onClick={() => openResetPw(row)} title="Cambiar contraseña">🔑</Button>
                    <Button size="sm" variant="ghost" onClick={() => openResetPin(row)} title="Resetear PIN">🔢</Button>
                    {Number(row.active) === 1 && (
                      <Button size="sm" variant="ghost" onClick={() => handleDeactivate(row)} title="Desactivar">⛔</Button>
                    )}
                  </div>
                </div>
              </DragItem>
            ))}
          </div>
        )}
      </div>

      {/* === Modal crear/editar usuario === */}
      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editingId ? 'Editar usuario' : 'Nuevo usuario'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="usuarios-page__form">
          {formError && <div className="usuarios-page__form-error">{formError}</div>}

          <div className="usuarios-page__form-grid">
            {/* Usuario */}
            <div className="usuarios-page__field">
              <label className="usuarios-page__label" htmlFor="u-username">
                Usuario <span className="usuarios-page__required">*</span>
              </label>
              <input
                id="u-username"
                type="text"
                className="input"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                autoFocus
              />
            </div>

            {/* Nombre completo */}
            <div className="usuarios-page__field">
              <label className="usuarios-page__label" htmlFor="u-fullname">
                Nombre completo <span className="usuarios-page__required">*</span>
              </label>
              <input
                id="u-fullname"
                type="text"
                className="input"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>

            {/* Contraseña */}
            <div className="usuarios-page__field">
              <label className="usuarios-page__label" htmlFor="u-password">
                {editingId ? 'Nueva contraseña (dejar vacío para mantener)' : 'Contraseña'}
                {!editingId && <span className="usuarios-page__required"> *</span>}
              </label>
              <input
                id="u-password"
                type="password"
                className="input"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editingId ? '••••••••' : 'Mínimo 6 caracteres'}
              />
            </div>

            {/* Rol */}
            <div className="usuarios-page__field">
              <label className="usuarios-page__label" htmlFor="u-role">
                Rol <span className="usuarios-page__required">*</span>
              </label>
              <select
                id="u-role"
                className="select"
                value={form.id_role}
                onChange={(e) => setForm((f) => ({ ...f, id_role: e.target.value }))}
              >
                <option value="">Seleccionar…</option>
                {roles.map((r) => (
                  <option key={`usu-${r.id_role}`} value={r.id_role}>
                    {r.role_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Bodega */}
            <div className="usuarios-page__field">
              <label className="usuarios-page__label" htmlFor="u-warehouse">
                Bodega principal
              </label>
              <select
                id="u-warehouse"
                className="select"
                value={form.id_warehouse}
                onChange={(e) => setForm((f) => ({ ...f, id_warehouse: e.target.value }))}
              >
                <option value="">Sin bodega</option>
                {bodegas.map((b) => (
                  <option key={`usu-bod-${b.id_bodega}`} value={b.id_bodega}>
                    {b.nombre_bodega}
                  </option>
                ))}
              </select>
            </div>

            {/* PIN de pedidos (solo crear) */}
            {!editingId && (
              <div className="usuarios-page__field">
                <label className="usuarios-page__label" htmlFor="u-pin">
                  PIN de pedidos
                </label>
                <input
                  id="u-pin"
                  type="text"
                  className="input"
                  value={form.order_pin}
                  onChange={(e) => setForm((f) => ({ ...f, order_pin: e.target.value }))}
                  placeholder="6 a 12 dígitos (opcional)"
                  maxLength={12}
                />
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="usuarios-page__toggles">
            <label className="usuarios-page__toggle">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Usuario activo</span>
            </label>
            <label className="usuarios-page__toggle">
              <input
                type="checkbox"
                checked={form.can_supervisor}
                onChange={(e) => setForm((f) => ({ ...f, can_supervisor: e.target.checked }))}
              />
              <span>Puede aprobar operaciones sensibles</span>
            </label>
            <label className="usuarios-page__toggle">
              <input
                type="checkbox"
                checked={form.no_auto_logout}
                onChange={(e) => setForm((f) => ({ ...f, no_auto_logout: e.target.checked }))}
              />
              <span>No cerrar sesión automáticamente</span>
            </label>
          </div>

          {/* Botones */}
          <div className="usuarios-page__form-footer">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? <Spinner size={14} /> : editingId ? 'Guardar' : 'Crear usuario'}
            </Button>
          </div>
        </form>

        {/* === Sección de permisos (solo edición) === */}
        {editingId && (
          <div className="usuarios-page__section">
            <button
              type="button"
              className="usuarios-page__section-header"
              onClick={() => setPermisosOpen((x) => !x)}
            >
              <span>Permisos del usuario</span>
              <span className={`usuarios-page__chevron ${permisosOpen ? 'usuarios-page__chevron--open' : ''}`}>
                ▾
              </span>
            </button>

            {permisosOpen && (
              <div className="usuarios-page__section-body">
                {permisosLoading ? (
                  <div className="usuarios-page__section-loading">
                    <Spinner size={14} label="Cargando permisos…" />
                  </div>
                ) : permisosCatalogo.length === 0 ? (
                  <p className="usuarios-page__section-empty">No hay permisos disponibles.</p>
                ) : (
                  <>
                    {Object.entries(permisosPorGrupo).map(([grupo, perms]) => (
                      <div key={`usu-${grupo}`} className="usuarios-page__perm-group">
                        <div className="usuarios-page__perm-group-title">{grupo}</div>
                        <div className="usuarios-page__perm-list">
                          {perms.map((p) => (
                            <label key={`usu-${p.key}`} className="usuarios-page__perm-item">
                              <input
                                type="checkbox"
                                checked={permisosValues[p.key] === 1 || permisosValues[p.key] === true}
                                onChange={() => togglePermiso(p.key)}
                              />
                              <span>{p.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="usuarios-page__section-actions">
                      <Button size="sm" variant="primary" onClick={savePermisos} disabled={permisosSaving}>
                        {permisosSaving ? <Spinner size={14} /> : 'Guardar permisos'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* === Sección de bodegas de acceso (solo edición) === */}
        {editingId && (
          <div className="usuarios-page__section">
            <button
              type="button"
              className="usuarios-page__section-header"
              onClick={() => setBodegasAccesoOpen((x) => !x)}
            >
              <span>Acceso a bodegas</span>
              <span className={`usuarios-page__chevron ${bodegasAccesoOpen ? 'usuarios-page__chevron--open' : ''}`}>
                ▾
              </span>
            </button>

            {bodegasAccesoOpen && (
              <div className="usuarios-page__section-body">
                {bodegasAccesoLoading ? (
                  <div className="usuarios-page__section-loading">
                    <Spinner size={14} label="Cargando accesos…" />
                  </div>
                ) : (
                  <>
                    <div className="usuarios-page__bodegas-list">
                      {bodegas.map((b) => (
                        <label key={`usu-bod-${b.id_bodega}`} className="usuarios-page__bodega-item">
                          <input
                            type="checkbox"
                            checked={bodegasAccesoAll || bodegasAccesoIds.includes(b.id_bodega)}
                            onChange={() => toggleBodegaAcceso(b.id_bodega)}
                            disabled={bodegasAccesoAll}
                          />
                          <span>{b.nombre_bodega}</span>
                        </label>
                      ))}
                      {bodegas.length === 0 && (
                        <p className="usuarios-page__section-empty">No hay bodegas disponibles.</p>
                      )}
                    </div>
                    <div className="usuarios-page__section-actions">
                      <Button size="sm" variant="primary" onClick={saveBodegasAcceso} disabled={bodegasAccesoSaving}>
                        {bodegasAccesoSaving ? <Spinner size={14} /> : 'Guardar accesos'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* === Modal reset password === */}
      <Modal
        open={resetPwOpen}
        onClose={() => !resetPwSubmitting && setResetPwOpen(false)}
        title={`Cambiar contraseña — ${resetPwUser?.full_name || resetPwUser?.username || ''}`}
      >
        <form onSubmit={handleResetPw} className="usuarios-page__form">
          <div className="usuarios-page__field">
            <label className="usuarios-page__label" htmlFor="rp-pass">
              Nueva contraseña
            </label>
            <input
              id="rp-pass"
              type="password"
              className="input"
              value={resetPwValue}
              onChange={(e) => setResetPwValue(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              autoFocus
            />
          </div>
          <div className="usuarios-page__form-footer" style={{ marginTop: '1rem' }}>
            <Button type="button" variant="ghost" onClick={() => setResetPwOpen(false)} disabled={resetPwSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={resetPwSubmitting}>
              {resetPwSubmitting ? <Spinner size={14} /> : 'Cambiar contraseña'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* === Modal reset PIN === */}
      <Modal
        open={resetPinOpen}
        onClose={() => !resetPinSubmitting && setResetPinOpen(false)}
        title={`Resetear PIN de pedidos — ${resetPinUser?.full_name || resetPinUser?.username || ''}`}
      >
        <form onSubmit={handleResetPin} className="usuarios-page__form">
          <div className="usuarios-page__field">
            <label className="usuarios-page__label" htmlFor="rp-pin">
              Nuevo PIN de pedidos
            </label>
            <input
              id="rp-pin"
              type="text"
              className="input"
              value={resetPinValue}
              onChange={(e) => setResetPinValue(e.target.value.replace(/\D/g, ''))}
              placeholder="6 a 12 dígitos"
              maxLength={12}
              autoFocus
            />
          </div>
          <div className="usuarios-page__form-footer" style={{ marginTop: '1rem' }}>
            <Button type="button" variant="ghost" onClick={() => setResetPinOpen(false)} disabled={resetPinSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={resetPinSubmitting}>
              {resetPinSubmitting ? <Spinner size={14} /> : 'Cambiar PIN'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
