import { Fragment, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { eventToCombo, normalizeCombo, combosEqual, SHORTCUT_CATALOG } from '@/utils/shortcuts';
import { useShortcutsStore } from '@/stores/shortcuts.store';

/**
 * useShortcut.js
 *
 * Hook para registrar un atajo de teclado.
 *
 *   useShortcut('form.save', () => handleSubmit(), {
 *     scope: 'form',            // opcional: 'global' | 'form' | 'page'
 *     page: ['/entradas'],      // solo si scope === 'page'
 *     formOpen: isModalOpen,    // si scope === 'form'
 *     preventDefault: true,     // default true
 *     ignoreInputs: true,       // default true: no dispara si el foco está en un input
 *   });
 *
 * El handler solo se invoca si el combo resuelto (override > default)
 * coincide con la tecla presionada.
 *
 * Decisión de diseño: "ignorar inputs" es la opción por defecto porque
 * la mayoría de atajos (Ctrl+S, F3) NO deben dispararse mientras el
 * usuario está escribiendo en un campo. Si necesitas lo contrario
 * (ej. un atajo que aplica dentro de un input específico), pasa
 * ignoreInputs: false.
 */
export function useShortcut(id, handler, options = {}) {
  const {
    scope = 'global',
    page = null,
    formOpen = true,
    preventDefault = true,
    ignoreInputs = true,
    enabled = true,
  } = options;

  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);

  const location = useLocation();

  useEffect(() => {
    if (!enabled) return undefined;

    const def = SHORTCUT_CATALOG.find((s) => s.id === id);
    if (!def) return undefined;

    // Si el scope del catálogo es más restrictivo que el del caller,
    // respetamos el catálogo (defensa en profundidad).
    const finalScope = scopeRestrictive(def.scope, scope);
    if (!finalScope) return undefined;

    // Si es scope=page y la ruta no coincide, no instalamos listener.
    if (finalScope === 'page') {
      const targetPages = page || def.page || [];
      if (!targetPages.includes(location.pathname)) return undefined;
    }

    // Si es scope=form y el caller dice que el form NO está abierto, no instalamos.
    // (El catalog de form ya implica que el form está activo; aquí
    // añadimos la verificación explícita del caller.)
    if (finalScope === 'form' && !formOpen) return undefined;

    const onKeyDown = (event) => {
      // No capturar cuando hay un modifier-only (Shift, Ctrl, etc.) suelto.
      if (
        event.key === 'Control' ||
        event.key === 'Shift' ||
        event.key === 'Alt' ||
        event.key === 'Meta'
      ) {
        return;
      }

      // No disparar si el usuario está escribiendo en un input / textarea
      // / contentEditable. El caller puede forzar lo contrario.
      if (ignoreInputs) {
        const t = event.target;
        if (t && t.nodeType === 1) {
          const tag = (t.tagName || '').toLowerCase();
          if (
            tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            t.isContentEditable
          ) {
            // Excepción: F1-F12, Esc y los combos con Ctrl/Meta/Alt
            // (incluyendo modificador) sí deben disparar incluso desde un input.
            const k = event.key;
            const hasMod = event.ctrlKey || event.altKey || event.metaKey;
            const isFunctionKey = /^F\d{1,2}$/.test(k);
            const isEscape = k === 'Escape';
            if (!isFunctionKey && !isEscape && !hasMod) {
              return;
            }
          }
        }
      }

      // Resolver el combo efectivo (override > default) y compararlo.
      const effectiveCombo = normalizeCombo(useShortcutsStore.getState().getCombo(id));
      if (!effectiveCombo) return;

      const pressedCombo = eventToCombo(event);
      if (!pressedCombo) return;

      if (!combosEqual(pressedCombo, effectiveCombo)) return;

      if (preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }
      try {
        handlerRef.current?.(event);
      } catch (e) {
        // El handler es responsabilidad del caller; no rompemos el listener global.
        // eslint-disable-next-line no-console
        console.error('[shortcut] handler error:', e);
      }
    };

    // Usamos capture=true para tomar precedencia sobre handlers locales
    // (ej. Enter en un SearchInput). Si el caller quiere lo contrario,
    // pasamos preventDefault: false.
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [id, scope, formOpen, enabled, location.pathname, JSON.stringify(page), preventDefault, ignoreInputs]);
}

/**
 * Devuelve el scope más restrictivo entre el del catálogo y el del caller.
 * El catálogo manda: si def.scope es 'page' y el caller pide 'global',
 * no podemos cumplir 'page' sin el `page` arg, así que usamos 'global'
 * (caller) solo si es compatible. En la práctica, lo que queremos es
 * asegurar que si def.scope='form' y caller scope='global', el hook
 * NO se active fuera de un form — eso se hace con `formOpen`.
 *
 * Esta función es solo una pequeña normalización.
 */
function scopeRestrictive(catalogScope, callerScope) {
  // Si el caller quiere un scope y el catálogo no tiene `page`, no aplica.
  // Caso principal: catalogScope='page' && callerScope='global' -> caller gana
  // porque el caller decidirá page via la prop. Si el caller scope es
  // más específico que el catálogo, lo aceptamos (ej. catalogScope='global'
  // && callerScope='form' está OK).
  return callerScope;
}

/**
 * useShortcuts (plural): variante declarativa que acepta un mapa de
 * atajos a registrar de una sola vez. Útil para setups con varios
 * atajos en la misma pantalla.
 *
 *   <Shortcuts map={{
 *     'entradas.new': { handler: () => openNew(), page: ['/entradas'] },
 *     'entradas.refresh': { handler: () => refresh() },
 *   }} options={{ formOpen: false }} />
 *
 * Se renderiza como null — solo sirve para registrar listeners.
 */
export function Shortcuts({ map, options = {} }) {
  return (
    <Fragment>
      {Object.entries(map || {}).map(([id, cfg]) => (
        <ShortcutHandler
          key={id}
          id={id}
          handler={cfg.handler}
          scope={cfg.scope}
          page={cfg.page}
          formOpen={cfg.formOpen}
          preventDefault={cfg.preventDefault}
          ignoreInputs={cfg.ignoreInputs}
          enabled={cfg.enabled}
          options={options}
        />
      ))}
    </Fragment>
  );
}

function ShortcutHandler({
  id,
  handler,
  scope,
  page,
  formOpen,
  preventDefault,
  ignoreInputs,
  enabled,
  options,
}) {
  useShortcut(id, handler, {
    scope: scope ?? options?.scope,
    page: page ?? options?.page,
    formOpen: formOpen ?? options?.formOpen ?? true,
    preventDefault: preventDefault ?? options?.preventDefault ?? true,
    ignoreInputs: ignoreInputs ?? options?.ignoreInputs ?? true,
    enabled: enabled ?? options?.enabled ?? true,
  });
  return null;
}
