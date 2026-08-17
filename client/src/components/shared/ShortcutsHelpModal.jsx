import { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Modal } from '@/components/ui/Modal';
import { KeyboardKey } from '@/components/ui/KeyboardKey';
import { useShortcutsStore } from '@/stores/shortcuts.store';
import { SHORTCUT_CATALOG } from '@/utils/shortcuts';

const CATEGORY_LABELS = {
  general: 'General',
  navegacion: 'Navegación',
  movimientos: 'Movimientos',
  formularios: 'Formularios',
};

const CATEGORY_ORDER = ['general', 'navegacion', 'movimientos', 'formularios'];

/**
 * ShortcutsHelpModal
 * Modal con la lista completa de atajos disponibles, agrupados por categoría.
 * Se abre con el atajo `help.showShortcuts` (Shift+/) por defecto.
 */
export function ShortcutsHelpModal({ open, onClose }) {
  const getCombo = useShortcutsStore((s) => s.getCombo);
  const isCustomized = useShortcutsStore((s) => s.isCustomized);

  // Cerrar con Esc (además del modal ya lo permite nativamente, pero
  // aquí nos aseguramos de que no choque con un atajo de formulario).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose]);

  // Agrupar por categoría
  const groups = useMemo(() => {
    const byCat = {};
    for (const s of SHORTCUT_CATALOG) {
      const c = s.category || 'general';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(s);
    }
    return CATEGORY_ORDER
      .filter((c) => byCat[c])
      .map((c) => ({ key: c, label: CATEGORY_LABELS[c] || c, items: byCat[c] }));
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Atajos de teclado" size="lg">
      <div className="shortcuts-help">
        <p className="shortcuts-help__intro">
          Estos son los atajos disponibles en el CRM. Los que aparecen con
          fondo resaltado son los que tú has personalizado; el resto usan los
          valores por defecto del sistema. Puedes cambiar los tuyos desde
          <strong> Ajustes → Atajos de teclado</strong>.
        </p>

        {groups.map((g) => (
          <section key={g.key} className="shortcuts-help__category">
            <h3 className="shortcuts-help__category-title">{g.label}</h3>
            <div className="shortcuts-help__list">
              {g.items.map((s) => {
                const combo = getCombo(s.id);
                return (
                  <div className="shortcuts-help__row" key={s.id}>
                    <div className="shortcuts-help__row-label">
                      <span className="shortcuts-help__row-title">{s.label}</span>
                      <span className="shortcuts-help__row-desc">{s.description}</span>
                    </div>
                    <div className="shortcuts-help__row-combo">
                      <KeyboardKey combo={combo} variant="block" />
                    </div>
                    <div>
                      {isCustomized(s.id) ? (
                        <span
                          className="kbd kbd--block"
                          style={{ background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)' }}
                          title="Atajo personalizado por el usuario"
                        >
                          personalizado
                        </span>
                      ) : (
                        <span
                          className="kbd kbd--block"
                          style={{ opacity: 0.6 }}
                          title="Atajo por defecto del sistema"
                        >
                          por defecto
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

ShortcutsHelpModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
};
