import { useState, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { Modal } from './Modal';
import { Button } from './Button';
import './ColumnSelectorModal.scss';

/** Resaltar texto que coincide con la búsqueda */
function highlightMatch(text, query) {
  if (!query || !text) return text;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${q})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={`hl-${i}`} className="column-selector__highlight">{part}</mark>
      : part
  );
}

/** Leer valor JSON de localStorage con manejo seguro de errores */
function loadFromStorage(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Guardar valor en localStorage con manejo seguro de errores */
function saveToStorage(key, value) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage lleno o deshabilitado — silencioso
  }
}

/** Clave para persistir el orden de columnas */
function orderKey(storageKey) {
  return storageKey ? `${storageKey}_order` : null;
}

/**
 * Modal para seleccionar qué columnas incluir en la exportación CSV.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {Array<{key:string, label:string}>} props.columns - Todos los campos disponibles
 * @param {string[]} props.defaultSelected - Keys seleccionadas por defecto
 * @param {Function} props.onConfirm - (selectedKeys: string[]) => void
 * @param {string} [props.storageKey] - Clave de localStorage para persistir la selección
 */
export function ColumnSelectorModal({ open, onClose, columns, defaultSelected, onConfirm, storageKey }) {
  const allKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const [selected, setSelected] = useState(() => loadFromStorage(storageKey) || defaultSelected || allKeys);
  const [searchQuery, setSearchQuery] = useState('');
  const [format, setFormat] = useState('csv');

  const formatLabel = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };

  // Orden de columnas (con persistencia)
  const [orderedColumns, setOrderedColumns] = useState(() => {
    const savedOrder = loadFromStorage(orderKey(storageKey));
    if (savedOrder && Array.isArray(savedOrder) && savedOrder.length === columns.length) {
      // Reconstruir columnas en el orden guardado
      const map = new Map(columns.map((c) => [c.key, c]));
      const reordered = savedOrder.map((k) => map.get(k)).filter(Boolean);
      if (reordered.length === columns.length) return reordered;
    }
    return columns;
  });

  // Drag-and-drop state
  const dragItemRef = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  // Cargar desde localStorage al abrir el modal
  useEffect(() => {
    if (open) {
      const saved = loadFromStorage(storageKey);
      setSelected(saved || defaultSelected || allKeys);
      setSearchQuery('');
      setFormat('csv');
      // Restaurar orden guardado
      const savedOrder = loadFromStorage(orderKey(storageKey));
      if (savedOrder && Array.isArray(savedOrder) && savedOrder.length === columns.length) {
        const map = new Map(columns.map((c) => [c.key, c]));
        const reordered = savedOrder.map((k) => map.get(k)).filter(Boolean);
        if (reordered.length === columns.length) {
          setOrderedColumns(reordered);
          return;
        }
      }
      setOrderedColumns(columns);
    }
  }, [open, storageKey, defaultSelected, allKeys, columns]);

  const toggle = (key) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const filteredColumns = useMemo(() => {
    if (!searchQuery) return orderedColumns;
    const q = searchQuery.toLowerCase();
    return orderedColumns.filter(
      (c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    );
  }, [orderedColumns, searchQuery]);

  const selectAll = () => setSelected(filteredColumns.map((c) => c.key));
  const deselectAll = () => setSelected([]);

  // --- Drag handlers ---
  const handleDragStart = (e, col) => {
    dragItemRef.current = col.key;
    e.dataTransfer.effectAllowed = 'move';
    // Pequeño timeout para que el drag ghost se vea bien
    e.dataTransfer.setData('text/plain', col.key);
  };

  const handleDragOver = (e, col) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(col.key);
  };

  const handleDragLeave = () => {
    setDragOverKey(null);
  };

  const handleDrop = (e, targetCol) => {
    e.preventDefault();
    const sourceKey = dragItemRef.current;
    if (!sourceKey || sourceKey === targetCol.key) {
      setDragOverKey(null);
      dragItemRef.current = null;
      return;
    }

    setOrderedColumns((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((c) => c.key === sourceKey);
      const toIdx = arr.findIndex((c) => c.key === targetCol.key);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });

    setDragOverKey(null);
    dragItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverKey(null);
    dragItemRef.current = null;
  };

  const handleReset = () => {
    setSelected(defaultSelected || allKeys);
    setOrderedColumns(columns);
    // Limpiar persistencia para que la próxima vez arranque de fábrica
    try {
      if (storageKey) localStorage.removeItem(storageKey);
      const oKey = orderKey(storageKey);
      if (oKey) localStorage.removeItem(oKey);
    } catch {}
  };

  const handleConfirm = () => {
    if (selected.length === 0) return;
    // Persistir selección y orden
    saveToStorage(storageKey, selected);
    saveToStorage(orderKey(storageKey), orderedColumns.map((c) => c.key));
    // Pasar solo las columnas seleccionadas, en el orden actual, más el formato elegido
    const orderedSelected = orderedColumns.filter((c) => selected.includes(c.key));
    onConfirm(orderedSelected, format);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Columnas a exportar"
      size="md"
      footer={
        <div className="column-selector__footer">
          <div className="column-selector__format-group">
            {['csv', 'xlsx', 'pdf'].map((f) => (
              <button
                key={f}
                type="button"
                className={`column-selector__format-btn ${format === f ? 'column-selector__format-btn--active' : ''}`}
                onClick={() => setFormat(f)}
              >
                {formatLabel[f]}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleConfirm} disabled={selected.length === 0}>
            Exportar {formatLabel[format]} ({selected.length} columna{selected.length !== 1 ? 's' : ''})
          </Button>
        </div>
      }
    >
      <div className="column-selector">
        <div className="column-selector__toolbar">
          <button
            type="button"
            className={`column-selector__toolbar-btn ${selected.length === orderedColumns.length ? 'column-selector__toolbar-btn--disabled' : ''}`}
            onClick={selectAll}
            disabled={selected.length === orderedColumns.length}
          >
            Seleccionar todo
          </button>
          <button
            type="button"
            className={`column-selector__toolbar-btn ${selected.length === 0 ? 'column-selector__toolbar-btn--disabled' : ''}`}
            onClick={deselectAll}
            disabled={selected.length === 0}
          >
            Deseleccionar todo
          </button>
          <span className="column-selector__count">
            {selected.length} de {orderedColumns.length}
          </span>
          <button
            type="button"
            className="column-selector__reset-btn"
            onClick={handleReset}
            title="Restablecer valores predeterminados"
          >
            ↺ Restablecer
          </button>
        </div>
        <div className="column-selector__search">
          <input
            type="text"
            className="column-selector__search-input"
            placeholder="Buscar columna…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar columna"
          />
          {searchQuery && (
            <button
              type="button"
              className="column-selector__search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
        </div>
        {!searchQuery && (
          <p className="column-selector__hint">
            Arrastra las columnas para reordenarlas
          </p>
        )}
        <div className="column-selector__list">
          {filteredColumns.length === 0 ? (
            <div className="column-selector__empty">
              No hay columnas que coincidan con "{searchQuery}"
            </div>
          ) : (
            filteredColumns.map((col) => {
              const isSelected = selected.includes(col.key);
              const isDragging = dragItemRef.current === col.key;
              const isDragOver = dragOverKey === col.key;
              return (
                <div
                  key={col.key}
                  className={`column-selector__item ${isSelected ? 'column-selector__item--selected' : ''} ${isDragging ? 'column-selector__item--dragging' : ''} ${isDragOver ? 'column-selector__item--drag-over' : ''}`}
                  draggable={!searchQuery}
                  onDragStart={(e) => handleDragStart(e, col)}
                  onDragOver={(e) => handleDragOver(e, col)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="column-selector__drag-handle" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <input
                    type="checkbox"
                    className="column-selector__checkbox"
                    checked={isSelected}
                    onChange={() => toggle(col.key)}
                  />
                  <span className="column-selector__label">
                    {highlightMatch(col.label, searchQuery)}
                  </span>
                  <span className="column-selector__key">
                    {highlightMatch(col.key, searchQuery)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}

ColumnSelectorModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  defaultSelected: PropTypes.arrayOf(PropTypes.string),
  storageKey: PropTypes.string,
  onConfirm: PropTypes.func.isRequired,
};
