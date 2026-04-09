import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Package, Users, ShoppingBag,
  DollarSign, LogOut, Menu, X, ChevronRight,
  UserCheck, Settings, Warehouse, Truck,
} from 'lucide-react';
import NotificationBell from '../components/NotificationBell';

const navItems = [
  { to: '/admin/dashboard',       icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/inventory',       icon: Package,         label: 'Inventory' },
  { to: '/admin/traders',         icon: Users,           label: 'Traders' },
  { to: '/admin/consumer-orders', icon: ShoppingBag,     label: 'Consumer Orders' },
  { to: '/admin/consumers',       icon: UserCheck,       label: 'Consumers' },
  { to: '/admin/dealer-inventory', icon: Warehouse,       label: 'Dealer Inventory' },
  { to: '/admin/commissions',     icon: DollarSign,      label: 'Commissions' },
  { to: '/admin/settings',        icon: Settings,        label: 'Settings' },
  { to: '/delivery/login',        icon: Truck,           label: 'Delivery' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`flex flex-col h-full bg-gradient-to-b from-[#0d1f10] to-[#1a3d20] ${mobile ? 'w-72' : 'w-64'}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
        <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-9 w-9 object-contain rounded-lg flex-shrink-0" alt="Sanathana Tattva" />
        <span className="text-white font-bold text-sm leading-tight">Sanathana Tattva</span>
        {mobile && (
          <button onClick={() => setSidebarOpen(false)} className="ml-auto text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-3">Navigation</p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to} to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <Icon className="flex-shrink-0" size={18} />
            <span>{label}</span>
            <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100" size={14} />
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-default">
          <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{user?.name?.[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.name}</p>
            <p className="text-slate-400 text-xs">Administrator</p>
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
    <div className="flex h-screen bg-parchment-100 overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex flex-col flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex flex-col h-full">
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-parchment-300 flex items-center px-4 sm:px-6 gap-4 flex-shrink-0 z-10">
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-slate-800 hidden sm:block">Admin Panel</h1>
          </div>
          <NotificationBell variant="admin" />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{user?.name?.[0]?.toUpperCase()}</span>
            </div>
            <span className="text-sm font-medium text-slate-700 hidden sm:block">{user?.name}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
