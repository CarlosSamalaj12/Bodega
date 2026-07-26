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
import './MedidasPage.scss';

const ORDER_KEY = 'med-order-v1';

const EMPTY = { nombre_medida: '' };

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
  const rowId = Number(row.id_medida);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => ref.current?.classList.add('medidas-page__item--dragging'));
  }, [rowId]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('medidas-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id && id !== rowId) onReorder(id, rowId);
  }, [rowId, onReorder]);

  return (
    <div ref={ref} draggable="true" className="medidas-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function MedidaForm({ open, onClose, editingId, editValues, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_medida || '').trim()) e.nombre_medida = 'Requerido';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        if (editingId) {
          await api.patch(`/api/medidas/${editingId}`, vals);
          toast.success('Medida actualizada');
        } else {
          await api.post('/api/medidas', vals);
          toast.success('Medida creada');
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
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar medida' : 'Nueva medida'}>
      <form onSubmit={handleSubmit} className="medidas-page__form">
        {error && <div className="medidas-page__form-error">{error}</div>}
        <div className="medidas-page__field">
          <label className="medidas-page__label" htmlFor="med-nombre">Nombre <span className="medidas-page__required">*</span></label>
          <input id="med-nombre" className="input" value={values.nombre_medida ?? ''}
            onChange={(e) => set('nombre_medida', e.target.value)} placeholder="Ej. Kilogramo" autoFocus />
          {errors.nombre_medida && <span className="medidas-page__field-error">{errors.nombre_medida}</span>}
        </div>
        <div className="medidas-page__form-footer">
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
export default function MedidasPage() {
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
      const data = await catalogosService.getMedidas();
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
      if (map.has(Number(item.id_medida))) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(Number(a.id_medida)) - map.get(Number(b.id_medida)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) => String(r.nombre_medida || '').toLowerCase().includes(q));
  }, [ordered, debouncedSearch]);

  // ---- Drag ----
  const handleReorder = useCallback((fromId, toId) => {
    setItems((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => Number(r.id_medida) === fromId);
      const ti = next.findIndex((r) => Number(r.id_medida) === toId);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => Number(r.id_medida)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => { setEditingId(null); setEditingValues(null); setModalOpen(true); };
  const openEdit = (row) => {
    setEditingId(Number(row.id_medida));
    setEditingValues({ nombre_medida: row.nombre_medida || '' });
    setModalOpen(true);
  };

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Medidas"
        subtitle={`${items.length} medida${items.length === 1 ? '' : 's'}`}
        actions={<Button onClick={openCreate}>Nueva medida</Button>}
      />

      <div className="medidas-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar medida…" />
        </Card>

        {loading ? (
          <div className="medidas-page__state"><Spinner size={20} label="Cargando medidas…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⊟" title={search ? 'Sin resultados' : 'Sin medidas'}
            message={search ? 'Intenta con otro término.' : 'Agrega la primera medida.'}
            action={!search ? <Button onClick={openCreate}>Crear medida</Button> : null} />
        ) : (
          <div className="medidas-page__list">
            {filtered.map((row) => (
              <DragItem key={row.id_medida} row={row} onReorder={handleReorder}>
                <span className="medidas-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <span className="medidas-page__item-name">{row.nombre_medida}</span>
                <div className="medidas-page__item-actions">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title="Editar">✎</Button>
                </div>
              </DragItem>
            ))}
          </div>
        )}
      </div>

      <MedidaForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingId={editingId}
        editValues={editingValues}
        onSaved={fetchItems}
      />
    </>
  );
}
