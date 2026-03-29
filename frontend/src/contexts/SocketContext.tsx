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
  return localStorage.getItem('token') || localStorage.getItem('consumer_token');
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef   = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  /** Create a fresh socket with the current token. Tears down any existing one. */
  const initSocket = useCallback(() => {
    // Tear down existing socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setConnected(false);
    }

    const token = getAuthToken();
    if (!token) return;

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;

    const sock = io(baseUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
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
      setConnected(false);
    });

    socketRef.current = sock;
  }, []);

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
    socketRef.current?.on(event, handler);
  }, []);

  const off = useCallback((event: string, handler: (...args: any[]) => void) => {
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
