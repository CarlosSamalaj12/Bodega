import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { KeyboardKey } from '@/components/ui/KeyboardKey';
import { useShortcutsStore } from '@/stores/shortcuts.store';
import {
  eventToCombo,
  normalizeCombo,
  combosEqual,
  SHORTCUT_CATALOG,
} from '@/utils/shortcuts';
import { toast } from '@/components/ui/Toast';
import './ShortcutsPage.scss';

const CATEGORY_LABELS = {
  general: 'General',
  navegacion: 'Navegación',
  movimientos: 'Movimientos',
  formularios: 'Formularios',
};

const CATEGORY_ORDER = ['general', 'navegacion', 'movimientos', 'formularios'];

/**
 * ShortcutsPage
 * Configuración personalizable de atajos de teclado. Permite:
 *   - Ver el combo actual de cada atajo.
 *   - Cambiar un atajo haciendo clic (captura la siguiente tecla).
 *   - Restaurar un atajo individual a su default.
 *   - Restaurar TODOS a defaults.
 *
 * Detecta conflictos: si el nuevo combo ya está siendo usado por otro
 * atajo, advertimos al usuario antes de guardar.
 */
export default function ShortcutsPage() {
  const overrides = useShortcutsStore((s) => s.overrides);
  const getCombo = useShortcutsStore((s) => s.getCombo);
  const isCustomized = useShortcutsStore((s) => s.isCustomized);
  const saving = useShortcutsStore((s) => s.saving);
  const loaded = useShortcutsStore((s) => s.loaded);
  const setShortcut = useShortcutsStore((s) => s.setShortcut);
  const resetAll = useShortcutsStore((s) => s.resetAll);
  const load = useShortcutsStore((s) => s.load);

  // El atajo que el usuario está capturando (id del catálogo).
  const [capturing, setCapturing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [conflict, setConflict] = useState(null);
  const captureInputRef = useRef(null);

  // Si el store aún no cargó desde el backend, lo pedimos.
  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Cuando estamos capturando, escuchar teclas a nivel documento.
  useEffect(() => {
    if (!capturing) return undefined;

    const onKey = (e) => {
      // Esc cancela la captura.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCapturing(null);
        setDraft(null);
        setConflict(null);
        return;
      }
      // Enter confirma el draft actual.
      if (e.key === 'Enter' && draft) {
        e.preventDefault();
        e.stopPropagation();
        commitDraft();
        return;
      }
      // Backspace limpia el draft (útil para borrar antes de reasignar).
      if (e.key === 'Backspace' && draft) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
        setConflict(null);
        return;
      }
      // Cualquier otra tecla: capturar como draft.
      const combo = eventToCombo(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      const norm = normalizeCombo(combo);
      // Verificar conflicto con OTROS atajos (no el que estamos editando).
      const conflictItem = findConflict(norm, capturing);
      setDraft(norm);
      setConflict(conflictItem);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    // Poner foco en un input invisible para que el navegador no se queje
    // y podamos seguir capturando incluso si el usuario hace clic fuera.
    captureInputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, draft]);

  const beginCapture = (id) => {
    setCapturing(id);
    setDraft(null);
    setConflict(null);
  };

  const cancelCapture = () => {
    setCapturing(null);
    setDraft(null);
    setConflict(null);
  };

  const commitDraft = useCallback(async () => {
    if (!capturing || !draft) return;
    try {
      await setShortcut(capturing, draft);
      toast.success('Atajo guardado');
      setCapturing(null);
      setDraft(null);
      setConflict(null);
    } catch (e) {
      toast.error(e?.message || 'No se pudo guardar el atajo');
    }
  }, [capturing, draft, setShortcut]);

  const resetOne = useCallback(async (id) => {
    try {
      await setShortcut(id, null);
      toast.success('Atajo restablecido');
    } catch (e) {
      toast.error(e?.message || 'No se pudo restablecer');
    }
  }, [setShortcut]);

  const resetAllClick = useCallback(async () => {
    if (!window.confirm('¿Restablecer TODOS los atajos a sus valores por defecto?')) return;
    try {
      await resetAll();
      toast.success('Todos los atajos fueron restablecidos');
    } catch (e) {
      toast.error(e?.message || 'No se pudo restablecer');
    }
  }, [resetAll]);

  // Mapa de id -> shortcut (para detección de conflictos)
  const effectiveMap = useMemo(() => {
    const m = {};
    for (const s of SHORTCUT_CATALOG) m[s.id] = normalizeCombo(getCombo(s.id));
    return m;
  }, [getCombo, overrides]);

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

  if (!loaded) {
    return (
      <>
        <Header
          title="Atajos de teclado"
          subtitle="Personaliza los atajos de tu CRM"
        />
        <div className="shortcuts-page" style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner size={20} label="Cargando atajos…" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Atajos de teclado"
        subtitle="Personaliza los atajos de tu CRM"
        actions={
          <div className="shortcuts-page__header-actions">
            <Button variant="ghost" onClick={resetAllClick} disabled={saving}>
              Restablecer todos
            </Button>
          </div>
        }
      />

      <div className="shortcuts-page">
        <div className="shortcuts-page__intro">
          Haz clic en <strong>Cambiar</strong> junto a cualquier atajo y
          presiona la nueva combinación. <kbd className="kbd kbd--inline">Esc</kbd> cancela,
          <kbd className="kbd kbd--inline">Backspace</kbd> borra la captura actual,
          <kbd className="kbd kbd--inline">Enter</kbd> confirma. Si el atajo que
          elijas ya está siendo usado por otra acción, te avisaremos antes de
          guardar.
        </div>

        {groups.map((g) => (
          <div className="shortcuts-page__group" key={g.key}>
            <h2 className="shortcuts-page__group-title">{g.label}</h2>
            <p className="shortcuts-page__group-desc">
              {groupDescription(g.key)}
            </p>
            <div className="shortcuts-page__rows">
              {g.items.map((s) => {
                const current = effectiveMap[s.id] || '';
                const customized = isCustomized(s.id);
                const isThisCapturing = capturing === s.id;
                return (
                  <div className="shortcuts-page__row" key={s.id}>
                    <div className="shortcuts-page__row-label">
                      <div className="shortcuts-page__row-title">{s.label}</div>
                      <div className="shortcuts-page__row-desc">{s.description}</div>
                    </div>
                    <div className="shortcuts-page__row-current">
                      {isThisCapturing ? (
                        <div className="shortcuts-page__capture">
                          {draft ? (
                            <>
                              <span>Nuevo:</span>
                              <KeyboardKey combo={draft} variant="block" />
                              {conflict && (
                                <span className="shortcuts-page__conflict">
                                  ⚠ En uso por “{conflict.label}”
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={commitDraft}
                                disabled={!draft}
                              >
                                Guardar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelCapture}
                              >
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <span className="shortcuts-page__capture-hint">
                              Presiona la nueva combinación…
                            </span>
                          )}
                          {/* Input invisible para que el navegador no se queje
                              de keydown sin foco en un campo editable. */}
                          <input
                            ref={isThisCapturing ? captureInputRef : null}
                            aria-hidden
                            tabIndex={-1}
                            style={{
                              position: 'absolute',
                              opacity: 0,
                              pointerEvents: 'none',
                              width: 0,
                              height: 0,
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <KeyboardKey combo={current} variant="block" />
                          {!customized && (
                            <span
                              style={{ fontSize: '0.72rem', opacity: 0.7 }}
                              title="Atajo por defecto del sistema"
                            >
                              (por defecto)
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="shortcuts-page__row-actions">
                      {!isThisCapturing && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => beginCapture(s.id)}
                            disabled={saving}
                          >
                            Cambiar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resetOne(s.id)}
                            disabled={saving || !customized}
                            title={customized ? 'Restablecer este atajo' : 'Ya está en su valor por defecto'}
                          >
                            ↺
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function groupDescription(key) {
  switch (key) {
    case 'general': return 'Atajos disponibles en cualquier pantalla.';
    case 'navegacion': return 'Atajos para moverte entre secciones principales.';
    case 'movimientos': return 'Atajos específicos al registrar entradas, salidas y pedidos.';
    case 'formularios': return 'Atajos activos cuando un formulario modal está abierto.';
    default: return '';
  }
}

function findConflict(combo, exceptId) {
  if (!combo) return null;
  for (const s of SHORTCUT_CATALOG) {
    if (s.id === exceptId) continue;
    if (combosEqual(combo, s.defaultCombo)) return s;
  }
  // También considerar overrides de OTROS atajos.
  const ov = useShortcutsStore.getState().overrides || {};
  for (const [id, c] of Object.entries(ov)) {
    if (id === exceptId) continue;
    if (combosEqual(combo, c)) {
      return SHORTCUT_CATALOG.find((s) => s.id === id) || { id, label: id };
    }
  }
  return null;
}
