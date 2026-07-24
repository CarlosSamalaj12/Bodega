import PropTypes from 'prop-types';
import { useId } from 'react';

export function Select({
  label,
  hint,
  error,
  options = [],
  value,
  onChange,
  placeholder = 'Seleccionar…',
  disabled = false,
  className = '',
  ...rest
}) {
  const autoId = useId();
  const fieldId = rest.id || autoId;

  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={fieldId}>{label}</label>}
      <select
        id={fieldId}
        className={`select ${className}`}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      >
        {options.map((opt) => {
          const v = typeof opt === 'object' ? opt.value : opt;
          const lbl = typeof opt === 'object' ? opt.label : opt;
          // Primera opción vacía = placeholder automático
          const isPlaceholder = String(v) === '' && options.indexOf(opt) === 0;
          return (
            <option key={`${v}-${options.indexOf(opt)}`} value={v} disabled={isPlaceholder}>
              {isPlaceholder ? (lbl || placeholder) : lbl}
            </option>
          );
        })}
      </select>
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

Select.propTypes = {
  label: PropTypes.string,
  hint: PropTypes.string,
  error: PropTypes.string,
  options: PropTypes.array,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};
