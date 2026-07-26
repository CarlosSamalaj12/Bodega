import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { useDebounce } from '@/hooks/useDebounce';
import { useForm } from '@/hooks/useForm';
import api from '@/services/api';
import { catalogosService } from '@/services/catalogos.service';
import './ReglasSubcategoriasPage.scss';

const ORDER_KEY = 'reglas-order-v1';

function loadOrder() {
  try { const r = localStorage.getItem(ORDER_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveOrder(ids) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* */ }
}

const EMPTY = { id_subcategoria: '', max_dias_vida: '', dias_alerta_antes: '', activo: 1 };

// ================== DragItem ==================
function DragItem({ row, children, onReorder }) {
  const ref = useRef(null);
  const rowId = Number(row.id_subcategoria);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('reglas-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('reglas-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="reglas-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function ReglaForm({ open, onClose, editingId, editValues, subcategorias, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!editingId && !v.id_subcategoria) e.id_subcategoria = 'Selecciona una subcategoría';
      const maxVida = Number(v.max_dias_vida);
      const alerta = Number(v.dias_alerta_antes);
      if (v.max_dias_vida !== '' && (isNaN(maxVida) || maxVida < 0)) e.max_dias_vida = 'Debe ser >= 0';
      if (v.dias_alerta_antes !== '' && (isNaN(alerta) || alerta < 0)) e.dias_alerta_antes = 'Debe ser >= 0';
      if (alerta > maxVida && maxVida > 0) e.dias_alerta_antes = 'No puede ser mayor a Máx días de vida';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = {
          id_subcategoria: editingId ? editingId : Number(vals.id_subcategoria),
          max_dias_vida: Math.max(0, Number(vals.max_dias_vida || 0)),
          dias_alerta_antes: Math.max(0, Number(vals.dias_alerta_antes || 0)),
          activo: Number(vals.activo),
        };
        if (editingId) {
          await api.patch(`/api/reglas-subcategorias/${editingId}`, body);
          toast.success('Regla actualizada');
        } else {
          await api.post('/api/reglas-subcategorias', body);
          toast.success('Regla creada');
        }
        onSaved();
        onClose();
      } catch (e) {
        setError(e?.response?.data?.error || 'Error al guardar');
      } finally { setSubmitting(false); }
    },
  });

  useEffect(() => {
    if (open) {
      if (editingId && editValues) {
        Object.entries(editValues).forEach(([k, v]) => set(k, v));
      } else {
        Object.entries(EMPTY).forEach(([k, v]) => set(k, v));
      }
    }
  }, [open, editingId]);

  // Subcategorías activas y sin regla (o la propia regla si es edición)
  const subcategoriasDisponibles = useMemo(() => {
    return subcategorias.filter(
      (s) => editingId === Number(s.id_subcategoria) || !s.tiene_regla
    );
  }, [subcategorias, editingId]);

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar regla' : 'Nueva regla'}>
      <form onSubmit={handleSubmit} className="reglas-page__form">
        {error && <div className="reglas-page__form-error">{error}</div>}
        <div className="reglas-page__form-grid">
          {!editingId && (
            <div className="reglas-page__field reglas-page__field--full">
              <label className="reglas-page__label" htmlFor="regla-sub">Subcategoría <span className="reglas-page__required">*</span></label>
              <select id="regla-sub" className="select" value={values.id_subcategoria ?? ''}
                onChange={(e) => set('id_subcategoria', e.target.value)}>
                <option value="">Seleccionar…</option>
                {subcategoriasDisponibles.map((s) => (
                  <option key={s.id_subcategoria} value={s.id_subcategoria}>
                    {s.nombre_categoria} → {s.nombre_subcategoria}
                  </option>
                ))}
              </select>
              {errors.id_subcategoria && <span className="reglas-page__field-error">{errors.id_subcategoria}</span>}
            </div>
          )}
          {editingId && (
            <div className="reglas-page__field reglas-page__field--full">
              <label className="reglas-page__label">Subcategoría</label>
              <div className="reglas-page__field-value">
                {editValues?.nombre_categoria} → {editValues?.nombre_subcategoria}
              </div>
            </div>
          )}
          <div className="reglas-page__field">
            <label className="reglas-page__label" htmlFor="regla-max">Máx. días de vida</label>
            <input id="regla-max" type="number" className="input" min="0" step="1"
              value={values.max_dias_vida ?? ''}
              onChange={(e) => set('max_dias_vida', e.target.value)}
              placeholder="0 = sin límite" />
            {errors.max_dias_vida && <span className="reglas-page__field-error">{errors.max_dias_vida}</span>}
          </div>
          <div className="reglas-page__field">
            <label className="reglas-page__label" htmlFor="regla-alert">Días alerta antes de vencer</label>
            <input id="regla-alert" type="number" className="input" min="0" step="1"
              value={values.dias_alerta_antes ?? ''}
              onChange={(e) => set('dias_alerta_antes', e.target.value)}
              placeholder="Ej. 15" />
            {errors.dias_alerta_antes && <span className="reglas-page__field-error">{errors.dias_alerta_antes}</span>}
          </div>
          <div className="reglas-page__field">
            <label className="reglas-page__label" htmlFor="regla-activo">Estado</label>
            <select id="regla-activo" className="select" value={values.activo ?? 1}
              onChange={(e) => set('activo', Number(e.target.value))}>
              <option value={1}>Activo</option>
              <option value={0}>Inactivo</option>
            </select>
          </div>
        </div>
        <div className="reglas-page__form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? <Spinner size={14} /> : editingId ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ================== PAGE ==================
