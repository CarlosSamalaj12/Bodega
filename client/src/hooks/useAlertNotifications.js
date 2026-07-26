import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/services/socket';
import { existenciasService } from '@/services/existencias.service';
import { requestNotificationPermission, showAlertaNotification } from '@/services/notification.service';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/components/ui/Toast';
import { playAlertCriticalSound, playNotificationSound } from '@/utils/sound';
import api from '@/services/api';

let alertasSnapshot = []; // caché compartido entre instancias del hook
let permSolicitado = false;

/**
 * useAlertNotifications — Hook que monitorea alertas en tiempo real
 * y dispara notificaciones del navegador + toasts internos.
 *
 * Escucha eventos Socket.IO:
 *  - 'pedido:changed': cuando un pedido cambia (posible impacto en stock)
 *  - 'stock:changed': cuando se registra una entrada/salida/ajuste
 *
 * Cuando recibe un evento, vuelve a cargar las alertas y compara
 * con el snapshot anterior para detectar nuevas alertas críticas.
 */
export function useAlertNotifications() {
  const user = useAuthStore((s) => s.user);
  const intervalRef = useRef(null);
  const socketRef = useRef(null);

  const checkAlertas = useCallback(async () => {
    if (!user?.id_warehouse) return;

    try {
      const data = await existenciasService.alertas({ days: 30, limit: 200 });

      if (!Array.isArray(data)) return;

      const prevSnapshot = alertasSnapshot;
      alertasSnapshot = data;

      // Encontrar nuevas alertas críticas que no estaban antes
      if (prevSnapshot.length > 0) {
        const prevMap = new Map(
          prevSnapshot.map((a) => [
            `${a.id_bodega}-${a.id_producto}-${a.lote || ''}`,
            a,
          ])
        );

        for (const alerta of data) {
          const key = `${alerta.id_bodega}-${alerta.id_producto}-${alerta.lote || ''}`;
          const prev = prevMap.get(key);

          // Es nueva o empeoró
          const isNew = !prev;
          const isWorse =
            prev &&
            (Number(alerta.dias_para_vencer) < Number(prev.dias_para_vencer) ||
              (Number(alerta.stock) < Number(prev.stock) && Number(alerta.minimo) > 0));

          if (isNew || isWorse) {
            // Mostrar notificación del navegador
            showAlertaNotification(alerta);

            // Detectar si es crítica (vencida, stock mínimo crítico o vence hoy)
            const isCritical =
              (alerta.minimo && Number(alerta.stock) < Number(alerta.minimo) && Number(alerta.diferencia_minimo || 0) >= 5) ||
              (alerta.dias_para_vencer != null && alerta.dias_para_vencer <= 0);

            if (isCritical) {
              playAlertCriticalSound();
            } else {
              playNotificationSound();
            }

            // Enviar push al servidor para que notifique aunque la app esté cerrada
            api.post('/api/push/send-alertas', { alertas: [alerta] }).catch(() => {});

            // Mostrar toast interno
            const tipoLabel =
              alerta.minimo && Number(alerta.stock) < Number(alerta.minimo)
                ? 'Stock bajo'
                : Number(alerta.dias_para_vencer) < 0
                  ? 'Vencido'
                  : 'Próximo a vencer';

            toast.warn(`${tipoLabel}: ${alerta.nombre_producto}`, {
              duration: 8000,
              onClick: () => {
                window.location.href = '/alertas';
              },
              actionLabel: 'Ver alertas',
            });
          }
        }
      }
    } catch {
      // Silencioso — no mostrar error al usuario por polling
    }
  }, [user?.id_warehouse]);

  useEffect(() => {
    if (!user?.id_warehouse) return;

    // 1. Solicitar permiso de notificaciones (solo una vez)
    if (!permSolicitado) {
      permSolicitado = true;
      requestNotificationPermission().catch(() => {});
    }

    // 2. Cargar snapshot inicial
    checkAlertas();

    // 3. Conectar Socket.IO y escuchar eventos
    let socket;
    try {
      socket = getSocket();
      socketRef.current = socket;
    } catch {
      return;
    }

    const handlePedidoChanged = () => {
      checkAlertas();
    };

    const handleStockChanged = (payload) => {
      checkAlertas();

      // Mostrar toast de cambio de stock
      if (payload?.action === 'entrada') {
        toast.success(`Entrada registrada en ${payload.nombre_bodega || 'tu bodega'}`);
      } else if (payload?.action === 'salida') {
        toast.info(`Salida registrada en ${payload.nombre_bodega || 'tu bodega'}`);
      }
    };

    socket.on('pedido:changed', handlePedidoChanged);
    socket.on('stock:changed', handleStockChanged);

    // 4. Respaldo: refrescar cada 60s cuando la página está visible
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkAlertas();
      }
    }, 60_000);

    return () => {
      socket.off('pedido:changed', handlePedidoChanged);
      socket.off('stock:changed', handleStockChanged);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user?.id_warehouse, checkAlertas]);

  return null;
}
