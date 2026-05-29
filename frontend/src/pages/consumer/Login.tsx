import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { signInWithGoogleAndGetIdToken, isFirebaseConfigured } from '../../lib/firebase';

export default function ConsumerLogin() {
  const { consumerLogin, consumerLoginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email,    setEmail]    = useState((location.state as any)?.email || '');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const idToken = await signInWithGoogleAndGetIdToken();
      const { data } = await consumerApi.post('/auth/consumer/google', { id_token: idToken });
      consumerLoginWithToken(data.token, data.consumer);
      navigate('/shop', { replace: true });
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        // User dismissed — silent
      } else {
        toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

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
        src="/logo.webp"
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

          {isFirebaseConfigured() && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className="w-full py-3 px-4 border border-slate-200 rounded-lg flex items-center justify-center gap-3 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                {googleLoading ? (
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                    <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
                  </svg>
                )}
                {googleLoading ? 'Signing in…' : 'Continue with Google'}
              </button>
            </>
          )}

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
