/**
 * Socket.IO React Context
 *
 * Provides a single shared WebSocket connection across the app.
 * Auto-connects with JWT auth, reconnects on network drop AND on same-tab login.
 *
 * Usage:
 *   const { socket, connected, on, off } = useSocket();
 *   useEffect(() => {
 *     const handler = (data) => console.log(data);
 *     on('order_status_updated', handler);
 *     return () => off('order_status_updated', handler);
 *   }, [on, off]);
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl, rotateApiBaseUrl } from '../config/apiBase';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  /** Subscribe to a Socket.IO event */
  on: (event: string, handler: (...args: any[]) => void) => void;
  /** Unsubscribe from a Socket.IO event */
  off: (event: string, handler: (...args: any[]) => void) => void;
  /** Emit an event to the server */
  emit: (event: string, ...args: any[]) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
  on: () => {},
  off: () => {},
  emit: () => {},
});

function getAuthToken(): string | null {
  const path = window.location.pathname;
  if (path.startsWith('/shop')) {
    return localStorage.getItem('consumer_token') || localStorage.getItem('token');
  }
  return localStorage.getItem('token') || localStorage.getItem('consumer_token');
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Subscription registry: survives socket instance replacement on reconnect
  // Map<event, Set<handler>> — re-registered on every new socket
  const subsRef = useRef<Map<string, Set<(...args: any[]) => void>>>(new Map());

  /** Attach all registered subscriptions to the given socket instance */
  function rehydrate(sock: Socket) {
    subsRef.current.forEach((handlers, event) => {
      handlers.forEach(handler => sock.on(event, handler));
    });
  }

  /** Create a fresh socket with the current token. Tears down any existing one. */
  const initSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnected(false);
    }

    const token = getAuthToken();
    if (!token) return;

    const baseUrl = getApiBaseUrl() || window.location.origin;

    const sock = io(baseUrl, {
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    sock.on('connect', () => {
      console.log('[ws] connected', sock.id);
      setConnected(true);
    });
    sock.on('disconnect', (reason) => {
      console.log('[ws] disconnected:', reason);
      setConnected(false);
    });
    sock.on('connect_error', (err) => {
      console.warn('[ws] connect error:', err.message);
      const msg = String(err.message || '');
      const authFailure = /No auth token|Invalid token|jwt|unauthorized/i.test(msg);
      if (!authFailure) {
        const nextBase = rotateApiBaseUrl();
        if (nextBase) {
          console.warn('[ws] retrying with next API base:', nextBase);
          setTimeout(() => initSocket(), 300);
          return;
        }
      }
      setConnected(false);
    });

    // Re-attach all subscriptions that were registered before this socket existed
    rehydrate(sock);

    socketRef.current = sock;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial connect on mount
  useEffect(() => {
    initSocket();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect on auth changes:
  // - cross-tab: native `storage` event fires automatically
  // - same-tab:  AuthContext dispatches `tradehub-auth-changed` custom event
  useEffect(() => {
    const handleAuthChanged = () => initSocket();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'token' || e.key === 'consumer_token') initSocket();
    };
    window.addEventListener('tradehub-auth-changed', handleAuthChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('tradehub-auth-changed', handleAuthChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [initSocket]);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    // Register in the persistent registry
    if (!subsRef.current.has(event)) subsRef.current.set(event, new Set());
    subsRef.current.get(event)!.add(handler);
    // Also attach to the live socket if it exists
    socketRef.current?.on(event, handler);
  }, []);

  const off = useCallback((event: string, handler: (...args: any[]) => void) => {
    // Remove from the persistent registry
    subsRef.current.get(event)?.delete(handler);
    // Detach from the live socket
    socketRef.current?.off(event, handler);
  }, []);

  const emit = useCallback((event: string, ...args: any[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected, on, off, emit }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
