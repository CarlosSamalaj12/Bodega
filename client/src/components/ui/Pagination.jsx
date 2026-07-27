import { useMemo } from 'react';
import './Pagination.scss';

/**
 * Pagination — Componente reutilizable de paginación server-side.
 *
 * Props:
 *   page       - Página actual (1-based)
 *   totalPages - Total de páginas
 *   total      - Total de registros
 *   onChange   - Callback(page) al cambiar de página
 *   loading    - Si está cargando, deshabilita los botones
 */
export function Pagination({ page, totalPages, total, onChange, loading }) {
  const pages = useMemo(() => {
    const result = [];
    const tp = Number(totalPages) || 1;
    const cur = Number(page) || 1;

    if (tp <= 7) {
      for (let i = 1; i <= tp; i++) result.push(i);
    } else {
      result.push(1);
      if (cur > 3) result.push('...');
      for (let i = Math.max(2, cur - 1); i <= Math.min(tp - 1, cur + 1); i++) {
        result.push(i);
      }
      if (cur < tp - 2) result.push('...');
      result.push(tp);
    }
    return result;
  }, [page, totalPages]);

  if (Number(totalPages) <= 1 && Number(total) <= 50) return null;

  return (
    <div className="pagination">
      <div className="pagination__info">
        {Number(total) > 0 && (
          <span className="pagination__count">{Number(total)} registro{Number(total) !== 1 ? 's' : ''}</span>
        )}
        <span className="pagination__current">
          Pág. {Number(page)} de {Number(totalPages) || 1}
        </span>
      </div>

      <div className="pagination__controls">
        <button
          type="button"
          className="pagination__btn"
          disabled={Number(page) <= 1 || loading}
          onClick={() => onChange(Number(page) - 1)}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="pagination__ellipsis">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pagination__page ${Number(page) === p ? 'pagination__page--active' : ''}`}
              disabled={loading}
              onClick={() => onChange(p)}
              aria-label={`Ir a página ${p}`}
              aria-current={Number(page) === p ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}

        <button
          type="button"
          className="pagination__btn"
          disabled={Number(page) >= Number(totalPages) || loading}
          onClick={() => onChange(Number(page) + 1)}
          aria-label="Página siguiente"
        >
          Siguiente ›
        </button>
      </div>
    </div>
  );
}
