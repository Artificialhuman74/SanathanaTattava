import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LocationPrompt from '../components/LocationPrompt';
import api from '../api/axios';
import {
  Home, Package, Clock, User, Truck, ToggleLeft, ToggleRight,
} from 'lucide-react';

export default function DeliveryLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(false);
  const [toggling, setToggling] = useState(false);

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
    { to: '/delivery/dashboard', icon: Home,    label: 'Dashboard' },
    { to: '/delivery/orders',    icon: Package,  label: 'Orders' },
    { to: '/delivery/history',   icon: Clock,    label: 'History' },
    { to: '/delivery/profile',   icon: User,     label: 'Profile' },
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

      {/* Bottom Tab Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex z-40">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 pt-3 transition-colors ${
                isActive
                  ? 'text-emerald-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
