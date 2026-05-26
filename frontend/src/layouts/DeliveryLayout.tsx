import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import LocationPrompt from '../components/LocationPrompt';
import api from '../api/axios';
import {
  Home, Package, Clock, User, Truck, ToggleLeft, ToggleRight, RotateCcw, Wifi, WifiOff,
} from 'lucide-react';

export default function DeliveryLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { on, off, connected } = useSocket();
  const [isOnline, setIsOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [pickupAlerts, setPickupAlerts] = useState(0);
  const [orderAlerts, setOrderAlerts]   = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Live updates: new pickup tasks + order status changes bump a tab
   * badge so the driver notices without polling. Badges clear when the
   * driver actually navigates to that section. */
  useEffect(() => {
    const onHoldingUpdate = (p: any) => {
      if (p?.event === 'refund_requested') {
        setPickupAlerts(c => c + 1);
        showToast('New container pickup requested');
      }
    };
    const onOrderUpdate = (p: any) => {
      if (['pending', 'confirmed', 'processing'].includes(p?.status)) {
        setOrderAlerts(c => c + 1);
      }
    };
    on('container_holding_update', onHoldingUpdate);
    on('order_status_updated', onOrderUpdate);
    return () => {
      off('container_holding_update', onHoldingUpdate);
      off('order_status_updated', onOrderUpdate);
    };
  }, [on, off]);

  useEffect(() => {
    if (location.pathname.startsWith('/delivery/pickups')) setPickupAlerts(0);
    if (location.pathname.startsWith('/delivery/orders'))  setOrderAlerts(0);
  }, [location.pathname]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    api.get('/location/dealer/me').then(({ data }) => {
      const loc = data.location || data;
      setIsOnline(loc.availability_status === 'available');
    }).catch(() => {});
  }, []);

  const toggleAvailability = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const newStatus = isOnline ? 'offline' : 'available';
      await api.put('/location/dealer/availability', { status: newStatus });
      setIsOnline(newStatus === 'available');
    } catch {
      // revert silently
    } finally {
      setToggling(false);
    }
  };

  const tabs = [
    { to: '/delivery/dashboard', icon: Home,      label: 'Dashboard', badge: 0 },
    { to: '/delivery/orders',    icon: Package,   label: 'Orders',    badge: orderAlerts },
    { to: '/delivery/pickups',   icon: RotateCcw, label: 'Pickups',   badge: pickupAlerts },
    { to: '/delivery/history',   icon: Clock,     label: 'History',   badge: 0 },
    { to: '/delivery/profile',   icon: User,      label: 'Profile',   badge: 0 },
  ];

  return (
    <div className="flex flex-col h-screen bg-parchment-100">
      <LocationPrompt />

      {/* Top Header */}
      <header className="bg-[#14532d] text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-8 w-8 object-contain rounded-lg flex-shrink-0" alt="logo" />
          <div>
            <h1 className="text-sm font-bold leading-tight">Sanathana Tattva Delivery</h1>
            <p className="text-xs text-emerald-100 leading-tight">{user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            title={connected ? 'Live updates active' : 'Reconnecting…'}
            className={`flex items-center ${connected ? 'text-emerald-200' : 'text-amber-200'}`}
          >
            {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4 animate-pulse" />}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isOnline ? 'bg-green-400/30 text-white' : 'bg-white/20 text-green-100'
          }`}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
          <button
            onClick={toggleAvailability}
            disabled={toggling}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            aria-label="Toggle availability"
          >
            {isOnline
              ? <ToggleRight className="w-7 h-7 text-emerald-200" />
              : <ToggleLeft className="w-7 h-7 text-emerald-300/60" />
            }
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet context={{ isOnline, toggleAvailability, toggling }} />
      </main>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-3 py-2 rounded-full shadow-lg animate-pulse">
          {toast}
        </div>
      )}

      {/* Bottom Tab Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-40">
        {tabs.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `relative flex-1 flex flex-col items-center justify-center py-2 pt-3 transition-colors ${
                isActive
                  ? 'text-emerald-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <div className="relative">
              <Icon className="w-5 h-5" />
              {badge > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-1 text-[9px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium mt-1">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
