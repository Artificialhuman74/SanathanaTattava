/**
 * useOrderUpdates — React hook for real-time order status updates.
 *
 * Usage:
 *   const { lastUpdate } = useOrderUpdates((update) => {
 *     // update = { orderId, orderNumber, status, deliveryStatus, timestamp }
 *     // Re-fetch your data or update local state
 *   });
 *
 * Or for a specific order:
 *   const { lastUpdate } = useOrderUpdates(handleUpdate, orderId);
 */

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';

export interface OrderUpdate {
  orderId: number;
  orderNumber: string;
  status: string;
  deliveryStatus: string | null;
  timestamp: string;
  otpSent?: boolean;
  failReason?: string;
}

export function useOrderUpdates(
  callback?: (update: OrderUpdate) => void,
  trackOrderId?: number,
) {
  const { on, off, emit } = useSocket();
  const [lastUpdate, setLastUpdate] = useState<OrderUpdate | null>(null);
  const cbRef = useRef(callback);
  cbRef.current = callback;

  // Subscribe to real-time order_status_updated events
  useEffect(() => {
    const handler = (data: OrderUpdate) => {
      setLastUpdate(data);
      cbRef.current?.(data);
    };

    on('order_status_updated', handler);
    return () => off('order_status_updated', handler);
  }, [on, off]);

  // Optionally join a specific order room for granular tracking
  useEffect(() => {
    if (trackOrderId) {
      emit('track_order', trackOrderId);
      return () => { emit('untrack_order', trackOrderId); };
    }
  }, [trackOrderId, emit]);

  return { lastUpdate };
}
