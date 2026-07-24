import PropTypes from 'prop-types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from './Button';
import './LinesEditor.scss';

/**
 * LinesEditor — editor de líneas tipo tabla en desktop, cards en móvil.
 *
 * @param {object} props
 * @param {Array<object>} props.lines
 * @param {Array<{key:string,label?:string,primary?:boolean,width?:number,render?:Function,hideOnMobile?:boolean}>} props.columns
 * @param {() => void} props.onAdd
 * @param {(idx:number) => void} props.onRemove
 * @param {(line:object, idx:number) => boolean} [props.canRemove]
 * @param {string} [props.addLabel='+ Agregar línea']
 * @param {(lines:Array) => React.ReactNode} [props.renderFooter] Para totales en desktop
 * @param {string} [props.keyField='__idx']  // Por default usamos index
 * @param {boolean} [props.compact]  // Padding reducido
 */
export function LinesEditor({
  lines = [],
  columns = [],
  onAdd,
  onRemove,
  canRemove,
  addLabel = '+ Agregar línea',
  renderFooter,
  keyField = '__idx',
  compact = false,
  emptyHint,
  className = '',
}) {
  const isMobile = !useMediaQuery('(min-width: 768px)');

  // Determinar columna primaria (la que se ve destacada en mobile)
  const primary = columns.find((c) => c.primary) || columns[0];

  return (
    <div className={`lines-editor ${compact ? 'lines-editor--compact' : ''} ${className}`}>
      <div className="lines-editor__toolbar">
        <Button type="button" size="sm" variant="subtle" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>

      {/* ---------- Desktop: tabla ---------- */}
      {!isMobile && (
        <div className="table-wrapper">
          <table className="table lines-editor__table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ width: col.width, minWidth: col.minWidth }}
                  >
                    {col.label}
                  </th>
                ))}
                <th style={{ width: 40 }} aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const key = line[keyField] ?? idx;
                const removable = canRemove ? canRemove(line, idx) : true;
                return (
                  <tr key={key}>
                    {columns.map((col) => (
                      <td key={col.key}>
                        {col.render ? col.render(line, idx) : line[col.key]}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="lines-editor__remove"
                        onClick={() => onRemove?.(idx)}
                        disabled={!removable}
                        title="Quitar línea"
                        aria-label="Quitar línea"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {renderFooter && <tfoot>{renderFooter(lines)}</tfoot>}
          </table>
        </div>
      )}

      {/* ---------- Móvil: cards ---------- */}
      {isMobile && (
        <div className="lines-editor__cards">
          {lines.length === 0 && emptyHint && (
            <div className="lines-editor__empty">{emptyHint}</div>
          )}
          {lines.map((line, idx) => {
            const key = line[keyField] ?? idx;
            const removable = canRemove ? canRemove(line, idx) : true;
            const primaryContent = primary
              ? primary.render
                ? primary.render(line, idx)
                : line[primary.key]
              : null;
            return (
              <div key={key} className="lines-editor__card">
                <div className="lines-editor__card-head">
                  <div className="lines-editor__card-primary">
                    {primary?.label && (
                      <span className="lines-editor__card-label">{primary.label}</span>
                    )}
                    <div className="lines-editor__card-primary-content">{primaryContent}</div>
                  </div>
                  <button
                    type="button"
                    className="lines-editor__remove"
                    onClick={() => onRemove?.(idx)}
                    disabled={!removable}
                    title="Quitar línea"
                    aria-label="Quitar línea"
                  >
                    ✕
                  </button>
                </div>
                {(() => {
                  const visibleSecondary = columns.filter(
                    (c) => c !== primary && !c.hideOnMobile
                  );
                  const single = visibleSecondary.length === 1;
                  return (
                    <div
                      className={`lines-editor__card-fields${single ? ' lines-editor__card-fields--single' : ''}`}
                    >
                      {visibleSecondary.map((col) => (
                        <div
                          key={col.key}
                          className={`lines-editor__field ${col.mobileFullWidth || single ? 'lines-editor__field--full' : ''}`}
                        >
                          {col.label && (
                            <label className="lines-editor__field-label">{col.label}</label>
                          )}
                          <div className="lines-editor__field-control">
                            {col.render ? col.render(line, idx) : line[col.key]}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

LinesEditor.propTypes = {
  lines: PropTypes.array,
  columns: PropTypes.array,
  onAdd: PropTypes.func,
  onRemove: PropTypes.func,
  canRemove: PropTypes.func,
  addLabel: PropTypes.string,
  renderFooter: PropTypes.func,
  keyField: PropTypes.string,
  compact: PropTypes.bool,
  emptyHint: PropTypes.string,
  className: PropTypes.string,
};
