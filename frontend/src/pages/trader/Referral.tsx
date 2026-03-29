import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Share2, Copy, CheckCircle2, Users, ShoppingCart, Star,
  UserCheck, Phone, Mail, Calendar, Lock, TrendingUp,
} from 'lucide-react';

export default function TraderReferral() {
  const { user, isTier1 } = useAuth();
  const navigate = useNavigate();
  const [data,    setData]    = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (!isTier1) { setLoading(false); return; }
    api.get('/trader/referral').then(r => setData(r.data)).finally(() => setLoading(false));
  }, [isTier1]);

  const copyCode = () => {
    navigator.clipboard.writeText(user?.referral_code || '');
    setCopied(true);
    toast.success('Referral code copied!');
    setTimeout(() => setCopied(false), 2500);
  };

  const shareCode = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on TradeHub!',
          text: `Use my referral code ${user?.referral_code} to join TradeHub as a trader!`,
          url: window.location.origin + '/register',
        });
      } catch {}
    } else {
      copyCode();
    }
  };

  if (!isTier1) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-fade-in">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-5">
        <Lock className="w-8 h-8 text-slate-400" />
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Referral Programme</h2>
      <p className="text-slate-500 max-w-sm mb-6">
        This feature is available to <span className="font-semibold text-gold-600">Tier 1 traders</span> only.
        Tier 1 traders can invite sub-traders using their unique referral code.
      </p>
      <div className="card p-5 max-w-sm w-full text-left">
        <p className="text-sm font-semibold text-slate-700 mb-2">Your account</p>
        <p className="text-sm text-slate-500">You are a <span className="font-semibold text-brand-600">Tier 2 Sub-Trader</span>.</p>
        <p className="text-sm text-slate-500 mt-1">Referral codes are only issued to Tier 1 traders who register without a referral code.</p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Referral Programme</h2>
        <p className="text-slate-500 text-sm mt-0.5">Share your code to grow your network</p>
      </div>

      {/* Referral Code Card */}
      <div className="bg-gradient-to-br from-brand-700 to-brand-900 rounded-2xl p-6 sm:p-8 text-white relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
        <div className="absolute -bottom-8 -left-5 w-32 h-32 bg-white/5 rounded-full" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-5">
            <Star size={16} className="text-gold-400" />
            <span className="text-gold-300 text-sm font-bold">Tier 1 Trader — Referral Code</span>
          </div>
          <p className="text-white/60 text-sm mb-2">Your unique referral code</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-3xl sm:text-4xl font-extrabold tracking-widest font-mono text-white">
                {user?.referral_code}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyCode}
                className={`px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all ${
                  copied ? 'bg-emerald-500 text-white' : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
              >
                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={shareCode} className="px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white rounded-xl font-semibold text-sm flex items-center gap-2 transition-all">
                <Share2 size={15} />
                Share
              </button>
            </div>
          </div>
          <p className="text-white/50 text-sm mt-4">
            Share this code with others. When they register using your code, they join as your Tier 2 sub-traders.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total Sub-Traders',  value: data?.stats?.totalSubTraders  ?? 0, icon: Users,         color: 'brand' },
          { label: 'Active Sub-Traders', value: data?.stats?.activeSubTraders ?? 0, icon: UserCheck,     color: 'emerald' },
          { label: 'Orders from Network', value: data?.stats?.totalOrders     ?? 0, icon: ShoppingCart,  color: 'violet' },
        ].map(({ label, value, icon: Icon, color }) => {
          const colorMap: Record<string, string> = {
            brand: 'bg-brand-50 text-brand-600',
            emerald: 'bg-emerald-50 text-emerald-600',
            violet: 'bg-violet-50 text-violet-600',
          };
          return (
            <div key={label} className="card p-5 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-3xl font-extrabold text-slate-900">{value}</p>
                <p className="text-slate-500 text-sm">{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* How to share */}
      <div className="card p-5">
        <h3 className="font-bold text-slate-900 mb-4">How to Share Your Code</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { step: '1', title: 'Copy Your Code', desc: 'Click the copy button above to copy your unique referral code to clipboard.' },
            { step: '2', title: 'Share It',        desc: `Share the code on WhatsApp, email, or social media. New traders enter it when registering.` },
            { step: '3', title: 'They Join',        desc: 'When someone registers with your code, they become your Tier 2 sub-trader automatically.' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="w-8 h-8 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">{step}</div>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{title}</p>
                <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sub-traders list */}
      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-slate-600" />
            <h3 className="font-bold text-slate-900">Your Sub-Traders</h3>
          </div>
          <span className="badge bg-brand-50 text-brand-700">{data?.subTraders?.length ?? 0} total</span>
        </div>
        {!data?.subTraders?.length ? (
          <div className="text-center py-12 text-slate-400">
            <Users size={36} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">No sub-traders yet</p>
            <p className="text-sm mt-1">Share your referral code to start building your network</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Trader</th>
                  <th>Status</th>
                  <th>Orders</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.subTraders.map((t: any) => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm flex-shrink-0">
                          {t.name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-sm">{t.name}</p>
                          <p className="text-slate-400 text-xs flex items-center gap-1"><Mail size={10} />{t.email}</p>
                          {t.phone && <p className="text-slate-400 text-xs flex items-center gap-1"><Phone size={10} />{t.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="font-semibold">{t.order_count}</td>
                    <td className="text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Calendar size={10} />{new Date(t.created_at).toLocaleDateString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
