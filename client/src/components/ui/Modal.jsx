import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

export function Modal({ open, onClose, title, size = 'md', footer, children }) {
  // Bloquea scroll del body mientras el modal está abierto
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevWidth = document.body.style.width;
    const scrollY = window.scrollY;

    // En móvil/tablet (<= 768px) bloqueamos scroll de forma fuerte
    // para evitar que el bottom sheet se mueva al hacer scroll en el body
    const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
    if (isSmallScreen) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    } else {
      document.body.style.overflow = 'hidden';
    }

    // No escuchar la tecla Escape para evitar cierres accidentales en formularios
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = prevWidth;
      document.body.style.top = '';
      if (isSmallScreen) {
        window.scrollTo(0, scrollY);
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = size === 'lg' ? 'modal--lg' : size === 'xl' ? 'modal--xl' : '';

  return createPortal(
    <>
      {/* Se quita el onClick={onClose} para evitar que el modal se cierre al hacer clic fuera por accidente */}
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        className={`modal ${sizeClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="modal-title" className="modal__title">{title}</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

Modal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  title: PropTypes.node,
  size: PropTypes.oneOf(['md', 'lg', 'xl']),
  footer: PropTypes.node,
  children: PropTypes.node,
};
