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
import './BodegasPage.scss';

const ORDER_KEY = 'bod-order-v1';

const TIPO_OPTS = [
  { value: 'PRINCIPAL', label: 'Principal' },
  { value: 'RECEPTORA', label: 'Receptora' },
  { value: 'OPERATIVA', label: 'Operativa' },
];

const EMPTY = { nombre_bodega: '', tipo_bodega: 'OPERATIVA', telefono_contacto: '', direccion_contacto: '', activo: 1 };

const TIPO_VARIANTS = {
  PRINCIPAL: 'primary',
  RECEPTORA: 'info',
  OPERATIVA: 'warning',
};

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
  const rowId = Number(row.id_bodega);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('bodegas-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('bodegas-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="bodegas-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function BodegaForm({ open, onClose, editingId, editValues, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_bodega || '').trim()) e.nombre_bodega = 'Requerido';
      if (!v.tipo_bodega) e.tipo_bodega = 'Selecciona un tipo';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = {
          nombre_bodega: vals.nombre_bodega,
          tipo_bodega: vals.tipo_bodega,
          activo: Number(vals.activo),
          telefono_contacto: vals.telefono_contacto || null,
          direccion_contacto: vals.direccion_contacto || null,
        };
        if (editingId) {
          await api.patch(`/api/bodegas/${editingId}`, body);
          toast.success('Bodega actualizada');
        } else {
          await api.post('/api/bodegas', body);
          toast.success('Bodega creada');
        }
        onSaved();
        onClose();
      } catch (e) {
        setError(e?.response?.data?.error || 'Error al guardar');
      } finally { setSubmitting(false); }
    },
  });

  useEffect(() => {
    if (open && editingId && editValues) {
      Object.entries(editValues).forEach(([k, v]) => set(k, v));
    } else if (open) {
      Object.entries(EMPTY).forEach(([k, v]) => set(k, v));
    }
  }, [open, editingId]);

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar bodega' : 'Nueva bodega'}>
      <form onSubmit={handleSubmit} className="bodegas-page__form">
        {error && <div className="bodegas-page__form-error">{error}</div>}
        <div className="bodegas-page__form-grid">
          <div className="bodegas-page__field">
            <label className="bodegas-page__label" htmlFor="bod-nombre">Nombre <span className="bodegas-page__required">*</span></label>
            <input id="bod-nombre" className="input" value={values.nombre_bodega ?? ''}
              onChange={(e) => set('nombre_bodega', e.target.value)} placeholder="Ej. Bodega Central" autoFocus />
            {errors.nombre_bodega && <span className="bodegas-page__field-error">{errors.nombre_bodega}</span>}
          </div>
          <div className="bodegas-page__field">
            <label className="bodegas-page__label" htmlFor="bod-tipo">Tipo <span className="bodegas-page__required">*</span></label>
            <select id="bod-tipo" className="select" value={values.tipo_bodega ?? 'OPERATIVA'} onChange={(e) => set('tipo_bodega', e.target.value)}>
              {TIPO_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            {errors.tipo_bodega && <span className="bodegas-page__field-error">{errors.tipo_bodega}</span>}
          </div>
          <div className="bodegas-page__field">
            <label className="bodegas-page__label" htmlFor="bod-tel">Teléfono</label>
            <input id="bod-tel" className="input" value={values.telefono_contacto ?? ''}
              onChange={(e) => set('telefono_contacto', e.target.value)} placeholder="Opcional" />
          </div>
          <div className="bodegas-page__field">
            <label className="bodegas-page__label" htmlFor="bod-dir">Dirección</label>
            <input id="bod-dir" className="input" value={values.direccion_contacto ?? ''}
              onChange={(e) => set('direccion_contacto', e.target.value)} placeholder="Opcional" />
          </div>
          <div className="bodegas-page__field">
            <label className="bodegas-page__label" htmlFor="bod-activo">Estado</label>
            <select id="bod-activo" className="select" value={values.activo ?? 1} onChange={(e) => set('activo', Number(e.target.value))}>
              <option value={1}>Activo</option>
              <option value={0}>Inactivo</option>
            </select>
          </div>
        </div>
        <div className="bodegas-page__form-footer">
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
export default function BodegasPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalogosService.getBodegas();
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // ---- Orden ----
  const ordered = useMemo(() => {
    const order = loadOrder();
    const map = new Map();
    order.forEach((id, i) => map.set(id, i));
    const known = [], unknown = [];
    for (const item of items) {
      if (map.has(Number(item.id_bodega))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_bodega)) - map.get(Number(b.id_bodega)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) =>
      [r.nombre_bodega, r.tipo_bodega, r.direccion_contacto, r.telefono_contacto]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag ----
  const handleReorder = useCallback((fromId, toId) => {
    setItems((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_bodega) === fromId);
      const ti = next.findIndex((r) => Number(r.id_bodega) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_bodega)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => { setEditingId(null); setEditingValues(null); setModalOpen(true); };
  const openEdit = (row) => {
    setEditingId(Number(row.id_bodega));
    setEditingValues({
      nombre_bodega: row.nombre_bodega || '',
      tipo_bodega: row.tipo_bodega || 'OPERATIVA',
      telefono_contacto: row.telefono_contacto || '',
      direccion_contacto: row.direccion_contacto || '',
      activo: Number(row.activo) === 1 ? 1 : 0,
    });
    setModalOpen(true);
  };

  const handleToggle = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await api.patch(`/api/bodegas/${row.id_bodega}`, { activo: next });
      await fetchItems();
      toast.success(next ? 'Activada' : 'Desactivada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Bodegas"
        subtitle={`${items.length} bodega${items.length === 1 ? '' : 's'}`}
        actions={<Button onClick={openCreate}>Nueva bodega</Button>}
      />

      <div className="bodegas-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar bodega…" />
        </Card>

        {loading ? (
          <div className="bodegas-page__state"><Spinner size={20} label="Cargando bodegas…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⬚" title={search ? 'Sin resultados' : 'Sin bodegas'}
            message={search ? 'Intenta con otro término.' : 'Agrega la primera bodega.'}
            action={!search ? <Button onClick={openCreate}>Crear bodega</Button> : null} />
        ) : (
          <div className="bodegas-page__list">
            {filtered.map((row) => (
              <DragItem key={row.id_bodega} row={row} onReorder={handleReorder}>
                <span className="bodegas-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="bodegas-page__item-info">
                  <div className="bodegas-page__item-main">
                    <span className="bodegas-page__item-name">{row.nombre_bodega}</span>
                    <span className="bodegas-page__item-meta">
                      {row.telefono_contacto && <span className="bodegas-page__item-tag">{row.telefono_contacto}</span>}
                      {row.direccion_contacto && <span className="bodegas-page__item-tag">{row.direccion_contacto}</span>}
                    </span>
                  </div>
                  <span className={`bodegas-page__item-tipo bodegas-page__item-tipo--${(TIPO_VARIANTS[row.tipo_bodega] || 'info')}`}>
                    {row.tipo_bodega}
                  </span>
                  <span className={`bodegas-page__item-badge ${Number(row.activo) === 1 ? 'bodegas-page__item-badge--active' : 'bodegas-page__item-badge--inactive'}`}>
                    {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="bodegas-page__item-actions">
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

      <BodegaForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        editValues={editingValues}
        onSaved={fetchItems}
      />
    </>
  );
}
