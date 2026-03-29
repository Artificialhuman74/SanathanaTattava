import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { TrendingUp, Mail, Lock, Eye, EyeOff, Shield, Users, ArrowLeft, ShoppingBag } from 'lucide-react';

type Tab = 'trader' | 'admin';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [tab,      setTab]      = useState<Tab>('trader');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      setTimeout(() => {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        navigate(stored.role === 'admin' ? '/admin' : '/trader', { replace: true });
      }, 100);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (type: 'admin' | 'tier1' | 'tier2') => {
    const creds = {
      admin: { email: 'admin@tradehub.com', password: 'Admin@123' },
      tier1: { email: 'alex@tradehub.com',  password: 'Trader@123' },
      tier2: { email: 'sarah@tradehub.com', password: 'Trader@123' },
    };
    setEmail(creds[type].email);
    setPassword(creds[type].password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 hero-pattern" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </Link>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-extrabold text-white">TradeHub</span>
          </div>
          <p className="text-white/60 mt-2 text-sm">Sign in to your account</p>
        </div>

        <div className="card p-6 sm:p-8">
          {/* Tabs */}
          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            {[
              { id: 'trader' as Tab, icon: Users,  label: 'Trader Login' },
              { id: 'admin'  as Tab, icon: Shield, label: 'Admin Login' },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => { setTab(id); setEmail(''); setPassword(''); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  tab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="form-input pl-10"
                  placeholder="Enter your email"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="form-label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="form-input pl-10 pr-10"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base mt-2 flex items-center justify-center gap-2">
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {tab === 'trader' && (
            <div className="mt-5 pt-5 border-t border-slate-100 text-center">
              <p className="text-sm text-slate-500">
                Don't have an account?{' '}
                <Link to="/register" className="text-brand-600 font-semibold hover:text-brand-700">
                  Create one
                </Link>
              </p>
            </div>
          )}

          {/* Consumer shop link */}
          <div className="mt-4 flex items-center justify-center">
            <Link
              to="/shop/login"
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-brand-600 transition-colors"
            >
              <ShoppingBag size={15} />
              Shop as Consumer →
            </Link>
          </div>

          {/* Demo credentials */}
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center mb-3 font-medium uppercase tracking-wider">Quick Demo Fill</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {tab === 'admin' ? (
                <button onClick={() => fillDemo('admin')} className="px-3 py-1.5 bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-600 rounded-lg text-xs font-medium transition-colors">
                  Admin
                </button>
              ) : (
                <>
                  <button onClick={() => fillDemo('tier1')} className="px-3 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-lg text-xs font-medium transition-colors">
                    Tier 1 Dealer
                  </button>
                  <button onClick={() => fillDemo('tier2')} className="px-3 py-1.5 bg-slate-100 hover:bg-purple-50 hover:text-purple-700 text-slate-600 rounded-lg text-xs font-medium transition-colors">
                    Sub-Dealer
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
