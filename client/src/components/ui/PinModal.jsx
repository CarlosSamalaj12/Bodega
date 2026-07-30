import { useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
import './PinModal.scss';

/**
 * PinModal — modal en portal para solicitar PIN de supervisor.
 */
export function PinModal({ open, title, description, submitting, onConfirm, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    const clean = pin.replace(/\D/g, '');
    if (clean.length < 6 || clean.length > 12) {
      setError('El PIN debe tener entre 6 y 12 dígitos.');
      return;
    }
    setError('');
    onConfirm?.(clean);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && !submitting) onCancel?.();
    if (e.key === 'Enter' && !submitting) handleConfirm();
  };

  if (!open) return null;

  return createPortal(
    <div className="pin-modal-overlay" onKeyDown={handleKeyDown}>
      <div className="modal-backdrop" onClick={submitting ? undefined : onCancel} aria-hidden="true" />
      <div
        className="modal pin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="pin-modal-title" className="modal__title">{title || 'PIN de supervisor'}</h2>
          {!submitting && (
            <button
              type="button"
              className="modal__close"
              onClick={onCancel}
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>
        <div className="modal__body">
          {description && <p className="pin-modal__desc">{description}</p>}
          <Input
            label="PIN de supervisor"
            type="text"
            style={{ WebkitTextSecurity: 'disc' }}
            autoComplete="new-password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            placeholder="6-12 dígitos"
            error={error || undefined}
            autoFocus
            disabled={submitting}
          />
        </div>
        <div className="modal__footer pin-modal__footer">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} disabled={submitting || pin.length < 6}>
            {submitting ? <Spinner size={14} /> : 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

PinModal.propTypes = {
  open: PropTypes.bool,
  title: PropTypes.string,
  description: PropTypes.string,
  submitting: PropTypes.bool,
  onConfirm: PropTypes.func,
  onCancel: PropTypes.func,
};
