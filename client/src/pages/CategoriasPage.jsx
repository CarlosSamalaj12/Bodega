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
import './CategoriasPage.scss';

const ID_KEYS = ['id', 'id_categoria', 'id_subcategoria'];
const ORDER_KEY_CAT = 'cat-order-v2';
const ORDER_KEY_SUB = 'sub-order-v2';

function getRowId(row) {
  for (const k of ID_KEYS) if (row?.[k] != null) return row[k];
  return null;
}

const EMPTY_CAT = { nombre_categoria: '', activo: 1 };
const EMPTY_SUB = { nombre_subcategoria: '', id_categoria: '', activo: 1 };

// ---- Helpers de orden persistente ----
function loadOrder(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveOrder(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
}

/**
 * Ordena items según orden guardado. Los items no listados van al final en su orden original.
 */
function sortByOrder(items, order, getId) {
  const orderMap = new Map();
  order.forEach((id, i) => orderMap.set(id, i));
  const known = [];
  const unknown = [];
  for (const item of items) {
    const id = getId(item);
    if (orderMap.has(id)) known.push(item);
    else unknown.push(item);
  }
  known.sort((a, b) => orderMap.get(getId(a)) - orderMap.get(getId(b)));
  return [...known, ...unknown];
}

// ---------- Formulario Categoría ----------
function CategoriaForm({ open, onClose, editingId, catValues, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY_CAT,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_categoria || '').trim()) e.nombre_categoria = 'Requerido';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        if (editingId) {
          await api.patch(`/api/categorias/${editingId}`, vals);
          toast.success('Categoría actualizada');
        } else {
          await api.post('/api/categorias', vals);
          toast.success('Categoría creada');
        }
        onSaved();
        onClose();
      } catch (e) {
        setError(e?.response?.data?.error || 'Error al guardar');
      } finally {
        setSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (open && editingId) {
      Object.entries(catValues || {}).forEach(([k, v]) => set(k, v));
    } else if (open) {
      Object.entries(EMPTY_CAT).forEach(([k, v]) => set(k, v));
    }
  }, [open, editingId]);

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar categoría' : 'Nueva categoría'}>
      <form onSubmit={handleSubmit} className="categorias-page__form">
        {error && <div className="categorias-page__form-error">{error}</div>}
        <div className="categorias-page__field">
          <label className="categorias-page__label" htmlFor="cat-nombre">Nombre <span className="categorias-page__required">*</span></label>
          <input id="cat-nombre" className="input" value={values.nombre_categoria ?? ''} onChange={(e) => set('nombre_categoria', e.target.value)} placeholder="Ej. Bebidas" autoFocus />
          {errors.nombre_categoria && <span className="categorias-page__field-error">{errors.nombre_categoria}</span>}
        </div>
        <div className="categorias-page__field">
          <label className="categorias-page__label" htmlFor="cat-activo">Estado</label>
          <select id="cat-activo" className="select" value={values.activo ?? 1} onChange={(e) => set('activo', Number(e.target.value))}>
            <option value={1}>Activo</option>
            <option value={0}>Inactivo</option>
          </select>
        </div>
        <div className="categorias-page__form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? <Spinner size={14} /> : editingId ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Formulario Subcategoría ----------