export default function ReglasSubcategoriasPage() {
  const [items, setItems] = useState([]);
  const [subcategorias, setSubcategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reglas, subs] = await Promise.all([
        api.get('/api/reglas-subcategorias?all=1').then((r) => r.data || []),
        catalogosService.getSubcategorias(),
      ]);
      // Marcar subcategorías que ya tienen regla
      const reglaSubIds = new Set((reglas || []).map((r) => Number(r.id_subcategoria)));
      setSubcategorias((subs || []).map((s) => ({ ...s, tiene_regla: reglaSubIds.has(Number(s.id_subcategoria)) })));
      setItems(Array.isArray(reglas) ? reglas : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Orden ----
  const ordered = useMemo(() => {
    const order = loadOrder();
    const map = new Map();
    order.forEach((id, i) => map.set(id, i));
    const known = [], unknown = [];
    for (const item of items) {
      if (map.has(Number(item.id_subcategoria))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_subcategoria)) - map.get(Number(b.id_subcategoria)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) =>
      [r.nombre_subcategoria, r.nombre_categoria].some(
        (v) => v && String(v).toLowerCase().includes(q)
      )
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag ----
  const handleReorder = useCallback((fromId, toId) => {
    setItems((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_subcategoria) === fromId);
      const ti = next.findIndex((r) => Number(r.id_subcategoria) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_subcategoria)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => {
    setEditingId(null);
    setEditingValues(null);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(Number(row.id_subcategoria));
    setEditingValues({
      max_dias_vida: row.max_dias_vida ?? '',
      dias_alerta_antes: row.dias_alerta_antes ?? '',
      activo: Number(row.activo) === 1 ? 1 : 0,
      nombre_subcategoria: row.nombre_subcategoria || '',
      nombre_categoria: row.nombre_categoria || '',
    });
    setModalOpen(true);
  };

  const handleToggle = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      if (next === 0) {
        await api.post(`/api/reglas-subcategorias/${row.id_subcategoria}/deactivate`);
      } else {
        await api.patch(`/api/reglas-subcategorias/${row.id_subcategoria}`, { activo: next });
      }
      await loadData();
      toast.success(next ? 'Activada' : 'Desactivada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Reglas de Subcategorías"
        subtitle={`${filtered.length} regla${filtered.length === 1 ? '' : 's'}`}
        actions={<Button onClick={openCreate}>Nueva regla</Button>}
      />

      <div className="reglas-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por subcategoría o categoría…" />
        </Card>

        {loading ? (
          <div className="reglas-page__state"><Spinner size={20} label="Cargando reglas…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⚙" title={search ? 'Sin resultados' : 'Sin reglas'}
            message={search ? 'Intenta con otro término.' : 'Crea reglas para controlar días de vida y alertas por subcategoría.'}
            action={!search ? <Button onClick={openCreate}>Crear regla</Button> : null} />
        ) : (
          <div className="reglas-page__list">
            {filtered.map((row) => (
              <DragItem key={row.id_subcategoria} row={row} onReorder={handleReorder}>
                <span className="reglas-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="reglas-page__item-info">
                  <div className="reglas-page__item-main">
                    <div className="reglas-page__item-head">
                      <span className="reglas-page__item-name">{row.nombre_subcategoria}</span>
                      <span className="reglas-page__item-cat">{row.nombre_categoria}</span>
                    </div>
                    <div className="reglas-page__item-meta">
                      {Number(row.max_dias_vida) > 0 && (
                        <span className="reglas-page__item-tag reglas-page__item-tag--life">
                          Máx {row.max_dias_vida} días
                        </span>
                      )}
                      {Number(row.dias_alerta_antes) > 0 && (
                        <span className="reglas-page__item-tag reglas-page__item-tag--alert">
                          Alerta {row.dias_alerta_antes} días antes
                        </span>
                      )}
                      {Number(row.max_dias_vida) === 0 && Number(row.dias_alerta_antes) === 0 && (
                        <span className="reglas-page__item-tag">Sin límite</span>
                      )}
                    </div>
                  </div>
                  <div className="reglas-page__item-end">
                    <span className={`reglas-page__item-badge ${Number(row.activo) === 1 ? 'reglas-page__item-badge--active' : 'reglas-page__item-badge--inactive'}`}>
                      {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
                <div className="reglas-page__item-actions">
                  <Button size="sm" variant={Number(row.activo) === 1 ? 'subtle' : 'ghost'} onClick={() => handleToggle(row)} title={Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}>
                    {Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title="Editar">✎</Button>
                </div>
              </DragItem>
            ))}
          </div>
        )}
      </div>

      <ReglaForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        editValues={editingValues}
        subcategorias={subcategorias}
        onSaved={loadData}
      />
    </>
  );
}
