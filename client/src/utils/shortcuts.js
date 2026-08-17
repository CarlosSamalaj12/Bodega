/**
 * shortcuts.js
 * Utilidades para el sistema de atajos de teclado del CRM.
 *
 * El sistema es totalmente configurable: cada atajo tiene un `id` (estable)
 * y un `combo` (la combinación de teclas actual). El usuario puede editar
 * los combos desde la página de Ajustes → Atajos.
 *
 * Convenciones de combo (formato canónico):
 *   - Modificadores en este orden: Ctrl, Alt, Shift, Meta
 *   - Tecla principal al final: una letra, número, F1-F12, Enter, Esc, etc.
 *   - Separador: '+'  (ej. "Ctrl+Shift+K", "F3", "Ctrl+Enter")
 *   - Para distinguir la barra diagonal del atajo "?", se usa "Shift+/".
 *
 * El parseo es tolerante: acepta "ctrl+s", "CTRL + S", "Cmd+S" (lo
 * normalizamos a Meta) y similares.
 */

// --- Catálogo de atajos disponibles en el sistema ----------------------------
//
// Este es el "menú" maestro. Cada entrada tiene:
//   - id:        identificador estable (no cambia). Es la llave del map de
//                shortcuts que persiste en el backend por usuario.
//   - label:     etiqueta humana para mostrar en UI / ayuda.
//   - description: descripción más larga de lo que hace.
//   - defaultCombo: la combinación por defecto. Si el usuario no la
//                personalizó, se usa esta.
//   - scope:     'global'  -> siempre disponible en cualquier pantalla
//                'form'    -> solo cuando hay un formulario modal abierto
//                            (entrada / salida / pedido)
//                'page'    -> solo en ciertas rutas (ver `page` abajo)
//   - page:      ruta(s) en las que aplica el atajo (solo si scope='page').
//   - category:  agrupación para la UI de configuración y el modal de ayuda.

