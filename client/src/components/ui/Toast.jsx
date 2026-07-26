import { useEffect, useState, useCallback, useRef } from 'react';
import { create } from 'zustand';
import { createPortal } from 'react-dom';
import './Toast.scss';

// Store global de toasts
export const useToastStore = create((set, get) => ({
  toasts: [],
  push(toast) {
    const id = Math.random().toString(36).slice(2);
    const next = { id, variant: 'default', duration: 4000, ...toast };
    set({ toasts: [...get().toasts, next] });
    if (next.duration > 0) {
      setTimeout(() => get().dismiss(id), next.duration);
    }
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

// API simplificada
export const toast = {
  success(msg, opts) { return useToastStore.getState().push({ message: msg, variant: 'success', ...opts }); },
  error(msg, opts)   { return useToastStore.getState().push({ message: msg, variant: 'danger', duration: 6000, ...opts }); },
  info(msg, opts)    { return useToastStore.getState().push({ message: msg, variant: 'info', ...opts }); },
  warn(msg, opts)    { return useToastStore.getState().push({ message: msg, variant: 'warning', ...opts }); },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const handleClick = (t) => {
    if (t.onClick) {
      t.onClick();
      dismiss(t.id);
    }
  };

  return createPortal(
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => {
        const clickable = typeof t.onClick === 'function';
        return (
          <div
            key={t.id}
            className={`toast toast--${t.variant} ${clickable ? 'toast--clickable' : ''}`}
            role="status"
            onClick={clickable ? () => handleClick(t) : undefined}
          >
            <span className="toast__message">{t.message}</span>
            {t.actionLabel && clickable && (
              <span className="toast__action">{t.actionLabel}</span>
            )}
            <button
              type="button"
              className="toast__close"
              aria-label="Cerrar"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
            >✕</button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
