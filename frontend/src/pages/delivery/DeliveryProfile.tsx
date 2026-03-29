import React, { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import {
  User, Mail, Phone, MapPin, LogOut, Loader2, CheckCircle2,
  XCircle, TrendingUp, Clock, DollarSign, ToggleLeft, ToggleRight,
  Package, Truck,
} from 'lucide-react';

interface DeliveryContext {
  isOnline: boolean;
  toggleAvailability: () => Promise<void>;
  toggling: boolean;
}

export default function DeliveryProfile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { isOnline, toggleAvailability, toggling } = useOutletContext<DeliveryContext>();

  const [stats, setStats] = useState<any>(null);
  const [commissions, setCommissions] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, commRes] = await Promise.all([
        api.get('/delivery/stats'),
        api.get('/trader/commissions').catch(() => ({ data: {} })),
      ]);
      setStats(statsRes.data.stats || null);
      setCommissions(commRes.data);
    } catch {
      // Stats are best-effort
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/delivery/login', { replace: true });
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
    </div>
  );

  const totalDeliveries = stats?.total_deliveries || 0;
  const completed = stats?.completed || 0;
  const failed = stats?.failed || 0;
  const successRate = totalDeliveries > 0 ? Math.round((completed / totalDeliveries) * 100) : 0;
  const avgTime = stats?.avg_delivery_minutes;
  const totalEarned = parseFloat(commissions?.summary?.total_amount || commissions?.total_earned || '0');
  const pendingEarned = parseFloat(commissions?.summary?.pending_amount || commissions?.pending_amount || '0');

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Profile Card */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 p-5 pb-12 relative">
          <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        </div>
        <div className="px-5 pb-5 -mt-8 relative">
          <div className="w-16 h-16 rounded-full bg-emerald-600 border-4 border-white flex items-center justify-center shadow-lg">
            <span className="text-2xl font-bold text-white">
              {user?.name?.[0]?.toUpperCase() || 'D'}
            </span>
          </div>
          <div className="mt-3">
            <h2 className="text-lg font-bold text-slate-800">{user?.name}</h2>
            <p className="text-sm text-slate-500">Delivery Partner</p>
          </div>
          <div className="mt-3 space-y-2">
            {user?.email && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Mail className="w-4 h-4 text-slate-400" />
                {user.email}
              </div>
            )}
            {user?.phone && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Phone className="w-4 h-4 text-slate-400" />
                {user.phone}
              </div>
            )}
            {user?.address && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <MapPin className="w-4 h-4 text-slate-400" />
                {user.address}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delivery Stats */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Delivery Stats</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <Package className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-slate-800">{totalDeliveries}</p>
            <p className="text-[10px] text-slate-500">Total Deliveries</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <TrendingUp className="w-5 h-5 text-blue-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-slate-800">{successRate}%</p>
            <p className="text-[10px] text-slate-500">Success Rate</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <XCircle className="w-5 h-5 text-red-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-slate-800">{failed}</p>
            <p className="text-[10px] text-slate-500">Failed</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-center">
            <Clock className="w-5 h-5 text-orange-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-slate-800">{avgTime ? `${avgTime}m` : '-'}</p>
            <p className="text-[10px] text-slate-500">Avg Time</p>
          </div>
        </div>
      </div>

      {/* Commission */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Commission Earnings</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-medium text-emerald-600">Total Earned</span>
            </div>
            <p className="text-lg font-bold text-emerald-700">₹{totalEarned.toFixed(2)}</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-600">Pending</span>
            </div>
            <p className="text-lg font-bold text-amber-700">₹{pendingEarned.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Availability Toggle */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Availability</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isOnline ? 'You are accepting delivery orders' : 'You are currently offline'}
            </p>
          </div>
          <button
            onClick={toggleAvailability}
            disabled={toggling}
            className="p-1 disabled:opacity-50"
          >
            {isOnline
              ? <ToggleRight className="w-10 h-10 text-emerald-600" />
              : <ToggleLeft className="w-10 h-10 text-slate-400" />
            }
          </button>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[48px] border border-red-200"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  );
}
