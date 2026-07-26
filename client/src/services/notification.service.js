/**
 * NotificationService — maneja permisos de notificaciones del navegador
 * y muestra notificaciones del sistema.
 *
 * No depende de Push API ni de service worker. Usa la Notification API
 * del navegador para mostrar notificaciones en desktop/móvil cuando la
 * app está en segundo plano.
 */

let permissionGranted = false;
let lastNotified = new Map(); // key → timestamp para evitar duplicados

const NOTIFICATION_COOLDOWN_MS = 60_000; // 1 min entre notificaciones iguales

/**
 * Solicita permiso para notificaciones del navegador.
 * @returns {Promise<boolean>} true si el permiso fue concedido
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('[notif] Notification API no disponible');
    return false;
  }

  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return true;
  }

  if (Notification.permission === 'denied') {
    console.log('[notif] Permiso denegado previamente');
    return false;
  }

  try {
    const result = await Notification.requestPermission();
    permissionGranted = result === 'granted';
    return permissionGranted;
  } catch (e) {
    console.warn('[notif] Error al solicitar permiso:', e);
    return false;
  }
}

/**
 * Muestra una notificación del sistema si hay permiso.
 * @param {string} title - Título de la notificación
 * @param {object} opts
 * @param {string} [opts.body] - Cuerpo del mensaje
 * @param {string} [opts.icon] - URL del ícono
 * @param {string} [opts.tag] - Tag único para agrupar notificaciones
 * @param {Function} [opts.onClick] - Callback al hacer clic
 * @returns {boolean} true si se mostró la notificación
 */
export function showNotification(title, opts = {}) {
  if (!permissionGranted && Notification?.permission !== 'granted') {
    return false;
  }

  const tag = opts.tag || title;
  const lastTime = lastNotified.get(tag) || 0;
  if (Date.now() - lastTime < NOTIFICATION_COOLDOWN_MS) {
    return false; // evitar spam
  }

  try {
    const notif = new Notification(title, {
      body: opts.body || '',
      icon: opts.icon || '/icon-192x192.png',
      tag,
      requireInteraction: true,
      silent: false,
    });

    lastNotified.set(tag, Date.now());

    if (typeof opts.onClick === 'function') {
      notif.onclick = () => {
        window.focus();
        opts.onClick();
        notif.close();
      };
    }

    // Auto-cerrar después de 10 segundos si no hay interacción
    setTimeout(() => notif.close(), 10_000);

    return true;
  } catch (e) {
    console.warn('[notif] Error al mostrar notificación:', e);
    return false;
  }
}

/**
 * Muestra una notificación de alerta de stock (vencimiento o mínimo).
 * @param {object} alerta - Objeto de alerta
 */
export function showAlertaNotification(alerta) {
  const tipo = getTipoAlertaNotif(alerta);
  if (!tipo) return;

  const title = `⚠️ ${tipo.emoji} ${tipo.label}`;
  const body = [
    alerta.nombre_producto,
    alerta.sku ? `SKU: ${alerta.sku}` : '',
    alerta.nombre_bodega ? `Bodega: ${alerta.nombre_bodega}` : '',
    alerta.stock != null ? `Stock: ${Number(alerta.stock)}` : '',
    alerta.minimo != null ? `Mínimo: ${Number(alerta.minimo)}` : '',
    alerta.dias_para_vencer != null
      ? `Vence en: ${alerta.dias_para_vencer >= 0 ? alerta.dias_para_vencer + ' días' : Math.abs(alerta.dias_para_vencer) + ' días atrás'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const tag = `alerta-${alerta.id_bodega}-${alerta.id_producto}-${alerta.lote || 'nolote'}`;

  showNotification(title, {
    body,
    tag,
    onClick: () => {
      // Navegar a la página de alertas al hacer clic
      window.location.href = '/alertas';
    },
  });
}

/**
 * Determina el tipo de alerta para la notificación.
 */
function getTipoAlertaNotif(item) {
  const dias = item.dias_para_vencer;

  // Prioridad: mínimo stock > vencido > próximo a vencer > regla
  if (item.minimo != null && item.stock != null && Number(item.stock) < Number(item.minimo)) {
    return { label: 'Stock por debajo del mínimo', emoji: '📦' };
  }

  if (dias != null && dias < 0) {
    return { label: 'Producto vencido', emoji: '❌' };
  }

  if (dias != null && dias <= 3) {
    return { label: 'Vence pronto', emoji: '🔥' };
  }

  if (dias != null && dias <= 7) {
    return { label: 'Próximo a vencer', emoji: '⏰' };
  }

  if (item.dias_restantes_regla != null && item.dias_restantes_regla <= 0) {
    return { label: 'Regla de subcategoría vencida', emoji: '📋' };
  }

  if (item.dias_restantes_regla != null && item.dias_alerta_antes != null && item.dias_restantes_regla <= item.dias_alerta_antes) {
    return { label: 'Regla de subcategoría próxima', emoji: '📋' };
  }

  return null;
}

export function isNotificationPermissionGranted() {
  return permissionGranted || Notification?.permission === 'granted';
}
