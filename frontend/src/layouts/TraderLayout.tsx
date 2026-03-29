import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, ShoppingCart,
  Users, DollarSign, QrCode, Warehouse, UserCircle,
  LogOut, Menu, X, TrendingUp, ChevronRight, Bell, Star,
} from 'lucide-react';
import LocationPrompt from '../components/LocationPrompt';
import NotificationBell from '../components/NotificationBell';

export default function TraderLayout() {
  const { user, logout, isTier1 } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { to: '/trader/dashboard',       icon: LayoutDashboard, label: 'Dashboard',       show: true },
    { to: '/trader/orders',           icon: ShoppingCart,    label: 'My Orders',       show: true },
    { to: '/trader/inventory',         icon: Warehouse,       label: 'My Inventory',    show: true },
    { to: '/trader/sub-dealers',      icon: Users,           label: 'Sub-Dealers',     show: isTier1 },
    { to: '/trader/commissions',      icon: DollarSign,      label: 'Commissions',     show: true },
    { to: '/trader/profile',          icon: UserCircle,      label: 'My Profile',      show: true },
  ].filter(item => item.show);

  const tierBadge = user?.tier === 1
    ? <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold flex items-center gap-1"><Star size={10} />Tier 1</span>
    : <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold">Sub-Dealer</span>;

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`flex flex-col h-full bg-gradient-to-b from-slate-900 to-slate-800 ${mobile ? 'w-72' : 'w-64'}`}>
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
        <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        <span className="text-white font-bold text-lg">TradeHub</span>
        {mobile && (
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-3">Navigation</p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to} to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={18} className="flex-shrink-0" />
            <span>{label}</span>
            <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100" size={14} />
          </NavLink>
        ))}

        {/* Referral Code quick access */}
        {user?.referral_code && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">My Referral Code</p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5">
              <QrCode size={14} className="text-slate-400 flex-shrink-0" />
              <span className="font-mono text-xs text-white/80 font-semibold">{user.referral_code}</span>
            </div>
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 p-3 rounded-xl cursor-default">
          <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{user?.name?.[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.name}</p>
            <div className="mt-0.5">{tierBadge}</div>
          </div>
        </div>
        <button onClick={handleLogout} className="sidebar-link w-full mt-1 text-red-400 hover:text-red-300 hover:bg-red-500/10">
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <LocationPrompt />
      <div className="hidden lg:flex flex-col flex-shrink-0">
        <Sidebar />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex flex-col h-full">
            <Sidebar mobile />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center px-4 sm:px-6 gap-4 flex-shrink-0">
          <button className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-500" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <span className="text-sm text-slate-500 hidden sm:block">
              Welcome back, <span className="font-semibold text-slate-800">{user?.name}</span>
            </span>
          </div>
          <NotificationBell />
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              {user?.tier === 1
                ? <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold"><Star size={10} />Tier 1</span>
                : <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold">Sub-Dealer</span>
              }
            </div>
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{user?.name?.[0]?.toUpperCase()}</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-slate-700">{user?.name}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
