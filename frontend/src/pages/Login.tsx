import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, ArrowLeft, AlertCircle } from 'lucide-react';
import api from '../api/axios';
import {
  signInWithGoogleAndGetIdToken,
  consumeGoogleRedirectResult,
  isFirebaseConfigured,
} from '../lib/firebase';

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function Login() {
  const { login, loginWithToken } = useAuth();
  const navigate = useNavigate();

  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPw,      setShowPw]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showForgot,  setShowForgot]  = useState(false);
  const [errors,      setErrors]      = useState<{ email?: string; password?: string; form?: string }>({});

  /* After a Google sign-in exchange: route by role, or send new people to
   * signup with their Google details prefilled. */
  const routePartner = (user: any) => {
    navigate(user.role === 'admin' ? '/admin' : '/trader', { replace: true });
  };

  const exchangeGoogleToken = async (idToken: string) => {
    const { data } = await api.post('/auth/partner/google', { id_token: idToken }, { skipAuthRedirect: true });
    if (data.exists) {
      loginWithToken(data.token, data.user);
      routePartner(data.user);
    } else {
      toast('No partner account yet — finish signing up.', { icon: '👋' });
      navigate('/register', { state: { googleName: data.name, googleEmail: data.email, googleMode: true } });
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setErrors({});
    try {
      const idToken = await signInWithGoogleAndGetIdToken();
      if (idToken === null) return; // browser is mid-redirect
      await exchangeGoogleToken(idToken);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  // On mount: finish a Google redirect if we just came back from one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await consumeGoogleRedirectResult();
        if (!idToken || cancelled) return;
        setGoogleLoading(true);
        await exchangeGoogleToken(idToken);
      } catch (err: any) {
        if (!cancelled) toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
      } finally {
        if (!cancelled) setGoogleLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    const next: typeof errors = {};
    if (!cleanEmail)              next.email = 'Enter your email address';
    else if (!isValidEmail(cleanEmail)) next.email = 'Enter a valid email address';
    if (!password)               next.password = 'Enter your password';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await login(cleanEmail, password);
      toast.success('Welcome back!');
      setTimeout(() => {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        navigate(stored.role === 'admin' ? '/admin' : '/trader', { replace: true });
      }, 100);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Something went wrong. Please try again.';
      setErrors({ form: msg });
      if (err.response?.status === 401) setShowForgot(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1f10] via-[#14532d] to-[#0d1f10] flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 hero-pattern" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to Home
          </Link>
          <div className="flex items-center justify-center gap-3">
            <img src="/logo.webp" className="h-12 w-12 object-contain rounded-xl" alt="Sanathana Tattva" />
            <span className="text-xl font-extrabold text-white leading-tight">Sanathana Tattva</span>
          </div>
          <p className="text-white/60 mt-2 text-sm">Sign in to your account</p>
        </div>

        <div className="card p-6 sm:p-8">
          {/* Google fast-path first (partners mostly use their Google account) */}
          {isFirebaseConfigured() && (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full min-h-[48px] px-4 rounded-xl border border-[#e8dcc8] bg-white hover:bg-parchment-100 flex items-center justify-center gap-3 text-slate-800 font-semibold text-sm transition-colors disabled:opacity-60"
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
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-[#e8dcc8]" />
                <span className="text-xs text-slate-500 font-medium">or with email</span>
                <div className="flex-1 h-px bg-[#e8dcc8]" />
              </div>
            </>
          )}

          {/* Form-level error (wrong credentials, suspended, etc.) */}
          {errors.form && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{errors.form}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="form-label" htmlFor="login-email">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(p => ({ ...p, email: undefined })); }}
                  onBlur={() => setEmail(v => v.trim())}
                  className={`form-input pl-10 ${errors.email ? '!border-red-400' : ''}`}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!errors.email}
                />
              </div>
              {errors.email && <p className="text-xs text-red-600 mt-1.5">{errors.email}</p>}
            </div>

            <div>
              <label className="form-label" htmlFor="login-password">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: undefined })); }}
                  className={`form-input pl-10 pr-10 ${errors.password ? '!border-red-400' : ''}`}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-600 mt-1.5">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="btn-primary w-full py-3 text-base mt-2 flex items-center justify-center gap-2"
            >
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <div className="text-center">
              <Link to="/forgot-password" className={`text-xs transition-colors ${showForgot ? 'text-brand-600 font-semibold' : 'text-slate-400 hover:text-brand-600'}`}>
                Forgot password?
              </Link>
            </div>
          </form>

          <div className="mt-5 pt-5 border-t border-[#e8dcc8] text-center">
            <p className="text-sm text-slate-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-brand-600 font-semibold hover:text-brand-700">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
