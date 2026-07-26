import PropTypes from 'prop-types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';
import './DataList.scss';

/**
 * DataList — tabla en desktop, cards en móvil.
 *
 * @example
 * <DataList
 *   columns={[
 *     { key: 'id', label: '#', primary: true, render: r => <code>{r.id}</code> },
 *     { key: 'nombre', label: 'Nombre' },
 *     { key: 'estado', label: 'Estado', render: r => <Badge>...</Badge> },
 *   ]}
 *   rows={items}
 *   loading={loading}
 *   emptyTitle="Sin datos"
 *   emptyMessage="Cuando haya algo aparecerá aquí"
 * />
 *
 * @param {object} props
 * @param {Array<{key:string,label?:string,render?:Function,primary?:boolean,width?:number|string,align?:string,hideOnMobile?:boolean}>} props.columns
 * @param {Array<object>} props.rows
 * @param {(row:object)=>void} [props.onRowClick]
 * @param {string} [props.keyField='id'] Campo único por fila
 * @param {boolean} [props.loading]
 * @param {string} [props.emptyTitle='Sin datos']
 * @param {string} [props.emptyMessage]
 * @param {React.ReactNode} [props.emptyAction]
 * @param {React.ReactNode} [props.emptyIcon]
 * @param {string} [props.className='']
 * @param {'sm'|'md'} [props.density='md']
 * @param {(row:object, idx:number) => string|undefined} [props.rowClass] - Función que devuelve clase(s) adicional(es) para cada fila
 */
export function DataList({
  columns,
  rows = [],
  onRowClick,
  keyField = 'id',
  keyFn,
  loading = false,
  emptyTitle = 'Sin datos',
  emptyMessage,
  emptyAction,
  emptyIcon,
  className = '',
  density = 'md',
  cardActions,
  rowClass,
}) {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const getKey = (row, idx) => {
    if (keyFn) return keyFn(row, idx);
    return row?.[keyField] ?? idx;
  };

  if (loading) {
    return (
      <div className="data-list__state">
        <Spinner size={20} label="Cargando…" />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        message={emptyMessage}
        action={emptyAction}
      />
    );
  }

  // ---------- Móvil: cards apiladas ----------
  if (isMobile) {
    const visibleCols = columns.filter((c) => !c.hideOnMobile);
    const primaryCol = visibleCols.find((c) => c.primary) || visibleCols[0];

    return (
      <div className={`data-list data-list--mobile data-list--${density} ${className}`}>
        {rows.map((row, idx) => {
          const clickable = typeof onRowClick === 'function';
          const CardTag = clickable ? 'button' : 'div';
          return (
            <CardTag
              type={clickable ? 'button' : undefined}
              key={getKey(row, idx)}
              className={['data-list__card', clickable ? 'data-list__card--clickable' : '', rowClass?.(row, idx) || ''].filter(Boolean).join(' ')}
              onClick={clickable ? () => onRowClick(row) : undefined}
            >
              <div className="data-list__card-head">
                <span className="data-list__card-primary">
                  {primaryCol.render
                    ? primaryCol.render(row)
                    : row[primaryCol.key] ?? '—'}
                </span>
                {primaryCol.cardMeta?.(row)}
              </div>
              <dl className="data-list__card-body">
                {visibleCols
                  .filter((c) => c !== primaryCol)
                  .map((col) => (
                    <div key={col.key} className="data-list__row">
                      {col.label && <dt className="data-list__label">{col.label}</dt>}
                      <dd className="data-list__value">
                        {col.render ? col.render(row) : (row[col.key] ?? '—')}
                      </dd>
                    </div>
                  ))}
              </dl>
              {cardActions && (
                <div className="data-list__card-actions">
                  {cardActions(row)}
                </div>
              )}
            </CardTag>
          );
        })}
      </div>
    );
  }

  // ---------- Desktop: tabla ----------
  return (
    <div className={`table-wrapper ${className}`}>
      <table className={`table table--${density}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  width: col.width,
                  textAlign: col.align,
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const clickable = typeof onRowClick === 'function';
            return (
              <tr
                key={getKey(row, idx)}
                onClick={clickable ? () => onRowClick(row) : undefined}
                className={['', clickable ? 'table__row--clickable' : '', rowClass?.(row, idx) || ''].filter(Boolean).join(' ') || undefined}
                style={clickable ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align }}>
                    {col.render ? col.render(row) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

DataList.propTypes = {
  columns: PropTypes.array.isRequired,
  rows: PropTypes.array,
  onRowClick: PropTypes.func,
  keyField: PropTypes.string,
  keyFn: PropTypes.func,
  loading: PropTypes.bool,
  emptyTitle: PropTypes.string,
  emptyMessage: PropTypes.string,
  emptyAction: PropTypes.node,
  emptyIcon: PropTypes.node,
  className: PropTypes.string,
  density: PropTypes.oneOf(['sm', 'md']),
  cardActions: PropTypes.func,
};
