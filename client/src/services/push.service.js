/**
 * PushService — Maneja la suscripción a notificaciones push
 * usando la Push API del navegador con Service Worker.
 *
 * Flujo:
 * 1. Obtener la llave pública VAPID del servidor
 * 2. Registrar el Service Worker
 * 3. Suscribirse a notificaciones push
 * 4. Enviar la suscripción al servidor
 */

import api from './api';

let swRegistration = null;
let vapidPublicKey = null;

/**
 * Inicializa el servicio: obtiene la llave VAPID y registra el SW.
 * Debe llamarse después del login.
 */
export async function initPushService() {
  // En dev (Vite, puerto 5173) no existe SW propio: vive en el build de
  // producción servido por Express. Suscribirse aquí solo genera AbortError.
  if (import.meta.env.DEV) return false;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[push] Push API no disponible');
    return false;
  }

  try {
    // Obtener VAPID key del servidor
    const { data } = await api.get('/api/push/vapid-key');
    vapidPublicKey = data.publicKey;
    if (!vapidPublicKey) return false;

    // Obtener o esperar el SW registrado por vite-plugin-pwa
    swRegistration = await navigator.serviceWorker.ready;
    return true;
  } catch (e) {
    console.warn('[push] Error al inicializar:', e);
    return false;
  }
}

/**
 * Verifica si ya hay una suscripción activa.
 */
export async function getExistingSubscription() {
  if (!swRegistration) return null;
  try {
    return await swRegistration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Solicita permiso de notificaciones y se suscribe a Push.
 * @param {number} idBodega - ID de la bodega del usuario
 * @returns {Promise<boolean>}
 */
export async function subscribeToPush(idBodega) {
  if (!swRegistration || !vapidPublicKey) {
    const ok = await initPushService();
    if (!ok) return false;
  }

  // Solicitar permiso de notificaciones si no lo tenemos
  if (Notification.permission === 'denied') {
    console.log('[push] Permiso denegado');
    return false;
  }

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return false;
  }

  try {
    // Verificar si ya hay suscripción
    const existing = await swRegistration.pushManager.getSubscription();
    if (existing) {
      // Ya suscrito, enviar al servidor por si acaso
      const sub = existing.toJSON();
      await api.post('/api/push/subscribe', {
        endpoint: sub.endpoint,
        keys: sub.keys,
        id_bodega: idBodega || null,
      });
      return true;
    }

    // Convertir VAPID key a Uint8Array para la API de Push
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // Suscribirse
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const sub = subscription.toJSON();

    // Enviar al servidor
    await api.post('/api/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.keys,
      id_bodega: idBodega || null,
    });

    return true;
  } catch (e) {
    console.warn('[push] Error al suscribir:', e);
    return false;
  }
}

/**
 * Cancela la suscripción push.
 */
export async function unsubscribeFromPush() {
  if (!swRegistration) return false;

  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) return true;

    // Notificar al servidor
    const sub = subscription.toJSON();
    await api.post('/api/push/unsubscribe', {
      endpoint: sub.endpoint,
    }).catch(() => {});

    // Cancelar la suscripción local
    await subscription.unsubscribe();
    return true;
  } catch (e) {
    console.warn('[push] Error al desuscribir:', e);
    return false;
  }
}

/**
 * Convierte una cadena base64 estándar a Uint8Array
 * (necesario para la Push API).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
