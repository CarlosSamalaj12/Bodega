import PropTypes from 'prop-types';
import { useId } from 'react';

/**
 * Input — campo de texto con label y mensajes
 */
export function Input({
  label,
  hint,
  error,
  type = 'text',
  id,
  className = '',
  ...rest
}) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <input
        id={fieldId}
        type={type}
        className={`input ${className}`}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint && !error && (
        <span id={hintId} className="field__hint">{hint}</span>
      )}
      {error && (
        <span id={errorId} className="field__error">{error}</span>
      )}
    </div>
  );
}

Input.propTypes = {
  label: PropTypes.string,
  hint: PropTypes.string,
  error: PropTypes.string,
  type: PropTypes.string,
  id: PropTypes.string,
  className: PropTypes.string,
};
