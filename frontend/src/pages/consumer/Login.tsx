import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';

export default function ConsumerLogin() {
  const { consumerLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email,    setEmail]    = useState((location.state as any)?.email || '');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    try {
      await consumerLogin(email, password);
      navigate('/shop', { replace: true });
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === 'EMAIL_NOT_FOUND') {
        // No account — take them straight to register with email pre-filled
        navigate('/shop/register', { state: { email } });
      } else if (code === 'EMAIL_NOT_VERIFIED') {
        toast.error('Please verify your email first.');
        navigate('/shop/resend-verification', { state: { email } });
      } else {
        toast.error(err.response?.data?.error || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Logo as background */}
      <img
        src="/Gemini_Generated_Image_agra6kagra6kagra.png"
        className="absolute inset-0 z-0 w-full h-full object-cover opacity-15 pointer-events-none"
        style={{ objectPosition: 'center' }}
        alt=""
        aria-hidden="true"
      />
      <div className="absolute inset-0 z-0" style={{ background: '#fdf8f0cc' }} />

      <div className="w-full max-w-sm relative z-10">

        {/* Back */}
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm mb-8 transition-colors">
          <ArrowLeft size={14} /> Back
        </button>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
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
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Password</label>
                <Link to="/forgot-password" className="text-xs text-brand-600 hover:text-brand-700">Forgot?</Link>
              </div>
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

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2">
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-5">
            No account?{' '}
            <Link to="/shop/register" state={{ email }} className="text-brand-600 font-semibold hover:text-brand-700">
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center mt-5">
          <button onClick={() => navigate('/shop')} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
            Continue as guest →
          </button>
        </p>
      </div>
    </div>
  );
}
