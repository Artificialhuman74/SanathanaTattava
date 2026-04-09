import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, ShoppingBag, ShoppingCart, ArrowLeft } from 'lucide-react';

export default function ConsumerLogin() {
  const { consumerLogin } = useAuth();
  const navigate = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    try {
      await consumerLogin(email, password);
      toast.success('Welcome back!');
      navigate('/shop', { replace: true });
    } catch (err: any) {
      const code = err.response?.data?.code;
      const msg  = err.response?.data?.error || 'Login failed';
      if (code === 'EMAIL_NOT_VERIFIED') {
        toast.error('Please verify your email first.');
        navigate('/shop/resend-verification', { state: { email } });
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <Link to="/shop" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm">
            <ArrowLeft size={14} /> Continue as Guest
          </Link>
        </div>

        <div className="text-center mb-8">
          <Link to="/shop" className="inline-flex items-center gap-2.5 justify-center">
            <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-10 w-10 object-contain rounded-xl" alt="Sanathana Tattva" />
            <span className="text-xl font-extrabold text-slate-900 leading-tight">Sanathana Tattva</span>
          </Link>
          <p className="text-slate-500 mt-2 text-sm">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8">
          <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-brand-50 rounded-xl">
            <ShoppingBag size={18} className="text-brand-600" />
            <span className="text-brand-700 font-semibold text-sm">Consumer Login</span>
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
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
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
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <Link to="/forgot-password" className="text-xs text-brand-600 hover:text-brand-700">
                Forgot password?
              </Link>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2">
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-100 text-center space-y-3">
            <p className="text-sm text-slate-500">
              New here?{' '}
              <Link to="/shop/register" className="text-brand-600 font-semibold hover:text-brand-700">
                Create an account
              </Link>
            </p>
            <Link to="/shop" className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-600">
              <ShoppingCart size={14} /> Continue as guest
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
