import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  Mail, Lock, Eye, EyeOff, User, Phone,
  ArrowLeft, CheckCircle2, AlertCircle, Tag,
} from 'lucide-react';
import {
  signInWithGoogleAndGetIdToken,
  consumeGoogleRedirectResult,
  isFirebaseConfigured,
} from '../../lib/firebase';
import { AuthVisual } from './AuthVisual';

export default function ConsumerRegister() {
  const { consumerRegister, consumerLoginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState((location.state as any)?.email || '');
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [refCode,  setRefCode]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [codeValid,  setCodeValid]  = useState<boolean | null>(null);
  const [dealerName, setDealerName] = useState('');

  useEffect(() => {
    const code = refCode.trim().toUpperCase();
    if (code.length < 5) { setCodeValid(null); setDealerName(''); return; }
    const t = setTimeout(() => {
      consumerApi.get(`/auth/consumer/validate-dealer/${code}`)
        .then(r => { setCodeValid(r.data.valid); setDealerName(r.data.dealerName || ''); })
        .catch(() => setCodeValid(false));
    }, 350);
    return () => clearTimeout(t);
  }, [refCode]);

  const exchangeIdTokenAndLogin = async (idToken: string) => {
    const { data } = await consumerApi.post('/auth/consumer/google', {
      id_token: idToken,
      /* If the visitor typed a dealer code before tapping Google, link
       * the account on signup. The backend treats this as optional. */
      referral_code: refCode.trim() || undefined,
    });
    consumerLoginWithToken(data.token, data.consumer);
    navigate('/shop', { replace: true });
  };

  const handleGoogleSignIn = async () => {
    if (refCode && codeValid === false) {
      toast.error('Invalid referral code');
      return;
    }
    setGoogleLoading(true);
    try {
      const idToken = await signInWithGoogleAndGetIdToken();
      if (idToken === null) return;  // Browser is mid-redirect.
      await exchangeIdTokenAndLogin(idToken);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  // On mount: if we just came back from a Google redirect, finish the signup.
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
    if (!name.trim())  { toast.error('Please enter your name'); return; }
    if (!email.trim()) { toast.error('Please enter your email'); return; }
    if (!phone.trim()) { toast.error('Please enter your phone number'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    if (refCode && codeValid === false) { toast.error('Invalid referral code'); return; }

    setLoading(true);
    try {
      await consumerRegister(name.trim(), email.trim(), password, refCode.trim() || undefined, phone.trim());
      toast.success('Account created. Check your email to verify.');
      navigate('/shop/verify-pending', { state: { email } });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const passwordMismatch = !!confirm && confirm !== password;

  return (
    <div className="min-h-screen bg-parchment-100 md:grid md:grid-cols-[1fr_1fr]">
      {/* ── LEFT (md+) / ONLY (mobile): form column ────────────────── */}
      <div className="min-h-screen flex flex-col">
        {/* Top bar: back to Login. */}
        <div className="w-full max-w-md mx-auto px-6 pt-6 sm:pt-8">
          <Link
            to="/shop/login"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>

        {/* Centred auth area */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10 pt-4 sm:pt-6">
          <div className="w-full max-w-md">

          {/* Brand identity — same treatment as Login for consistency. */}
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
            <p className="text-sm text-slate-600 mt-1">Create your account.</p>
          </div>

          {/* Card */}
          <div className="auth-rise-late card p-6 sm:p-7">

            {/* Google fast-path FIRST — same position as Login. */}
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
                  {googleLoading ? 'Signing up…' : 'Continue with Google'}
                </button>

                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-[#e8dcc8]" />
                  <span className="text-xs text-slate-600 font-medium">or with email</span>
                  <div className="flex-1 h-px bg-[#e8dcc8]" />
                </div>
              </>
            )}

            {/* Email form — grouped: identity, security, optional. The visual
                groups carry the structure; no redundant "Your Details" h2. */}
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Group 1: Identity */}
              <div>
                <label className="form-label" htmlFor="reg-name">Full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="reg-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="form-input pl-10"
                    placeholder="Your full name"
                    autoComplete="name"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor="reg-email">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="form-input pl-10"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor="reg-phone">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="reg-phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="form-input pl-10"
                    placeholder="10-digit mobile number"
                    autoComplete="tel"
                    required
                  />
                </div>
              </div>

              {/* Group 2: Security. Extra top-margin separates the visual
                  group; the inputs inside stay tight. */}
              <div className="!mt-6">
                <label className="form-label" htmlFor="reg-password">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="reg-password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="form-input pl-10 pr-10"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    minLength={6}
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

              <div>
                <label className="form-label" htmlFor="reg-confirm">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                  <input
                    id="reg-confirm"
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="form-input pl-10"
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    required
                    style={passwordMismatch ? { borderColor: '#dc2626' } : undefined}
                    aria-invalid={passwordMismatch}
                  />
                </div>
                {passwordMismatch && (
                  <p className="text-xs text-red-700 mt-1.5 font-medium">Passwords don't match.</p>
                )}
              </div>

              {/* Group 3: Optional — dealer code. Visually quieter so it
                  doesn't compete with the required fields above. */}
              <div className="!mt-6">
                <label className="form-label flex items-baseline justify-between" htmlFor="reg-refcode">
                  <span>Dealer referral code</span>
                  <span className="text-xs font-normal text-slate-500">optional</span>
                </label>
                <div className="relative">
                  <input
                    id="reg-refcode"
                    type="text"
                    value={refCode}
                    onChange={e => setRefCode(e.target.value.toUpperCase())}
                    className="form-input uppercase tracking-wider font-mono pr-10"
                    placeholder="e.g. A0000"
                    maxLength={5}
                    autoComplete="off"
                    style={
                      codeValid === true  ? { borderColor: '#15803d' } :
                      codeValid === false ? { borderColor: '#dc2626' } : undefined
                    }
                  />
                  {codeValid === true  && <CheckCircle2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-700" />}
                  {codeValid === false && <AlertCircle  size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-700" />}
                </div>
                {codeValid === true && (
                  <p className="text-xs text-emerald-800 mt-1.5 flex items-center gap-1 font-medium">
                    <Tag size={10} /> Linked to dealer: <strong>{dealerName}</strong>
                  </p>
                )}
                {codeValid === false && refCode.trim().length >= 5 && (
                  <p className="text-xs text-red-700 mt-1.5 font-medium">That code isn't valid.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading || codeValid === false || passwordMismatch}
                className="btn-primary w-full !py-3 !text-base !mt-6"
              >
                {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          </div>

          {/* Below-card actions */}
          <div className="auth-rise-later mt-6 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Already have an account?{' '}
              <Link to="/shop/login" className="font-semibold text-brand-700 hover:text-brand-800">
                Sign in
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
      <AuthVisual tagline="Three oils, pressed slowly in a wooden ghani, delivered in a reusable steel can." />
    </div>
  );
}
