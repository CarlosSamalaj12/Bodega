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
import './ProveedoresPage.scss';

const ORDER_KEY = 'prov-order-v1';

const EMPTY = {
  nombre_proveedor: '',
  telefono: '',
  direccion: '',
  activo: 1,
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
  const rowId = Number(row.id_proveedor);

  const handleDragStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => {
      ref.current?.classList.add('proveedores-page__item--dragging');
    });
  }, [rowId]);

  const handleDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const handleDragEnd = useCallback(() => { ref.current?.classList.remove('proveedores-page__item--dragging'); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="proveedores-page__item"
      onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDrop={handleDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function ProveedorForm({ open, onClose, editingId, editValues, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_proveedor || '').trim()) e.nombre_proveedor = 'Requerido';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = { ...vals, activo: Number(vals.activo) };
        if (editingId) {
          await api.patch(`/api/proveedores/${editingId}`, body);
          toast.success('Proveedor actualizado');
        } else {
          await api.post('/api/proveedores', body);
          toast.success('Proveedor creado');
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
      const src = editingId && editValues ? editValues : EMPTY;
      Object.entries(src).forEach(([k, v]) => set(k, v));
    }
  }, [open, editingId]);

  const fields = [
    { key: 'nombre_proveedor', label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej. Distribuidora XYZ' },
    { key: 'telefono', label: 'Teléfono', placeholder: 'Opcional' },
    { key: 'direccion', label: 'Dirección', placeholder: 'Opcional' },
  ];

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar proveedor' : 'Nuevo proveedor'}>
      <form onSubmit={handleSubmit} className="proveedores-page__form">
        {error && <div className="proveedores-page__form-error">{error}</div>}
        <div className="proveedores-page__form-grid">
          {fields.map((f) => (
            <div className="proveedores-page__field" key={f.key}>
              <label className="proveedores-page__label" htmlFor={`pf-${f.key}`}>
                {f.label}{f.required && <span className="proveedores-page__required"> *</span>}
              </label>
              <input id={`pf-${f.key}`} type={f.type || 'text'} className="input"
                value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder} autoFocus={f.autoFocus} />
              {errors[f.key] && <span className="proveedores-page__field-error">{errors[f.key]}</span>}
            </div>
          ))}
          <div className="proveedores-page__field">
            <label className="proveedores-page__label" htmlFor="pf-activo">Estado</label>
            <select id="pf-activo" className="select" value={values.activo ?? 1} onChange={(e) => set('activo', Number(e.target.value))}>
              <option value={1}>Activo</option>
              <option value={0}>Inactivo</option>
            </select>
          </div>
        </div>
        <div className="proveedores-page__form-footer">
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
export default function ProveedoresPage() {
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
      const data = await catalogosService.getProveedores();
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // ---- Orden ---- 
  const ordered = useMemo(() => {
    const order = loadOrder();
    const orderMap = new Map();
    order.forEach((id, i) => orderMap.set(id, i));
    const known = [], unknown = [];
    for (const item of items) {
      if (orderMap.has(Number(item.id_proveedor))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => orderMap.get(Number(a.id_proveedor)) - orderMap.get(Number(b.id_proveedor)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) =>
      [r.nombre_proveedor, r.telefono, r.direccion]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag reorder ----
  const handleReorder = useCallback((fromId, toId) => {
    setItems((prev) => {
      const next = [...prev];
      const fn = (r) => Number(r.id_proveedor);
      const fi = next.findIndex((r) => fn(r) === fromId);
      const ti = next.findIndex((r) => fn(r) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => fn(r)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => { setEditingId(null); setEditingValues(null); setModalOpen(true); };

  const openEdit = (row) => {
    setEditingId(Number(row.id_proveedor));
    setEditingValues({
      nombre_proveedor: row.nombre_proveedor || '',
      telefono: row.telefono || '',
      direccion: row.direccion || '',
      activo: Number(row.activo) === 1 ? 1 : 0,
    });
    setModalOpen(true);
  };

  const handleToggle = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await api.patch(`/api/proveedores/${row.id_proveedor}`, { activo: next });
      await fetchItems();
      toast.success(next ? 'Activado' : 'Desactivado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Proveedores"
        subtitle={`${items.length} proveedor${items.length === 1 ? '' : 'es'}`}
        actions={
          <Button onClick={openCreate}>Nuevo proveedor</Button>
        }
      />

      <div className="proveedores-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar proveedor…" />
        </Card>

        {loading ? (
          <div className="proveedores-page__state"><Spinner size={20} label="Cargando proveedores…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="◊" title={search ? 'Sin resultados' : 'Sin proveedores'}
            message={search ? 'Intenta con otro término.' : 'Agrega el primer proveedor.'}
            action={!search ? <Button onClick={openCreate}>Crear proveedor</Button> : null} />
        ) : (
          <div className="proveedores-page__list">
            {filtered.map((row) => (
              <DragItem key={row.id_proveedor} row={row} onReorder={handleReorder}>
                <span className="proveedores-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="proveedores-page__item-info">
                  <div className="proveedores-page__item-main">
                    <span className="proveedores-page__item-name">{row.nombre_proveedor}</span>
                    <span className="proveedores-page__item-meta">
                      {row.telefono && <span className="proveedores-page__item-tag">{row.telefono}</span>}
                      {row.direccion && <span className="proveedores-page__item-tag">{row.direccion}</span>}
                    </span>
                  </div>
                  <span className={`proveedores-page__item-badge ${Number(row.activo) === 1 ? 'proveedores-page__item-badge--active' : 'proveedores-page__item-badge--inactive'}`}>
                    {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="proveedores-page__item-actions">
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

      <ProveedorForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        editValues={editingValues}
        onSaved={fetchItems}
      />
    </>
  );
}