export const SHORTCUT_CATALOG = [
  // ── Globales ────────────────────────────────────────────────────────────
  {
    id: 'help.showShortcuts',
    label: 'Mostrar atajos',
    description: 'Abre el panel con la lista completa de atajos de teclado.',
    defaultCombo: 'Shift+/',
    scope: 'global',
    category: 'general',
  },
  {
    id: 'modal.close',
    label: 'Cerrar modal',
    description: 'Cierra el modal activo (formulario, detalle, etc.).',
    defaultCombo: 'Esc',
    scope: 'global',
    category: 'general',
  },
  {
    id: 'nav.goHome',
    label: 'Ir a Inicio',
    description: 'Atajo global para navegar a la pantalla de inicio.',
    defaultCombo: 'G+H',
    scope: 'global',
    category: 'navegacion',
  },
  {
    id: 'nav.goAjustes',
    label: 'Ir a Ajustes',
    description: 'Atajo global para ir a la página de Ajustes.',
    defaultCombo: 'G+A',
    scope: 'global',
    category: 'navegacion',
  },

  // ── Por pantalla: Entradas ──────────────────────────────────────────────
  {
    id: 'entradas.new',
    label: 'Nueva entrada',
    description: 'Abre el formulario para registrar una nueva entrada.',
    defaultCombo: 'N',
    scope: 'page',
    page: ['/entradas'],
    category: 'movimientos',
  },
  {
    id: 'entradas.refresh',
    label: 'Refrescar lista',
    description: 'Recarga la lista de entradas recientes.',
    defaultCombo: 'R',
    scope: 'page',
    page: ['/entradas'],
    category: 'movimientos',
  },

  // ── Por pantalla: Salidas ───────────────────────────────────────────────
  {
    id: 'salidas.new',
    label: 'Nueva salida',
    description: 'Abre el formulario para registrar una nueva salida.',
    defaultCombo: 'N',
    scope: 'page',
    page: ['/salidas'],
    category: 'movimientos',
  },
  {
    id: 'salidas.refresh',
    label: 'Refrescar lista',
    description: 'Recarga la lista de salidas recientes.',
    defaultCombo: 'R',
    scope: 'page',
    page: ['/salidas'],
    category: 'movimientos',
  },

  // ── Por pantalla: Pedidos ───────────────────────────────────────────────
  {
    id: 'pedidos.new',
    label: 'Nuevo pedido',
    description: 'Abre el formulario para crear un nuevo pedido a otra bodega.',
    defaultCombo: 'N',
    scope: 'page',
    page: ['/pedidos'],
    category: 'movimientos',
  },
  {
    id: 'pedidos.refresh',
    label: 'Refrescar lista',
    description: 'Recarga la lista de pedidos.',
    defaultCombo: 'R',
    scope: 'page',
    page: ['/pedidos'],
    category: 'movimientos',
  },

  // ── Por pantalla: Despachar ─────────────────────────────────────────────
  {
    id: 'despachar.refresh',
    label: 'Refrescar',
    description: 'Recarga la lista de pedidos pendientes de despacho.',
    defaultCombo: 'R',
    scope: 'page',
    page: ['/pedidos-despachar'],
    category: 'movimientos',
  },

  // ── Formularios de movimientos (entrada, salida, pedido) ───────────────
  {
    id: 'form.save',
    label: 'Guardar / Enviar',
    description: 'Envía el formulario activo. Equivale a hacer clic en el botón principal.',
    defaultCombo: 'F3',
    scope: 'form',
    category: 'formularios',
  },
  {
    id: 'form.saveCtrl',
    label: 'Guardar (Ctrl+Enter)',
    description: 'Alternativa para guardar el formulario activo.',
    defaultCombo: 'Ctrl+Enter',
    scope: 'form',
    category: 'formularios',
  },
  {
    id: 'form.addLine',
    label: 'Agregar línea',
    description: 'Añade una nueva línea al formulario activo (productos del movimiento).',
    defaultCombo: 'F1',
    scope: 'form',
    category: 'formularios',
  },
  {
    id: 'form.cancel',
    label: 'Cancelar',
    description: 'Cancela y cierra el formulario activo.',
    defaultCombo: 'Ctrl+Backspace',
    scope: 'form',
    category: 'formularios',
  },
  {
    id: 'form.focusProduct',
    label: 'Buscar producto',
    description: 'Pone el foco en el campo de búsqueda de producto de la primera línea.',
    defaultCombo: 'F2',
    scope: 'form',
    category: 'formularios',
  },
];

// ── Helpers de parseo / formateo de combos ────────────────────────────────

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

// Aliases de teclas a nombre canónico.
const KEY_ALIASES = {
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  esc: 'Esc',
  escape: 'Esc',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  // Cmd en macOS lo tratamos como Meta (compatible con Windows).
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  super: 'Meta',
  win: 'Meta',
  // Símbolos comunes.
  '?': '?',
  '/': '/',
};

/**
 * Normaliza un combo arbitrario ("ctrl+shift+k", "Ctrl + S", "Cmd+S", etc.)
 * al formato canónico "Ctrl+Shift+K".
 */
export function normalizeCombo(combo) {
  if (typeof combo !== 'string') return '';
  const trimmed = combo.trim();
  if (!trimmed) return '';
  // Separamos por '+' (con o sin espacios).
  const parts = trimmed
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return '';

  const mods = new Set();
  let key = '';
  for (const raw of parts) {
    const lower = raw;
    if (lower === 'ctrl' || lower === 'control') mods.add('Ctrl');
    else if (lower === 'alt' || lower === 'option') mods.add('Alt');
    else if (lower === 'shift') mods.add('Shift');
    else if (
      lower === 'cmd' ||
      lower === 'command' ||
      lower === 'meta' ||
      lower === 'super' ||
      lower === 'win'
    ) {
      mods.add('Meta');
    } else {
      key = KEY_ALIASES[lower] || (lower.length === 1 ? lower.toUpperCase() : raw);
    }
  }
  if (!key) return '';

  // Caso especial: "?" se representa como "Shift+/", no como "?" suelta.
  if (key === '?' && !mods.has('Shift')) {
    mods.add('Shift');
    key = '/';
  }

  // Mayúscula inicial en la tecla principal, salvo teclas especiales.
  if (key.length > 1 && /^[a-z]/.test(key)) {
    key = key.charAt(0).toUpperCase() + key.slice(1);
  }

  const orderedMods = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...orderedMods, key].join('+');
}

