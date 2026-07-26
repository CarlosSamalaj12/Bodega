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
import './MotivosPage.scss';

const ORDER_KEY = 'mot-order-v1';

const TIPO_OPTS = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'SALIDA', label: 'Salida' },
  { value: 'AJUSTE', label: 'Ajuste' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
];

const TIPO_COLORS = {
  ENTRADA: 'success',
  SALIDA: 'danger',
  AJUSTE: 'warning',
  TRANSFERENCIA: 'info',
};

const EMPTY = { nombre_motivo: '', tipo_movimiento: 'ENTRADA', activo: 1 };

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
  const rowId = Number(row.id_motivo);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('motivos-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('motivos-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="motivos-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function MotivoForm({ open, onClose, editingId, editValues, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_motivo || '').trim()) e.nombre_motivo = 'Requerido';
      if (!v.tipo_movimiento) e.tipo_movimiento = 'Selecciona un tipo';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = { ...vals, activo: Number(vals.activo) };
        if (editingId) {
          await api.patch(`/api/motivos/${editingId}`, body);
          toast.success('Motivo actualizado');
        } else {
          await api.post('/api/motivos', body);
          toast.success('Motivo creado');
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
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar motivo' : 'Nuevo motivo'}>
      <form onSubmit={handleSubmit} className="motivos-page__form">
        {error && <div className="motivos-page__form-error">{error}</div>}
        <div className="motivos-page__field">
          <label className="motivos-page__label" htmlFor="mot-nombre">Nombre <span className="motivos-page__required">*</span></label>
          <input id="mot-nombre" className="input" value={values.nombre_motivo ?? ''}
            onChange={(e) => set('nombre_motivo', e.target.value)} placeholder="Ej. Compra a proveedor" autoFocus />
          {errors.nombre_motivo && <span className="motivos-page__field-error">{errors.nombre_motivo}</span>}
        </div>
        <div className="motivos-page__field">
          <label className="motivos-page__label" htmlFor="mot-tipo">Tipo de movimiento <span className="motivos-page__required">*</span></label>
          <select id="mot-tipo" className="select" value={values.tipo_movimiento ?? 'ENTRADA'} onChange={(e) => set('tipo_movimiento', e.target.value)}>
            {TIPO_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          {errors.tipo_movimiento && <span className="motivos-page__field-error">{errors.tipo_movimiento}</span>}
        </div>
        <div className="motivos-page__field">
          <label className="motivos-page__label" htmlFor="mot-activo">Estado</label>
          <select id="mot-activo" className="select" value={values.activo ?? 1} onChange={(e) => set('activo', Number(e.target.value))}>
            <option value={1}>Activo</option>
            <option value={0}>Inactivo</option>
          </select>
        </div>
        <div className="motivos-page__form-footer">
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
export default function MotivosPage() {
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
      const data = await catalogosService.getMotivos();
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
      if (map.has(Number(item.id_motivo))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_motivo)) - map.get(Number(b.id_motivo)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) =>
      [r.nombre_motivo, r.tipo_movimiento].some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag ----
  const handleReorder = useCallback((fromId, toId) => {
    setItems((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_motivo) === fromId);
      const ti = next.findIndex((r) => Number(r.id_motivo) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_motivo)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => { setEditingId(null); setEditingValues(null); setModalOpen(true); };
  const openEdit = (row) => {
    setEditingId(Number(row.id_motivo));
    setEditingValues({
      nombre_motivo: row.nombre_motivo || '',
      tipo_movimiento: row.tipo_movimiento || 'ENTRADA',
      activo: Number(row.activo) === 1 ? 1 : 0,
    });
    setModalOpen(true);
  };

  const handleToggle = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await api.patch(`/api/motivos/${row.id_motivo}`, { activo: next });
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
        title="Motivos de movimiento"
        subtitle={`${items.length} motivo${items.length === 1 ? '' : 's'}`}
        actions={<Button onClick={openCreate}>Nuevo motivo</Button>}
      />

      <div className="motivos-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar motivo…" />
        </Card>

        {loading ? (
          <div className="motivos-page__state"><Spinner size={20} label="Cargando motivos…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="◐" title={search ? 'Sin resultados' : 'Sin motivos'}
            message={search ? 'Intenta con otro término.' : 'Agrega el primer motivo.'}
            action={!search ? <Button onClick={openCreate}>Crear motivo</Button> : null} />
        ) : (
          <div className="motivos-page__list">
            {filtered.map((row) => (
              <DragItem key={row.id_motivo} row={row} onReorder={handleReorder}>
                <span className="motivos-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="motivos-page__item-info">
                  <span className="motivos-page__item-name">{row.nombre_motivo}</span>
                  <span className={`motivos-page__item-tipo motivos-page__item-tipo--${TIPO_COLORS[row.tipo_movimiento] || 'info'}`}>
                    {row.tipo_movimiento}
                  </span>
                  <span className={`motivos-page__item-badge ${Number(row.activo) === 1 ? 'motivos-page__item-badge--active' : 'motivos-page__item-badge--inactive'}`}>
                    {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="motivos-page__item-actions">
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

      <MotivoForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        editValues={editingValues}
        onSaved={fetchItems}
      />
    </>
  );
}
