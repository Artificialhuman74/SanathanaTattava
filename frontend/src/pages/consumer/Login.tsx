import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import {
  signInWithGoogleAndGetIdToken,
  consumeGoogleRedirectResult,
  isFirebaseConfigured,
} from '../../lib/firebase';
import { AuthVisual } from './AuthVisual';

export default function ConsumerLogin() {
  const { consumerLogin, consumerLoginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email,    setEmail]    = useState((location.state as any)?.email || '');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const exchangeIdTokenAndLogin = async (idToken: string) => {
    const { data } = await consumerApi.post('/auth/consumer/google', { id_token: idToken });
    consumerLoginWithToken(data.token, data.consumer);
    navigate('/shop', { replace: true });
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const idToken = await signInWithGoogleAndGetIdToken();
      if (idToken === null) return; // Browser is mid-redirect; result picked up on return.
      await exchangeIdTokenAndLogin(idToken);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  // On mount: if we just came back from a Google redirect, finish the login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await consumeGoogleRedirectResult();
        if (!idToken || cancelled) return;
        setGoogleLoading(true);
        await exchangeIdTokenAndLogin(idToken);
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
    <div className="min-h-screen bg-parchment-100 md:grid md:grid-cols-[1fr_1fr]">
      {/* ── LEFT (md+) / ONLY (mobile): form column ────────────────── */}
      <div className="min-h-screen flex flex-col">
        {/* Top bar: back link, sits at the page edge. */}
        <div className="w-full max-w-md mx-auto px-6 pt-6 sm:pt-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={14} /> Back to home
          </button>
        </div>

        {/* Centred auth area */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
          <div className="w-full max-w-md">

          {/* Brand identity — small mark + serif name. Reads as the brand,
              not as decoration. */}
          <div className="auth-rise text-center mb-7">
            <Link to="/" className="inline-block">
              <img src="/logo.webp" className="h-12 w-12 mx-auto rounded-xl object-contain" alt="Sanathana Tattva" />
            </Link>
            <h1
              className="mt-3 text-2xl font-bold text-slate-900 leading-tight"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
            >
              Sanathana Tattva
            </h1>
            <p className="text-sm text-slate-600 mt-1">Sign in to your account.</p>
          </div>

          {/* Card */}
          <div className="auth-rise-late card p-6 sm:p-7">

            {/* Google fast-path FIRST when configured. New visitors who already
                have a Google session skip the password flow entirely. */}
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
                  <span className="text-xs text-slate-600 font-medium">or with email</span>
                  <div className="flex-1 h-px bg-[#e8dcc8]" />
                </div>
              </>
            )}

            {/* Email form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="form-label" htmlFor="login-email">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="login-email"
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="form-label !mb-0" htmlFor="login-password">Password</label>
                  <Link to="/forgot-password" className="text-xs font-medium text-brand-700 hover:text-brand-800">
                    Forgot?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="form-input pl-10 pr-10"
                    placeholder="Your password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-md"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="btn-primary w-full !py-3 !text-base mt-1"
              >
                {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>

          {/* Below-card actions: separate visual group from the form, so it
              reads as page-level navigation, not as another form action. */}
          <div className="auth-rise-later mt-6 text-center space-y-3">
            <p className="text-sm text-slate-600">
              No account?{' '}
              <Link to="/shop/register" state={{ email }} className="font-semibold text-brand-700 hover:text-brand-800">
                Create one
              </Link>
            </p>
            <button
              type="button"
              onClick={() => navigate('/shop')}
              className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
            >
              Continue as guest →
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT (md+ only): brand visual ─────────────────────────── */}
      <AuthVisual tagline="Pure cold-pressed oils, slowly made, brought to your door in a reusable steel can." />
    </div>
  );
}
