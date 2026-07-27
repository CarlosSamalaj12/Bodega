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
import './LimitesPage.scss';

const ORDER_KEY = 'lim-order-v1';

function loadOrder() {
  try { const r = localStorage.getItem(ORDER_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
function saveOrder(keys) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch { /* */ }
}

const EMPTY = { id_bodega: '', id_producto: null, minimo: '', maximo: '', activo: 1 };

// Clave compuesta para ordenamiento
function itemKey(row) {
  return `${row.id_bodega}-${row.id_producto}`;
}

// ================== DragItem ==================
function DragItem({ row, children, onReorder }) {
  const ref = useRef(null);
  const key = itemKey(row);

  const onStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    requestAnimationFrame(() => ref.current?.classList.add('limites-page__item--dragging'));
  }, [key]);

  const onOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onEnd = useCallback(() => { ref.current?.classList.remove('limites-page__item--dragging'); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const fromKey = e.dataTransfer.getData('text/plain');
    if (fromKey && fromKey !== key) onReorder(fromKey, key);
  }, [key, onReorder]);

  return (
    <div ref={ref} draggable="true" className="limites-page__item"
      onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd} onDrop={onDrop}>
      {children}
    </div>
  );
}

// ================== Formulario ==================
function LimiteForm({ open, onClose, editingKey, editValues, bodegas, productos, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY,
    validate: (v) => {
      const e = {};
      if (!editingKey && !v.id_bodega) e.id_bodega = 'Selecciona una bodega';
      if (!editingKey && !v.id_producto) e.id_producto = 'Selecciona un producto';
      const min = Number(v.minimo);
      const max = Number(v.maximo);
      if (v.minimo !== '' && (isNaN(min) || min < 0)) e.minimo = 'Debe ser >= 0';
      if (v.maximo !== '' && (isNaN(max) || max < 0)) e.maximo = 'Debe ser >= 0';
      if (max > 0 && min > max) e.minimo = 'No puede ser mayor al máximo';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = {
          id_bodega: editingKey ? editingKey.id_bodega : Number(vals.id_bodega),
          id_producto: editingKey ? editingKey.id_producto : vals.id_producto,
          minimo: Math.max(0, Number(vals.minimo || 0)),
          maximo: Math.max(0, Number(vals.maximo || 0)),
          activo: Number(vals.activo),
        };
        if (editingKey) {
          await api.patch(`/api/limites/${editingKey.id_bodega}/${editingKey.id_producto}`, body);
          toast.success('Límite actualizado');
        } else {
          await api.post('/api/limites', body);
          toast.success('Límite creado');
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
      if (editingKey && editValues) {
        Object.entries(editValues).forEach(([k, v]) => set(k, v));
      } else {
        Object.entries(EMPTY).forEach(([k, v]) => set(k, v));
      }
    }
  }, [open, editingKey]);

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingKey ? 'Editar límite' : 'Nuevo límite'}>
      <form onSubmit={handleSubmit} className="limites-page__form">
        {error && <div className="limites-page__form-error">{error}</div>}
        <div className="limites-page__form-grid">
          {!editingKey ? (
            <>
              <div className="limites-page__field">
                <label className="limites-page__label" htmlFor="lim-bodega">Bodega <span className="limites-page__required">*</span></label>
                <select id="lim-bodega" className="select" value={values.id_bodega ?? ''}
                  onChange={(e) => set('id_bodega', e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {bodegas.map((b) => (
                    <option key={`lim-bod-${b.id_bodega}`} value={b.id_bodega}>{b.nombre_bodega}</option>
                  ))}
                </select>
                {errors.id_bodega && <span className="limites-page__field-error">{errors.id_bodega}</span>}
              </div>
              <div className="limites-page__field">
                <label className="limites-page__label" htmlFor="lim-producto">Producto <span className="limites-page__required">*</span></label>
                <select id="lim-producto" className="select" value={values.id_producto ?? ''}
                  onChange={(e) => set('id_producto', Number(e.target.value))}>
                  <option value="">Seleccionar…</option>
                  {productos.map((p) => (
                    <option key={`lim-${p.id_producto}`} value={p.id_producto}>
                      {p.nombre_producto}{p.sku ? ` (${p.sku})` : ''}
                    </option>
                  ))}
                </select>
                {errors.id_producto && <span className="limites-page__field-error">{errors.id_producto}</span>}
              </div>
            </>
          ) : (
            <div className="limites-page__field limites-page__field--full">
              <label className="limites-page__label">Bodega / Producto</label>
              <div className="limites-page__field-value">
                {editValues?.nombre_bodega} → {editValues?.nombre_producto}{editValues?.sku ? ` (${editValues.sku})` : ''}
              </div>
            </div>
          )}
          <div className="limites-page__field">
            <label className="limites-page__label" htmlFor="lim-min">Mínimo</label>
            <input id="lim-min" type="number" className="input" min="0" step="0.001"
              value={values.minimo ?? ''}
              onChange={(e) => set('minimo', e.target.value)}
              placeholder="0" />
            {errors.minimo && <span className="limites-page__field-error">{errors.minimo}</span>}
          </div>
          <div className="limites-page__field">
            <label className="limites-page__label" htmlFor="lim-max">Máximo</label>
            <input id="lim-max" type="number" className="input" min="0" step="0.001"
              value={values.maximo ?? ''}
              onChange={(e) => set('maximo', e.target.value)}
              placeholder="0 = sin límite" />
            {errors.maximo && <span className="limites-page__field-error">{errors.maximo}</span>}
          </div>
          <div className="limites-page__field">
            <label className="limites-page__label" htmlFor="lim-activo">Estado</label>
            <select id="lim-activo" className="select" value={values.activo ?? 1}
              onChange={(e) => set('activo', Number(e.target.value))}>
              <option value={1}>Activo</option>
              <option value={0}>Inactivo</option>
            </select>
          </div>
        </div>
        <div className="limites-page__form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? <Spinner size={14} /> : editingKey ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ================== PAGE ==================
export default function LimitesPage() {
  const [items, setItems] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editingValues, setEditingValues] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [lims, bgs, prods] = await Promise.all([
        api.get('/api/limites?all=1').then((r) => r.data || []),
        catalogosService.getBodegas(),
        api.get('/api/productos?all=1&limit=5000').then((r) => r.data || []),
      ]);
      setItems(Array.isArray(lims) ? lims : []);
      setBodegas(Array.isArray(bgs) ? bgs : []);
      setProductos(Array.isArray(prods) ? prods : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Orden ----
  const ordered = useMemo(() => {
    const order = loadOrder();
    const map = new Map();
    order.forEach((k, i) => map.set(k, i));
    const known = [], unknown = [];
    for (const item of items) {
      const k = itemKey(item);
      if (map.has(k)) known.push(item);
      else unknown.push(item);
    }
    known.sort((a, b) => map.get(itemKey(a)) - map.get(itemKey(b)));
    return [...known, ...unknown];
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return ordered;
    const q = debouncedSearch.toLowerCase();
    return ordered.filter((r) =>
      [r.nombre_bodega, r.nombre_producto, r.sku].some(
        (v) => v && String(v).toLowerCase().includes(q)
      )
    );
  }, [ordered, debouncedSearch]);

  // ---- Drag ----
  const handleReorder = useCallback((fromKey, toKey) => {
    setItems((prev) => {
      const next = [...prev];
      const fi = next.findIndex((r) => itemKey(r) === fromKey);
      const ti = next.findIndex((r) => itemKey(r) === toKey);
      if (fi === -1 || ti === -1) return prev;
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      saveOrder(next.map((r) => itemKey(r)));
      return next;
    });
  }, []);

  // ---- CRUD ----
  const openCreate = () => {
    setEditingKey(null);
    setEditingValues(null);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditingKey({ id_bodega: Number(row.id_bodega), id_producto: Number(row.id_producto) });
    setEditingValues({
      minimo: row.minimo ?? '',
      maximo: row.maximo ?? '',
      activo: Number(row.activo) === 1 ? 1 : 0,
      nombre_bodega: row.nombre_bodega || '',
      nombre_producto: row.nombre_producto || '',
      sku: row.sku || '',
    });
    setModalOpen(true);
  };

  const handleToggle = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      if (next === 0) {
        await api.post(`/api/limites/${row.id_bodega}/${row.id_producto}/deactivate`);
      } else {
        await api.patch(`/api/limites/${row.id_bodega}/${row.id_producto}`, { activo: next });
      }
      await loadData();
      toast.success(next ? 'Activado' : 'Desactivado');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Límites Mínimos/Máximos"
        subtitle={`${filtered.length} límite${filtered.length === 1 ? '' : 's'}`}
        actions={<Button onClick={openCreate}>Nuevo límite</Button>}
      />

      <div className="limites-page">
        <Card>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por bodega, producto o SKU…" />
        </Card>

        {loading ? (
          <div className="limites-page__state"><Spinner size={20} label="Cargando límites…" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⊟" title={search ? 'Sin resultados' : 'Sin límites'}
            message={search ? 'Intenta con otro término.' : 'Configura límites mínimos y máximos de stock por producto y bodega.'}
            action={!search ? <Button onClick={openCreate}>Crear límite</Button> : null} />
        ) : (
          <div className="limites-page__list">
            {filtered.map((row) => (
              <DragItem key={itemKey(row)} row={row} onReorder={handleReorder}>
                <span className="limites-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
                <div className="limites-page__item-info">
                  <div className="limites-page__item-main">
                    <div className="limites-page__item-head">
                      <span className="limites-page__item-name">{row.nombre_producto}</span>
                      {row.sku && <code className="limites-page__item-sku">{row.sku}</code>}
                    </div>
                    <div className="limites-page__item-meta">
                      <span className="limites-page__item-tag">{row.nombre_bodega}</span>
                      <span className="limites-page__item-tag limites-page__item-tag--min">
                        Mín: {Number(row.minimo).toFixed(2)}
                      </span>
                      <span className="limites-page__item-tag limites-page__item-tag--max">
                        Máx: {Number(row.maximo).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="limites-page__item-end">
                    <span className={`limites-page__item-badge ${Number(row.activo) === 1 ? 'limites-page__item-badge--active' : 'limites-page__item-badge--inactive'}`}>
                      {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
                <div className="limites-page__item-actions">
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

      <LimiteForm
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editingKey={editingKey}
        editValues={editingValues}
        bodegas={bodegas}
        productos={productos}
        onSaved={loadData}
      />
    </>
  );
}