/**
 * Convierte un evento KeyboardEvent en un combo canónico.
 * Retorna '' si no se puede representar.
 */
export function eventToCombo(event) {
  if (!event) return '';
  // Ignorar auto-repeat para que no se dispare varias veces la misma acción.
  // (El caller puede decidir si lo respeta o no.)
  const key = event.key;
  if (!key) return '';

  // Filtrar teclas que claramente no son shortcuts.
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
    return '';
  }

  const mods = new Set();
  if (event.ctrlKey) mods.add('Ctrl');
  if (event.altKey) mods.add('Alt');
  if (event.shiftKey) mods.add('Shift');
  if (event.metaKey) mods.add('Meta');

  let keyName = key;
  // El navegador reporta "?" como tal cuando se presiona Shift+/.
  if (key === '?') {
    mods.add('Shift');
    keyName = '/';
  }
  if (key.length === 1) {
    keyName = key.toUpperCase();
  } else {
    // "Enter", "Escape", "ArrowUp", etc.
    const lower = key.toLowerCase();
    keyName = KEY_ALIASES[lower] || (key.length === 1 ? key.toUpperCase() : key);
  }

  const orderedMods = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...orderedMods, keyName].join('+');
}

/**
 * Formatea un combo canónico para mostrarlo en UI.
 *  - Ctrl -> ⌃ / Ctrl (dependiendo de la plataforma)
 *  - Meta -> ⌘ en mac, Ctrl en win/linux
 *  - Devuelve una versión amigable: "Ctrl + S", "F3", "Shift + /"
 */
export function formatComboForDisplay(combo) {
  const norm = normalizeCombo(combo);
  if (!norm) return '';
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

  return norm
    .split('+')
    .map((part) => {
      if (part === 'Ctrl') return isMac ? '⌃' : 'Ctrl';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Meta') return isMac ? '⌘' : 'Ctrl';
      if (part === 'Space') return 'Espacio';
      if (part === 'Esc') return 'Esc';
      if (part === 'Enter') return 'Enter';
      if (part === 'Backspace') return '⌫';
      if (part === 'Tab') return 'Tab';
      if (part === 'ArrowUp') return '↑';
      if (part === 'ArrowDown') return '↓';
      if (part === 'ArrowLeft') return '←';
      if (part === 'ArrowRight') return '→';
      return part;
    })
    .join(' + ');
}

/**
 * Devuelve la etiqueta corta (para badges en botones).
 *  "Ctrl+Shift+K" -> "⌃⇧K" (mac) / "Ctrl+Shift+K" (win)
 */
export function formatComboBadge(combo) {
  const norm = normalizeCombo(combo);
  if (!norm) return '';
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  if (isMac) {
    return norm
      .split('+')
      .map((p) => {
        if (p === 'Ctrl') return '⌃';
        if (p === 'Alt') return '⌥';
        if (p === 'Shift') return '⇧';
        if (p === 'Meta') return '⌘';
        if (p === 'Enter') return '⏎';
        if (p === 'Backspace') return '⌫';
        if (p === 'Space') return '␣';
        return p;
      })
      .join('');
  }
  return norm; // En win/linux dejamos el texto completo, ya es corto.
}

/**
 * Compara si dos combos (posiblemente en formatos distintos) son iguales.
 * Usa normalizeCombo internamente.
 */
export function combosEqual(a, b) {
  return normalizeCombo(a) === normalizeCombo(b);
}

/**
 * Devuelve un mapa { id: combo } con los defaults del catálogo.
 */
export function getDefaultShortcutsMap() {
  const m = {};
  for (const s of SHORTCUT_CATALOG) m[s.id] = s.defaultCombo;
  return m;
}
