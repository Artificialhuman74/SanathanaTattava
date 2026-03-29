import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/axios';
import { consumerApi } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { Bell, CheckCheck, Package, MapPin, AlertTriangle, X, Volume2, VolumeX, BellRing } from 'lucide-react';
import {
  playNotificationSound,
  requestNotificationPermission,
  showBrowserNotification,
  isNotificationPermitted,
} from '../services/notificationSound';

interface Notification {
  id: number;
  user_type?: string;
  user_id?: number;
  title: string;
  body: string;
  data: string | null;
  channel?: string;
  read: number;
  created_at: string;
}

interface NotificationBellProps {
  /** 'dealer' for trader layouts, 'admin' for admin layout, 'consumer' for consumer layout */
  variant?: 'dealer' | 'admin' | 'consumer';
}

const SOUND_KEY = 'tradehub_sound_enabled';

export default function NotificationBell({ variant = 'dealer' }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [open, setOpen]                   = useState(false);
  const [soundEnabled, setSoundEnabled]   = useState(() => {
    return localStorage.getItem(SOUND_KEY) !== 'false'; // default ON
  });
  const [pushPermission, setPushPermission] = useState<string>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [animateBell, setAnimateBell] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { on, off } = useSocket();
  const isFirstLoad = useRef(true);

  const endpoint = variant === 'consumer'
    ? '/notifications/consumer'
    : variant === 'admin'
      ? '/notifications/admin'
      : '/notifications/dealer';
  const http = variant === 'consumer' ? consumerApi : api;

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await http.get(endpoint);
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch { /* ignore */ }
  }, [endpoint]);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
    isFirstLoad.current = false;
  }, [fetchNotifications]);

  // Request browser notification permission on mount (one-time)
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // We'll ask on the first real notification instead, to avoid
      // annoying users on page load. See handler below.
    }
  }, []);

  // Real-time push via WebSocket
  useEffect(() => {
    const handler = (notif: Notification) => {
      setNotifications(prev => [{ ...notif, read: 0 }, ...prev]);
      setUnreadCount(prev => prev + 1);

      // Play sound
      if (soundEnabled) {
        playNotificationSound();
      }

      // Animate bell icon
      setAnimateBell(true);
      setTimeout(() => setAnimateBell(false), 1000);

      // Browser push notification (if tab not focused or dropdown closed)
      if (document.hidden || !open) {
        if (isNotificationPermitted()) {
          showBrowserNotification(notif.title, notif.body, {
            icon: '/tradehub-icon.svg',
            tag: `tradehub-notif-${notif.id}`,
            onClick: () => {
              window.focus();
            },
          });
        } else if ('Notification' in window && Notification.permission === 'default') {
          // First real notification — request permission
          requestNotificationPermission().then(granted => {
            setPushPermission(granted ? 'granted' : 'denied');
            if (granted) {
              showBrowserNotification(notif.title, notif.body, {
                icon: '/tradehub-icon.svg',
                tag: `tradehub-notif-${notif.id}`,
              });
            }
          });
        }
      }
    };
    on('notification', handler);
    return () => off('notification', handler);
  }, [on, off, soundEnabled, open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAsRead = async (id: number) => {
    try {
      await http.put(`${endpoint}/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await http.put(`${endpoint}/read-all`);
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const toggleSound = () => {
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    localStorage.setItem(SOUND_KEY, String(newVal));
    if (newVal) playNotificationSound(); // play a preview
  };

  const enablePushNotifications = async () => {
    const granted = await requestNotificationPermission();
    setPushPermission(granted ? 'granted' : 'denied');
    if (granted) {
      showBrowserNotification('Notifications enabled', 'You will now receive push notifications from TradeHub.', {
        icon: '/tradehub-icon.svg',
      });
    }
  };

  const getIcon = (title: string) => {
    if (title.includes('routed'))   return <MapPin size={14} className="text-amber-500" />;
    if (title.includes('delivery') || title.includes('Delivery')) return <Package size={14} className="text-brand-500" />;
    if (title.includes('stock'))    return <AlertTriangle size={14} className="text-red-500" />;
    if (title.includes('order') || title.includes('Order')) return <Package size={14} className="text-indigo-500" />;
    return <Bell size={14} className="text-slate-400" />;
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
      >
        <Bell className={`w-5 h-5 transition-transform ${animateBell ? 'animate-wiggle' : ''}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200 z-50 max-h-[70vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-sm">Notifications</h3>
            <div className="flex items-center gap-2">
              {/* Sound toggle */}
              <button
                onClick={toggleSound}
                className={`p-1 rounded transition-colors ${soundEnabled ? 'text-brand-600 hover:text-brand-700' : 'text-slate-300 hover:text-slate-400'}`}
                title={soundEnabled ? 'Sound on — click to mute' : 'Sound off — click to unmute'}
              >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Push notification prompt */}
          {'Notification' in window && pushPermission === 'default' && (
            <button
              onClick={enablePushNotifications}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-50 border-b border-brand-100 text-xs text-brand-700 font-medium hover:bg-brand-100 transition-colors"
            >
              <BellRing size={14} />
              Enable push notifications to stay updated even when this tab is in background
            </button>
          )}

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell size={28} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`flex gap-3 px-4 py-3 border-b border-slate-50 transition-colors cursor-pointer hover:bg-slate-50 ${
                    n.read === 0 ? 'bg-brand-50/50' : ''
                  }`}
                  onClick={() => n.read === 0 && markAsRead(n.id)}
                >
                  <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center">
                    {getIcon(n.title)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${n.read === 0 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  {n.read === 0 && (
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-2 h-2 rounded-full bg-brand-500" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
