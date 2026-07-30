import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { Spinner } from '@/components/ui/Spinner';
import { useProductSearch } from '@/hooks/useProductSearch';
import './ProductPicker.scss';

/**
 * Resalta todas las ocurrencias de `term` dentro de `text`.
 * Ignora mayúsculas/minúsculas y acentos.
 */
function HighlightText({ text, term }) {
  if (!text) return null;
  if (!term || term.length < 1) return text;

  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  const segments = [];
  let cursor = 0;

  while (cursor < text.length) {
    const idx = normalizedText.indexOf(normalizedTerm, cursor);
    if (idx === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + term.length), match: true });
    cursor = idx + term.length;
  }

  return segments.map((s, i) =>
    s.match ? (
      <mark key={i} className="product-picker__mark">{s.text}</mark>
    ) : (
      <span key={i}>{s.text}</span>
    )
  );
}

/**
 * ProductPicker — selector con búsqueda en vivo.
 */
export function ProductPicker({
  value,
  onChange,
  placeholder = 'Buscar producto…',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [coords, setCoords] = useState(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  const { productos, loading, query, setQuery } = useProductSearch();

  useEffect(() => { setMounted(true); }, []);

  // Reset índice cuando cambian los resultados
  useEffect(() => {
    setActiveIndex(0);
  }, [productos]);

  // Recalcula coordenadas del input y decide si el dropdown va hacia abajo
  // o hacia arriba según el espacio disponible en el viewport.
  // También limita el alto para que nunca se salga de la ventana.
  const updateCoords = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const gap = 6; // separación entre input y dropdown
    const margin = 12; // margen de seguridad al borde inferior/superior

    // Alto objetivo: 360px, pero nunca más que lo que cabe en el viewport.
    const desired = 360;
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;

    // Si no cabe bien hacia abajo, hacer flip hacia arriba.
    // Umbral mínimo: 200px (que alcance para mostrar 2-3 opciones).
    const minHeight = 200;
    const flipUp = spaceBelow < minHeight && spaceAbove > spaceBelow;

    const available = flipUp ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(minHeight, Math.min(desired, available));

    setCoords({
      top: flipUp ? null : (rect.bottom + gap),
      bottom: flipUp ? (window.innerHeight - rect.top + gap) : null,
      left: rect.left,
      width: rect.width,
      maxHeight,
      flipUp,
      // Si el dropdown se sale por la derecha, lo alineamos al borde derecho.
      rightAligned: rect.left + rect.width > vw - 8,
    });
  };

  useLayoutEffect(() => {
    if (open) updateCoords();
  }, [open, query]);

  // Reposicionar en scroll y resize
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cierra al hacer click fuera (considera el portal también)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inInput = wrapperRef.current?.contains(e.target);
      const inDropdown = e.target.closest('.product-picker__dropdown');
      if (!inInput && !inDropdown) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll al item activo
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector(`[data-index="${activeIndex}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = (p) => {
    onChange?.(p);
    setQuery('');
    setOpen(false);
  };

  const handleClear = () => {
    onChange?.(null);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (productos.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, productos.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = productos[activeIndex];
      if (p) handleSelect(p);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = open && (loading || query.length > 0);

  // ---------- Modo: producto seleccionado ----------
  if (value) {
    return (
      <div className="product-picker product-picker--selected" ref={wrapperRef}>
        <div className="product-picker__chip">
          <div className="product-picker__chip-icon" aria-hidden="true">◧</div>
          <div className="product-picker__chip-info">
            <div className="product-picker__chip-name">{value.nombre_producto}</div>
            <div className="product-picker__chip-meta">
              {value.sku && <code className="product-picker__chip-sku">{value.sku}</code>}
              {value.nombre_categoria && (
                <span className="product-picker__chip-cat">{value.nombre_categoria}</span>
              )}
              {value.nombre_medida && (
                <span className="product-picker__chip-unit">{value.nombre_medida}</span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              className="product-picker__chip-remove"
              onClick={handleClear}
              aria-label="Cambiar producto"
              title="Cambiar producto"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- Dropdown en portal (flota sobre todo) ----------
  const dropdown =
    showDropdown && mounted && coords
      ? createPortal(
          <div
            className="product-picker__dropdown"
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.flipUp ? undefined : coords.top,
              bottom: coords.flipUp ? coords.bottom : undefined,
              left: coords.rightAligned
                ? Math.max(8, window.innerWidth - coords.left - coords.width)
                : coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {loading && (
              <div className="product-picker__status">
                <Spinner size={14} /> Buscando "{query}"…
              </div>
            )}
            {!loading && productos.length === 0 && (
              <div className="product-picker__status product-picker__status--muted">
                <span className="product-picker__status-icon" aria-hidden="true">∅</span>
                <div>
                  <div>Sin resultados para <strong>"{query}"</strong></div>
                  <div className="product-picker__status-hint">
                    Prueba con otro término o verifica que el producto exista.
                  </div>
                </div>
              </div>
            )}
            {!loading && productos.length > 0 && (
              <>
                <div className="product-picker__results-meta">
                  {productos.length} resultado{productos.length === 1 ? '' : 's'}
                </div>
                <ul className="product-picker__list">
                  {productos.map((p, idx) => (
                    <li key={p.id_producto}>
                      <button
                        type="button"
                        data-index={idx}
                        className={`product-picker__option ${idx === activeIndex ? 'product-picker__option--active' : ''}`}
                        onClick={() => handleSelect(p)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        role="option"
                        aria-selected={idx === activeIndex}
                      >
                        <div className="product-picker__option-icon" aria-hidden="true">◧</div>
                        <div className="product-picker__option-body">
                          <div className="product-picker__option-name">
                            <HighlightText text={p.nombre_producto} term={query} />
                          </div>
                          <div className="product-picker__option-meta">
                            {p.sku && (
                              <code className="product-picker__option-sku">
                                <HighlightText text={p.sku} term={query} />
                              </code>
                            )}
                            {p.nombre_categoria && (
                              <span className="product-picker__option-cat">{p.nombre_categoria}</span>
                            )}
                            {p.nombre_medida && (
                              <span className="product-picker__option-unit">{p.nombre_medida}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="product-picker__hint">
                  <kbd>↑</kbd><kbd>↓</kbd> navegar · <kbd>Enter</kbd> seleccionar · <kbd>Esc</kbd> cerrar
                </div>
              </>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        className={`product-picker ${showDropdown ? 'product-picker--open' : ''}`}
        ref={wrapperRef}
      >
        <div className="product-picker__input-wrap">
          <span className="product-picker__search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            className="input product-picker__input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              className="product-picker__clear"
              onClick={() => { setQuery(''); }}
              aria-label="Limpiar búsqueda"
              title="Limpiar"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {dropdown}
    </>
  );
}

ProductPicker.propTypes = {
  value: PropTypes.object,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
};
