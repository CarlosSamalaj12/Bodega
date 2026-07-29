import { useId, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './SearchInput.scss';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  delay = 0,
  className = '',
  autoFocus = false,
  onKeyDown,
  onSearch,
  activeLabel,
}) {
  const id = useId();
  const [local, setLocal] = useState(value || '');

  // Mantener sincronizado si el padre cambia el valor externamente
  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  // Debounceo de la propagación hacia el padre
  useEffect(() => {
    if (delay <= 0) return;
    const t = setTimeout(() => onChange?.(local), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  const handleChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    if (delay <= 0) onChange?.(v);
  };

  const handleClear = () => {
    setLocal('');
    onChange?.('');
  };

  return (
    <div className={`search-input ${className}`}>
      <span className="search-input__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </span>
      <input
        id={id}
        type="text"
        className="search-input__field"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {local && (
        <button
          type="button"
          className="search-input__clear"
          onClick={handleClear}
          aria-label="Limpiar"
          title="Limpiar"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      )}
      {activeLabel && (
        <span className="search-input__badge">{activeLabel}</span>
      )}
    </div>
  );
}

SearchInput.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  delay: PropTypes.number,
  className: PropTypes.string,
  autoFocus: PropTypes.bool,
  onKeyDown: PropTypes.func,
  onSearch: PropTypes.func,
  activeLabel: PropTypes.string,
};
