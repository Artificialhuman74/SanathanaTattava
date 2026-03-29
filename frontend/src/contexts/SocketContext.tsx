/**
 * Socket.IO React Context
 *
 * Provides a single shared WebSocket connection across the app.
 * Auto-connects with JWT auth, auto-reconnects on drop.
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

/**
 * Determine which token to use.
 * Traders/admins use `token`, consumers use `consumer_token`.
 */
function getAuthToken(): string | null {
  return localStorage.getItem('token') || localStorage.getItem('consumer_token');
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef   = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      // No auth — disconnect if any
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    // In production VITE_API_URL points to the Railway backend.
    // In dev (no env var set) fall back to same origin (vite proxy handles it).
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

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, []);  // Only run once on mount

  // Reconnect when auth changes (login/logout)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'token' || e.key === 'consumer_token') {
        // Token changed — force reconnect
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
        const newToken = getAuthToken();
        if (newToken && socketRef.current) {
          socketRef.current.auth = { token: newToken };
          socketRef.current.connect();
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