function SubcategoriaForm({ open, onClose, editingId, subValues, categorias, onSaved }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const { values, set, errors, handleSubmit } = useForm({
    initial: EMPTY_SUB,
    validate: (v) => {
      const e = {};
      if (!String(v.nombre_subcategoria || '').trim()) e.nombre_subcategoria = 'Requerido';
      if (!v.id_categoria) e.id_categoria = 'Selecciona una categoría';
      return e;
    },
    onSubmit: async (vals) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = { nombre_subcategoria: vals.nombre_subcategoria, id_categoria: Number(vals.id_categoria), activo: Number(vals.activo) };
        if (editingId) {
          await api.patch(`/api/subcategorias/${editingId}`, body);
          toast.success('Subcategoría actualizada');
        } else {
          await api.post('/api/subcategorias', body);
          toast.success('Subcategoría creada');
        }
        onSaved();
        onClose();
      } catch (e) {
        setError(e?.response?.data?.error || 'Error al guardar');
      } finally {
        setSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (open && editingId) {
      Object.entries(subValues || {}).forEach(([k, v]) => set(k, v));
    } else if (open) {
      Object.entries(EMPTY_SUB).forEach(([k, v]) => set(k, v));
    }
  }, [open, editingId]);

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={editingId ? 'Editar subcategoría' : 'Nueva subcategoría'}>
      <form onSubmit={handleSubmit} className="categorias-page__form">
        {error && <div className="categorias-page__form-error">{error}</div>}
        <div className="categorias-page__field">
          <label className="categorias-page__label" htmlFor="sub-nombre">Nombre <span className="categorias-page__required">*</span></label>
          <input id="sub-nombre" className="input" value={values.nombre_subcategoria ?? ''} onChange={(e) => set('nombre_subcategoria', e.target.value)} placeholder="Ej. Agua mineral" autoFocus />
          {errors.nombre_subcategoria && <span className="categorias-page__field-error">{errors.nombre_subcategoria}</span>}
        </div>
        <div className="categorias-page__field">
          <label className="categorias-page__label" htmlFor="sub-categoria">Categoría <span className="categorias-page__required">*</span></label>
          <select id="sub-categoria" className="select" value={values.id_categoria ?? ''} onChange={(e) => set('id_categoria', e.target.value)}>
            <option value="">Seleccionar…</option>
            {categorias.map((c) => <option key={`cat-cat-${c.id_categoria}`} value={c.id_categoria}>{c.nombre_categoria}</option>)}
          </select>
          {errors.id_categoria && <span className="categorias-page__field-error">{errors.id_categoria}</span>}
        </div>
        <div className="categorias-page__field">
          <label className="categorias-page__label" htmlFor="sub-activo">Estado</label>
          <select id="sub-activo" className="select" value={values.activo ?? 1} onChange={(e) => set('activo', Number(e.target.value))}>
            <option value={1}>Activo</option>
            <option value={0}>Inactivo</option>
          </select>
        </div>
        <div className="categorias-page__form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? <Spinner size={14} /> : editingId ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ================== DragItem ==================
function DragItem({ row, children, onReorder, listKey }) {
  const dragRef = useRef(null);
  const rowId = getRowId(row);

  const handleDragStart = useCallback((e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rowId));
    requestAnimationFrame(() => {
      if (dragRef.current) dragRef.current.classList.add('categorias-page__item--dragging');
    });
  }, [rowId]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragRef.current) dragRef.current.classList.remove('categorias-page__item--dragging');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    if (draggedId && draggedId !== rowId) {
      onReorder(listKey, draggedId, rowId);
    }
  }, [rowId, onReorder, listKey]);

  return (
    <div
      ref={dragRef}
      draggable="true"
      className="categorias-page__item"
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

// ================== PAGE ==================
export default function CategoriasPage() {
  // ---- Categorías ----
  const [catItems, setCatItems] = useState([]);
  const [catLoading, setCatLoading] = useState(true);
  const [catSearch, setCatSearch] = useState('');
  const debouncedCatSearch = useDebounce(catSearch, 300);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditingId, setCatEditingId] = useState(null);
  const [catEditingValues, setCatEditingValues] = useState(null);

  const fetchCategorias = useCallback(async () => {
    setCatLoading(true);
    try {
      const data = await catalogosService.getCategorias();
      setCatItems(Array.isArray(data) ? data : []);
    } catch { setCatItems([]); }
    finally { setCatLoading(false); }
  }, []);

  useEffect(() => { fetchCategorias(); }, [fetchCategorias]);

  // ---- Subcategorías ----
  const [subItems, setSubItems] = useState([]);
  const [subLoading, setSubLoading] = useState(true);
  const [subSearch, setSubSearch] = useState('');
  const debouncedSubSearch = useDebounce(subSearch, 300);
  const [subCategoriaId, setSubCategoriaId] = useState(null);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subEditingId, setSubEditingId] = useState(null);
  const [subEditingValues, setSubEditingValues] = useState(null);

  const fetchSubcategorias = useCallback(async () => {
    setSubLoading(true);
    try {
      const data = await catalogosService.getSubcategorias();
      setSubItems(Array.isArray(data) ? data : []);
    } catch { setSubItems([]); }
    finally { setSubLoading(false); }
  }, []);

  useEffect(() => { fetchSubcategorias(); }, [fetchSubcategorias]);

  // ---- Drag & Drop reorder ----
  const handleReorder = useCallback((key, draggedId, targetId) => {
    const KEYS  = { cat: ORDER_KEY_CAT, sub: ORDER_KEY_SUB };
    const ID_FN = { cat: (r) => Number(r.id_categoria), sub: (r) => Number(r.id_subcategoria) };

    const setter = key === 'cat' ? setCatItems : setSubItems;
    setter((prev) => {
      const next = [...prev];
      const fn = ID_FN[key];
      const fromIdx = next.findIndex((r) => fn(r) === draggedId);
      const toIdx   = next.findIndex((r) => fn(r) === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      saveOrder(KEYS[key], next.map((r) => fn(r)));
      return next;
    });
  }, []);

  // ---- Aplicar orden guardado a los items filtrados ----
  const catOrdered = useMemo(() => {
    const order = loadOrder(ORDER_KEY_CAT);
    const getId = (r) => Number(r.id_categoria);
    return sortByOrder(catItems, order, getId);
  }, [catItems]);

  const filteredCat = useMemo(() => {
    if (!debouncedCatSearch) return catOrdered;
    const q = debouncedCatSearch.toLowerCase();
    return catOrdered.filter((r) => String(r.nombre_categoria || '').toLowerCase().includes(q));
  }, [catOrdered, debouncedCatSearch]);

  const subOrdered = useMemo(() => {
    const order = loadOrder(ORDER_KEY_SUB);
    const getId = (r) => Number(r.id_subcategoria);
    return sortByOrder(subItems, order, getId);
  }, [subItems]);

  const filteredSub = useMemo(() => {
    let result = subOrdered;
    if (subCategoriaId) result = result.filter((r) => Number(r.id_categoria) === subCategoriaId);
    if (debouncedSubSearch) {
      const q = debouncedSubSearch.toLowerCase();
      result = result.filter((r) =>
        String(r.nombre_subcategoria || '').toLowerCase().includes(q) ||
        String(r.nombre_categoria || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [subOrdered, subCategoriaId, debouncedSubSearch]);

  // ---- CRUD handlers ----
  const openCatCreate = () => {
    setCatEditingId(null);
    setCatEditingValues(null);
    setCatModalOpen(true);
  };

  const openCatEdit = (row) => {
    setCatEditingId(getRowId(row));
    setCatEditingValues({ nombre_categoria: row.nombre_categoria || '', activo: Number(row.activo) === 1 ? 1 : 0 });
    setCatModalOpen(true);
  };

  const handleDeleteCat = async (row) => {
    if (!window.confirm(`¿Eliminar la categoría "${row.nombre_categoria}"?`)) return;
    try {
      await api.delete(`/api/categorias/${getRowId(row)}`);
      await fetchCategorias();
      toast.success('Categoría eliminada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo eliminar');
    }
  };

  const handleToggleCat = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await api.patch(`/api/categorias/${getRowId(row)}`, { activo: next });
      await fetchCategorias();
      toast.success(next ? 'Activada' : 'Desactivada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  const openSubCreate = () => {
    setSubEditingId(null);
    setSubEditingValues(null);
    setSubModalOpen(true);
  };

  const openSubEdit = (row) => {
    setSubEditingId(getRowId(row));
    setSubEditingValues({
      nombre_subcategoria: row.nombre_subcategoria || '',
      id_categoria: row.id_categoria || '',
      activo: Number(row.activo) === 1 ? 1 : 0,
    });
    setSubModalOpen(true);
  };

  const handleDeleteSub = async (row) => {
    if (!window.confirm(`¿Eliminar la subcategoría "${row.nombre_subcategoria}"?`)) return;
    try {
      await api.delete(`/api/subcategorias/${getRowId(row)}`);
      await fetchSubcategorias();
      toast.success('Subcategoría eliminada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'No se pudo eliminar');
    }
  };

  const handleToggleSub = async (row) => {
    const next = Number(row.activo) === 1 ? 0 : 1;
    try {
      await api.patch(`/api/subcategorias/${getRowId(row)}`, { activo: next });
      await fetchSubcategorias();
      toast.success(next ? 'Activada' : 'Desactivada');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Error');
    }
  };

  // ---- Mapa de conteo ----
  const subCountByCat = useMemo(() => {
    const map = {};
    for (const s of subItems) {
      const id = Number(s.id_categoria);
      map[id] = (map[id] || 0) + 1;
    }
    return map;
  }, [subItems]);

  const handleCatSaved = () => { fetchCategorias(); fetchSubcategorias(); };
  const handleSubSaved = () => { fetchSubcategorias(); };

  // ---- Render helpers para items ----
  const handleFilterByCat = useCallback((catId) => {
    setSubCategoriaId(catId);
  }, []);

  const renderCatItem = (row, index) => {
    const catId = Number(row.id_categoria);
    const isActiveFilter = subCategoriaId === catId;
    return (
      <DragItem key={getRowId(row)} row={row} index={index} onReorder={handleReorder} listKey="cat">
        <span className="categorias-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
        <div className="categorias-page__item-info">
          <span className="categorias-page__item-name">{row.nombre_categoria}</span>
          <span
            className={`categorias-page__sub-count ${isActiveFilter ? 'categorias-page__sub-count--active' : ''}`}
            title="Filtrar subcategorías"
            onClick={(e) => { e.stopPropagation(); handleFilterByCat(isActiveFilter ? null : catId); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFilterByCat(isActiveFilter ? null : catId); } }}
          >
            {subCountByCat[catId] || 0}
          </span>
          <span className={`categorias-page__item-badge ${Number(row.activo) === 1 ? 'categorias-page__item-badge--active' : 'categorias-page__item-badge--inactive'}`}>
            {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <div className="categorias-page__item-actions">
          <Button size="sm" variant={Number(row.activo) === 1 ? 'subtle' : 'ghost'} onClick={() => handleToggleCat(row)} title={Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}>
            {Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openCatEdit(row)} title="Editar">✎</Button>
          <Button size="sm" variant="ghost" onClick={() => handleDeleteCat(row)} title="Eliminar">✕</Button>
        </div>
      </DragItem>
    );
  };

  const renderSubItem = (row, index) => (
    <DragItem key={getRowId(row)} row={row} index={index} onReorder={handleReorder} listKey="sub">
      <span className="categorias-page__drag-handle" title="Arrastrar para reordenar">⠿</span>
      <div className="categorias-page__item-info">
        <span className="categorias-page__item-name">{row.nombre_subcategoria}</span>
        <span className="categorias-page__item-sub">{row.nombre_categoria}</span>
        <span className={`categorias-page__item-badge ${Number(row.activo) === 1 ? 'categorias-page__item-badge--active' : 'categorias-page__item-badge--inactive'}`}>
          {Number(row.activo) === 1 ? 'Activo' : 'Inactivo'}
        </span>
      </div>
      <div className="categorias-page__item-actions">
        <Button size="sm" variant={Number(row.activo) === 1 ? 'subtle' : 'ghost'} onClick={() => handleToggleSub(row)} title={Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}>
          {Number(row.activo) === 1 ? 'Desactivar' : 'Activar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openSubEdit(row)} title="Editar">✎</Button>
        <Button size="sm" variant="ghost" onClick={() => handleDeleteSub(row)} title="Eliminar">✕</Button>
      </div>
    </DragItem>
  );

  // ================== RENDER ==================
  return (
    <>
      <Header
        title="Categorías y Subcategorías"
        subtitle={`${catItems.length} categoría${catItems.length === 1 ? '' : 's'} · ${subItems.length} subcategoría${subItems.length === 1 ? '' : 's'}`}
      />

      <div className="categorias-page">
        {/* ===== Panel de Categorías ===== */}
        <Card className="categorias-page__panel">
          <div className="categorias-page__panel-header">
            <h2 className="categorias-page__panel-title">Categorías</h2>
            <Button size="sm" onClick={openCatCreate}>Nueva</Button>
          </div>
          <SearchInput value={catSearch} onChange={setCatSearch} placeholder="Buscar categoría…" />
          <div className="categorias-page__panel-body">
            {catLoading ? (
              <div className="categorias-page__state"><Spinner size={16} label="Cargando…" /></div>
            ) : filteredCat.length === 0 ? (
              <EmptyState icon="◫" title={catSearch ? 'Sin resultados' : 'Sin categorías'} message={catSearch ? 'Intenta con otro término.' : 'Crea la primera categoría.'} />
            ) : (
              <div className="categorias-page__list">
                {filteredCat.map((row, i) => renderCatItem(row, i))}
              </div>
            )}
          </div>
        </Card>

        {/* ===== Panel de Subcategorías ===== */}
        <Card className="categorias-page__panel">
          <div className="categorias-page__panel-header">
            <h2 className="categorias-page__panel-title">Subcategorías</h2>
            <Button size="sm" onClick={openSubCreate}>Nueva</Button>
          </div>
          <div className="categorias-page__sub-filters">
            <SearchInput value={subSearch} onChange={setSubSearch} placeholder="Buscar subcategoría…" />
            <select className="select" value={subCategoriaId ?? ''} onChange={(e) => setSubCategoriaId(e.target.value ? Number(e.target.value) : null)} aria-label="Filtrar por categoría">
              <option value="">Todas las categorías</option>
              {catItems.map((c) => <option key={`cat-cat-${c.id_categoria}`} value={c.id_categoria}>{c.nombre_categoria}</option>)}
            </select>
          </div>
          <div className="categorias-page__panel-body">
            {subLoading ? (
              <div className="categorias-page__state"><Spinner size={16} label="Cargando…" /></div>
            ) : filteredSub.length === 0 ? (
              <EmptyState icon="◳" title={subSearch || subCategoriaId ? 'Sin resultados' : 'Sin subcategorías'} message="Crea la primera subcategoría." />
            ) : (
              <div className="categorias-page__list">
                {filteredSub.map((row, i) => renderSubItem(row, i))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <CategoriaForm
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        editingId={catEditingId}
        catValues={catEditingValues}
        onSaved={handleCatSaved}
      />
      <SubcategoriaForm
        open={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        editingId={subEditingId}
        subValues={subEditingValues}
        categorias={catItems}
        onSaved={handleSubSaved}
      />
    </>
  );
}
