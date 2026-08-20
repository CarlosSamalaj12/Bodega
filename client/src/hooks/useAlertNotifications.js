import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '@/services/socket';
import { existenciasService } from '@/services/existencias.service';
import { requestNotificationPermission, showAlertaNotification } from '@/services/notification.service';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/components/ui/Toast';
import { playAlertCriticalSound, playNotificationSound } from '@/utils/sound';
import { useStockScope } from '@/hooks/useStockScope';
import { isEventForCurrentBodega } from '@/utils/notifyScope';
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
  const navigate = useNavigate();
  // Scope de bodegas para que las notificaciones respeten el rol:
  // admin/reportes con restricción (REPORTE) solo ven lo de sus bodegas
  // permitidas; el bodeguero solo ve lo de SU bodega.
  const { scope: stockScope } = useStockScope();
  const canAllBodegas = Boolean(stockScope?.can_all_bodegas);
  const allowedBodegaIds = Array.isArray(stockScope?.allowed_warehouse_ids)
    ? stockScope.allowed_warehouse_ids
    : [];

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
                navigate('/alertas');
              },
              actionLabel: 'Ver alertas',
            });
          }
        }
      }
    } catch {
      // Silencioso — no mostrar error al usuario
    }
  }, [user?.id_warehouse, navigate]);

  useEffect(() => {
    if (!user?.id_warehouse) return;

    // 1. Solicitar permiso de notificaciones (solo una vez)
    if (!permSolicitado) {
      permSolicitado = true;
      requestNotificationPermission().catch(() => {});
    }

    // 2. Cargar snapshot inicial
    checkAlertas();

    // 3. Conectar Socket.IO y escuchar eventos push
    let socket;
    try {
      socket = getSocket();
    } catch {
      return;
    }

    const handlePedidoChanged = () => {
      checkAlertas();
    };

    const handleStockChanged = (payload) => {
      // Filtro por bodega: si el evento no toca la bodega del usuario
      // (o las bodegas permitidas si es admin/reportes con restricción),
      // NO mostrar toast ni recargar alertas. Esto evita que un bodeguero
      // vea notificaciones de entradas/salidas de otras áreas.
      //
      // Antes esta condición era `!payloadBodega || !myBodega ||
      // payloadBodega === myBodega`, que dejaba pasar TODO cuando
      // faltaba el id_bodega en el payload (p.ej. catalog_changed),
      // provocando que se mostrara el toast también en esos casos.
      const isMine = isEventForCurrentBodega(payload, {
        userBodegaId: user?.id_warehouse,
        canAllBodegas,
        allowedBodegaIds,
      });

      if (!isMine) return;

      checkAlertas();

      if (payload?.action === 'entrada') {
        toast.success(`Entrada registrada en ${payload.nombre_bodega || 'tu bodega'}`);
      } else if (payload?.action === 'salida') {
        toast.info(`Salida registrada en ${payload.nombre_bodega || 'tu bodega'}`);
      }
    };

    socket.on('pedido:changed', handlePedidoChanged);
    socket.on('stock:changed', handleStockChanged);

    return () => {
      socket.off('pedido:changed', handlePedidoChanged);
      socket.off('stock:changed', handleStockChanged);
    };
  }, [user?.id_warehouse, checkAlertas, canAllBodegas, allowedBodegaIds]);

  return null;
}
