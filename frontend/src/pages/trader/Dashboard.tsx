import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useOrderUpdates } from '../../hooks/useOrderUpdates';
import api from '../../api/axios';
import {
  ShoppingBag, Package, Star, Users, ChevronRight, TrendingUp,
  Clock, CheckCircle2, DollarSign, Copy, Check, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-amber-100 text-amber-700',
  confirmed:  'bg-blue-100 text-blue-700',
  processing: 'bg-purple-100 text-purple-700',
  shipped:    'bg-orange-100 text-orange-700',
  delivered:  'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-600',
};

export default function TraderDashboard() {
  const { user, isTier1 } = useAuth();
  const navigate = useNavigate();
  const [consumerOrders, setConsumerOrders] = useState<any[]>([]);
  const [commissions,    setCommissions]    = useState<any>(null);
  const [subDealers,     setSubDealers]     = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [copied,         setCopied]         = useState(false);

  // Fire confetti once when pan_verified becomes true
  const panCelebKey = user ? `pan_verified_celebrated_${user.id}` : null;
  const [panCelebrated] = useState(() => panCelebKey ? !!localStorage.getItem(panCelebKey) : true);
  React.useEffect(() => {
    if (user?.pan_verified && !panCelebrated && panCelebKey) {
      localStorage.setItem(panCelebKey, '1');
      confetti({ particleCount: 180, spread: 90, origin: { y: 0.55 } });
      setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.1, y: 0.6 }, angle: 60 }), 300);
      setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.9, y: 0.6 }, angle: 120 }), 500);
    }
  }, [user?.pan_verified]);

  const fetchDashboard = useCallback(() => {
    const promises: Promise<any>[] = [
      api.get('/trader/consumer-orders'),
      api.get('/trader/commissions'),
    ];
    if (isTier1) promises.push(api.get('/trader/sub-dealers'));

    Promise.all(promises).then(([ordRes, commRes, subRes]) => {
      setConsumerOrders(ordRes.data.orders || ordRes.data || []);
      setCommissions(commRes.data);
      if (subRes) setSubDealers(subRes.data.sub_dealers || subRes.data || []);
    }).finally(() => setLoading(false));
  }, [isTier1]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Real-time: auto-refresh dashboard when order status changes or new order arrives
  useOrderUpdates(() => { fetchDashboard(); });

  const copyCode = () => {
    if (user?.referral_code) {
      navigator.clipboard.writeText(user.referral_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalOrders     = consumerOrders.length;
  const pendingOrders   = consumerOrders.filter(o => o.status === 'pending').length;
  const pendingComm     = parseFloat(commissions?.pending_amount  || '0');
  const totalComm       = parseFloat(commissions?.total_earned    || '0');
  const recentOrders    = consumerOrders.slice(0, 5);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Account status banner — hidden once pan_verified AND razorpay activated */}
      {(!user?.pan_verified || user?.razorpay_account_status !== 'activated') && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          {user?.pan_verified
            ? <ShieldCheck size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            : <ShieldAlert size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
          }
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-800 text-sm">
              {!user?.pan && !user?.pan_verified ? 'Account information needed' : 'Account setup in progress'}
            </p>
            <p className="text-amber-700 text-xs mt-1 mb-2">
              You need to complete both steps below before you can receive orders.
            </p>
            <div className="space-y-1.5">
              {/* Step 1: PAN */}
              <div className="flex items-center gap-2 text-xs">
                {user?.pan_verified
                  ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  : <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${user?.pan ? 'border-amber-500' : 'border-slate-300'}`} />
                }
                <span className={user?.pan_verified ? 'text-emerald-700 line-through' : 'text-amber-800'}>
                  Step 1: Add PAN &amp; get admin verification
                  {user?.pan && !user?.pan_verified && <span className="ml-1 text-amber-600 font-medium">(pending admin approval)</span>}
                </span>
              </div>
              {/* Step 2: Bank / Razorpay */}
              <div className="flex items-center gap-2 text-xs">
                {user?.razorpay_account_status === 'activated'
                  ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  : <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${user?.razorpay_account_status ? 'border-amber-500' : 'border-slate-300'}`} />
                }
                <span className={user?.razorpay_account_status === 'activated' ? 'text-emerald-700 line-through' : 'text-amber-800'}>
                  Step 2: Add bank account &amp; complete KYC in Profile
                  {user?.razorpay_account_status && user?.razorpay_account_status !== 'activated' && (
                    <span className="ml-1 text-amber-600 font-medium">(status: {user.razorpay_account_status})</span>
                  )}
                </span>
              </div>
            </div>
          </div>
          {!user?.pan && (
            <Link to="/trader/profile" className="flex-shrink-0 text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap">
              Go to Profile →
            </Link>
          )}
        </div>
      )}

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-brand-700 to-brand-600 rounded-2xl p-5 sm:p-6 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute right-10 bottom-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2" />
        <div className="relative">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {user?.tier === 1
                  ? <span className="px-2.5 py-0.5 bg-indigo-500/30 text-indigo-200 text-xs font-bold rounded-full flex items-center gap-1"><Star size={10} />Tier 1 Parent Dealer</span>
                  : <span className="px-2.5 py-0.5 bg-purple-500/30 text-purple-200 text-xs font-bold rounded-full">Sub-Partner</span>
                }
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white">Welcome back, {user?.name?.split(' ')[0]}!</h2>

              {/* Referral Code */}
              {user?.referral_code && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-brand-200 text-sm">Your code:</span>
                  <span className="font-mono bg-white/15 px-2.5 py-1 rounded-lg text-white font-bold text-sm">{user.referral_code}</span>
                  <button
                    onClick={copyCode}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
                  </button>
                </div>
              )}

              {/* Parent Dealer info for Tier 2 */}
              {!isTier1 && user?.referred_by_id && (
                <p className="text-brand-200 text-sm mt-2">
                  Sub-dealer under dealer #{user.referred_by_id}
                </p>
              )}
            </div>
            <div className="w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <TrendingUp size={22} className="text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Consumer Orders',    value: totalOrders,                                    icon: ShoppingBag,  color: 'brand',   link: '/trader/consumer-orders' },
          { label: 'Pending Orders',     value: pendingOrders,                                  icon: Clock,        color: 'amber',   link: '/trader/consumer-orders' },
          { label: "This Week's Comm",   value: `₹${pendingComm.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'emerald', link: '/trader/commissions' },
          ...(isTier1
            ? [{ label: 'Sub-Partners',    value: subDealers.length,                             icon: Users,        color: 'indigo',  link: '/trader/sub-dealers' }]
            : [{ label: 'Total Earned',   value: `₹${totalComm.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, icon: CheckCircle2, color: 'teal', link: '/trader/commissions' }]
          ),
        ].map(({ label, value, icon: Icon, color, link }: any) => {
          const colorMap: Record<string, string> = {
            brand:   'bg-brand-50 text-brand-600',
            amber:   'bg-amber-50 text-amber-600',
            emerald: 'bg-emerald-50 text-emerald-600',
            indigo:  'bg-indigo-50 text-indigo-600',
            teal:    'bg-teal-50 text-teal-600',
          };
          return (
            <div
              key={label}
              onClick={() => link && navigate(link)}
              className={`card p-4 flex items-start gap-3 ${link ? 'cursor-pointer hover:shadow-card-hover transition-all' : ''}`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium">{label}</p>
                <p className="text-xl font-extrabold text-slate-900">{value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button onClick={() => navigate('/trader/products')} className="card p-5 flex items-center gap-4 hover:shadow-card-hover transition-all text-left cursor-pointer">
          <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Package className="w-6 h-6 text-brand-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-900">Browse Products</p>
            <p className="text-slate-400 text-sm">View catalogue and place B2B orders</p>
          </div>
          <ChevronRight className="text-slate-300" size={18} />
        </button>
        <button onClick={() => navigate('/trader/consumer-orders')} className="card p-5 flex items-center gap-4 hover:shadow-card-hover transition-all text-left cursor-pointer">
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShoppingBag className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-900">Consumer Orders</p>
            <p className="text-slate-400 text-sm">View & manage consumer orders</p>
          </div>
          <ChevronRight className="text-slate-300" size={18} />
        </button>
        <button onClick={() => navigate('/trader/commissions')} className="card p-5 flex items-center gap-4 hover:shadow-card-hover transition-all text-left cursor-pointer">
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-900">My Commissions</p>
            <p className="text-slate-400 text-sm">Track your earnings</p>
          </div>
          <ChevronRight className="text-slate-300" size={18} />
        </button>
        {isTier1 && (
          <button onClick={() => navigate('/trader/sub-dealers')} className="card p-5 flex items-center gap-4 hover:shadow-card-hover transition-all text-left cursor-pointer">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-6 h-6 text-indigo-600" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-slate-900">Sub-Partners</p>
              <p className="text-slate-400 text-sm">{subDealers.length} sub-dealers in your network</p>
            </div>
            <ChevronRight className="text-slate-300" size={18} />
          </button>
        )}
      </div>

      {/* Recent Consumer Orders */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">Recent Consumer Orders</h3>
          <button onClick={() => navigate('/trader/consumer-orders')} className="btn-ghost text-brand-600 text-xs flex items-center gap-1">View all <ChevronRight size={14} /></button>
        </div>
        {recentOrders.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Consumer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o: any) => (
                  <tr key={o.id} onClick={() => navigate('/trader/consumer-orders')} className="cursor-pointer">
                    <td className="font-mono text-brand-600 font-medium text-xs">{o.order_number}</td>
                    <td>
                      <p className="font-medium text-sm">{o.consumer_name}</p>
                      {o.consumer_pincode && <p className="text-xs text-slate-400">{o.consumer_pincode}</p>}
                    </td>
                    <td className="font-bold">₹{parseFloat(String(o.total_amount)).toFixed(2)}</td>
                    <td><span className={`badge ${STATUS_COLORS[o.status] || 'bg-slate-100 text-slate-600'}`}>{o.status}</span></td>
                    <td className="text-slate-400 text-xs">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <ShoppingBag size={36} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">No consumer orders yet</p>
            <p className="text-sm mt-1">Share your referral code with consumers to start receiving orders</p>
          </div>
        )}
      </div>
    </div>
  );
}
