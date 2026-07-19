import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  User, Mail, Lock, Eye, EyeOff, Phone, MapPin, Hash,
  CheckCircle2, XCircle, ArrowLeft, Star, Users, Truck, Info, AlertCircle,
} from 'lucide-react';
import {
  signInWithGoogleAndGetIdToken,
  consumeGoogleRedirectResult,
  getCurrentGoogleIdToken,
  isFirebaseConfigured,
} from '../lib/firebase';

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/* Forgiving phone: strip spaces / dashes / parens / leading +91, then a
 * 10-digit Indian mobile starting 6-9. */
const cleanPhone = (p: string) => p.replace(/[\s\-()]/g, '').replace(/^\+?91/, '');
const isValidPhone = (p: string) => /^[6-9]\d{9}$/.test(cleanPhone(p));
const cleanPin = (p: string) => p.replace(/\s/g, '');
const isValidPin = (p: string) => /^\d{6}$/.test(cleanPin(p));

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'confirmPassword' | 'phone' | 'pincode' | 'form', string>>;

export default function Register() {
  const { register: doRegister, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as any) || {};

  const [form, setForm] = useState({
    name: navState.googleName || '', email: navState.googleEmail || '',
    password: '', confirmPassword: '',
    phone: '', address: '', pincode: '', referralCode: '',
  });
  const [willDeliver,   setWillDeliver]   = useState<boolean>(false);
  const [showPw,        setShowPw]        = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  /* Google mode: identity confirmed by Google, so no password is set. */
  const [googleMode,    setGoogleMode]    = useState<boolean>(!!navState.googleMode);
  const [refStatus,     setRefStatus]     = useState<null | { valid: boolean; name?: string }>(null);
  const [refChecking,   setRefChecking]   = useState(false);
  const [errors,        setErrors]        = useState<FieldErrors>({});

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    if (errors[k as keyof FieldErrors]) setErrors(p => ({ ...p, [k]: undefined }));
  };

  // Validate referral code (debounced), trimmed + uppercased for lookup.
  useEffect(() => {
    const code = form.referralCode.trim().toUpperCase();
    if (!code) { setRefStatus(null); return; }
    const t = setTimeout(async () => {
      setRefChecking(true);
      try {
        const { data } = await api.get(`/auth/validate-referral/${code}`);
        setRefStatus({ valid: data.valid, name: data.referrerName });
      } catch { setRefStatus({ valid: false }); }
      finally { setRefChecking(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [form.referralCode]);

  const isSubDealer = refStatus?.valid === true;
  const tier = isSubDealer ? 2 : 1;

  /* ── Google ──────────────────────────────────────────────────────────── */
  const exchangeGoogle = async (idToken: string) => {
    const { data } = await api.post('/auth/partner/google', { id_token: idToken }, { skipAuthRedirect: true });
    if (data.exists) {
      loginWithToken(data.token, data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/trader', { replace: true });
    } else {
      // New person: switch into Google mode, prefill, let them finish.
      setForm(f => ({ ...f, name: data.name || f.name, email: data.email || f.email }));
      setGoogleMode(true);
      setErrors({});
      toast('Almost there — just confirm the details below.', { icon: '👋' });
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setErrors({});
    try {
      const idToken = await signInWithGoogleAndGetIdToken();
      if (idToken === null) return; // mid-redirect
      await exchangeGoogle(idToken);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await consumeGoogleRedirectResult();
        if (!idToken || cancelled) return;
        setGoogleLoading(true);
        await exchangeGoogle(idToken);
      } catch (err: any) {
        if (!cancelled) toast.error(err.response?.data?.error || err?.message || 'Google sign-in failed');
      } finally {
        if (!cancelled) setGoogleLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Validate + submit ───────────────────────────────────────────────── */
  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!form.name.trim())                 e.name = 'Enter your name';
    const email = form.email.trim();
    if (!email)                            e.email = 'Enter your email address';
    else if (!isValidEmail(email))         e.email = 'Enter a valid email address';
    if (!googleMode) {
      if (!form.password)                  e.password = 'Choose a password';
      else if (form.password.length < 6)   e.password = 'Password must be at least 6 characters';
      if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    }
    if (form.phone.trim() && !isValidPhone(form.phone))   e.phone = 'Enter a valid 10-digit mobile number';
    if (form.pincode.trim() && !isValidPin(form.pincode)) e.pincode = 'PIN code must be 6 digits';
    if (form.referralCode.trim() && refStatus?.valid === false) e.form = 'That referral code is not valid. Clear it, or enter a correct one.';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!willDeliver) { setErrors({ form: 'Please confirm you\'ll deliver to consumers in your area.' }); return; }

    const payload = {
      name:         form.name.trim(),
      phone:        form.phone.trim() ? cleanPhone(form.phone) : undefined,
      address:      form.address.trim() || undefined,
      pincode:      form.pincode.trim() ? cleanPin(form.pincode) : undefined,
      referralCode: form.referralCode.trim().toUpperCase() || undefined,
      willDeliver,
    };

    setLoading(true);
    try {
      if (googleMode) {
        const idToken = await getCurrentGoogleIdToken();
        if (!idToken) {
          setErrors({ form: 'Your Google session expired. Tap "Continue with Google" again.' });
          setGoogleMode(false);
          return;
        }
        const { data } = await api.post('/auth/partner/google/register',
          { id_token: idToken, ...payload }, { skipAuthRedirect: true });
        loginWithToken(data.token, data.user);
      } else {
        await doRegister({ email: form.email.trim(), password: form.password, ...payload });
      }
      toast.success('You\'re in. Welcome to the family.');
      navigate('/trader', { replace: true });
    } catch (err: any) {
      setErrors({ form: err.response?.data?.error || 'Could not create your account. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1f10] via-[#14532d] to-[#0d1f10] flex flex-col items-center justify-center p-4 py-10">
      <div className="absolute inset-0 hero-pattern" />

      <div className="relative w-full max-w-lg">
        <div className="text-center mb-8">
          <Link to="/login" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to Login
          </Link>
          <div className="flex items-center justify-center gap-3">
            <img src="/logo.webp" className="h-12 w-12 object-contain rounded-xl" alt="Sanathana Tattva" />
            <span className="text-2xl font-extrabold text-white leading-tight">Sanathana Tattva</span>
          </div>
          <p className="text-white/70 mt-2 text-sm" style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontStyle: 'italic' }}>
            Join the family that delivers our oils.
          </p>
        </div>

        {/* What you'll get */}
        <div className="mb-5 p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Hash size={14} className="text-indigo-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Your referral code</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Earn on every order you bring in</p>
            </div>
            <div>
              <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Truck size={14} className="text-emerald-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Local delivery</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Orders routed to your area</p>
            </div>
            <div>
              <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Star size={14} className="text-amber-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Weekly payouts</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Direct to your bank, every Sunday</p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="mb-5 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm">
          <div className="flex items-start gap-2.5">
            <Info size={16} className="text-blue-300 mt-0.5 flex-shrink-0" />
            <div className="text-white/80 text-xs leading-relaxed">
              <p className="font-semibold text-white/95 mb-1">Two ways to join:</p>
              <p>
                <strong className="text-indigo-300">No code?</strong> You become a Tier 1 Partner and get a code of your own to bring in sub-partners.
                <br />
                <strong className="text-purple-300">Got a code from another partner?</strong> Enter it below to join under them as a Sub-Partner.
              </p>
            </div>
          </div>
        </div>

        {/* Tier Preview */}
        <div className={`flex gap-3 mb-6 p-4 rounded-2xl border transition-all ${
          isSubDealer ? 'bg-purple-500/10 border-purple-500/30' : 'bg-indigo-500/10 border-indigo-500/30'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isSubDealer ? 'bg-purple-500/20' : 'bg-indigo-500/20'}`}>
            {isSubDealer ? <Users size={20} className="text-purple-400" /> : <Star size={20} className="text-indigo-400" />}
          </div>
          <div>
            <p className={`font-bold text-sm ${isSubDealer ? 'text-purple-300' : 'text-indigo-300'}`}>
              {isSubDealer ? `Joining under ${refStatus?.name}` : 'You\'ll be a Tier 1 Partner'}
            </p>
            <p className="text-white/60 text-xs mt-0.5 leading-relaxed">
              {isSubDealer
                ? `${refStatus?.name?.split(' ')[0]} brought you in. You'll still get your own code and earn on every order you bring in.`
                : 'You get your own referral code to bring in sub-partners. You earn on their orders too.'
              }
            </p>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          {/* Google fast-path (hidden once already in Google mode) */}
          {isFirebaseConfigured() && !googleMode && (
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
                {googleLoading ? 'Please wait…' : 'Continue with Google'}
              </button>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-[#e8dcc8]" />
                <span className="text-xs text-slate-500 font-medium">or with email</span>
                <div className="flex-1 h-px bg-[#e8dcc8]" />
              </div>
            </>
          )}

          {/* Google-mode banner */}
          {googleMode && (
            <div className="mb-5 flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              <span>Signed in with Google as <strong>{form.email}</strong>. Confirm your details to finish.</span>
            </div>
          )}

          {/* Form-level error */}
          {errors.form && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{errors.form}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Name & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Full Name <span className="text-red-500">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" value={form.name} onChange={set('name')} onBlur={() => setForm(f => ({ ...f, name: f.name.trim() }))}
                    className={`form-input pl-10 ${errors.name ? '!border-red-400' : ''}`} placeholder="Your full name" aria-invalid={!!errors.name} />
                </div>
                {errors.name && <p className="text-xs text-red-600 mt-1.5">{errors.name}</p>}
              </div>
              <div>
                <label className="form-label">Email <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="email" value={form.email} onChange={set('email')} onBlur={() => setForm(f => ({ ...f, email: f.email.trim() }))}
                    className={`form-input pl-10 ${errors.email ? '!border-red-400' : ''} ${googleMode ? 'bg-slate-50 text-slate-500' : ''}`}
                    placeholder="your@email.com" autoCapitalize="none" spellCheck={false}
                    readOnly={googleMode} aria-invalid={!!errors.email} />
                </div>
                {errors.email && <p className="text-xs text-red-600 mt-1.5">{errors.email}</p>}
              </div>
            </div>

            {/* Password — hidden in Google mode (no password needed) */}
            {!googleMode && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                      className={`form-input pl-10 pr-10 ${errors.password ? '!border-red-400' : ''}`} placeholder="Min. 6 characters"
                      autoComplete="new-password" aria-invalid={!!errors.password} />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-red-600 mt-1.5">{errors.password}</p>}
                </div>
                <div>
                  <label className="form-label">Confirm Password <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input type={showPw ? 'text' : 'password'} value={form.confirmPassword} onChange={set('confirmPassword')}
                      className={`form-input pl-10 ${errors.confirmPassword ? '!border-red-400' : ''}`} placeholder="Repeat password"
                      autoComplete="new-password" aria-invalid={!!errors.confirmPassword} />
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-red-600 mt-1.5">{errors.confirmPassword}</p>}
                </div>
              </div>
            )}

            {/* Phone & Pincode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="tel" value={form.phone} onChange={set('phone')}
                    className={`form-input pl-10 ${errors.phone ? '!border-red-400' : ''}`} placeholder="+91 98765 43210" aria-invalid={!!errors.phone} />
                </div>
                {errors.phone && <p className="text-xs text-red-600 mt-1.5">{errors.phone}</p>}
              </div>
              <div>
                <label className="form-label">Pincode</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" inputMode="numeric" value={form.pincode} onChange={set('pincode')}
                    className={`form-input pl-10 ${errors.pincode ? '!border-red-400' : ''}`} placeholder="560001" maxLength={7} aria-invalid={!!errors.pincode} />
                </div>
                {errors.pincode && <p className="text-xs text-red-600 mt-1.5">{errors.pincode}</p>}
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="form-label">Address</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 text-slate-400 w-4 h-4" />
                <input type="text" value={form.address} onChange={set('address')} className="form-input pl-10" placeholder="Street, City, State" />
              </div>
            </div>

            {/* Referral code */}
            <div>
              <label className="form-label flex items-center gap-2">
                <Hash size={14} />
                Referral Code
                <span className="text-slate-400 text-xs font-normal">(leave blank = Tier 1 Partner)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={form.referralCode}
                  onChange={set('referralCode')}
                  className={`form-input pr-10 uppercase tracking-wider font-mono ${
                    refStatus?.valid === true  ? 'border-emerald-400 focus:ring-emerald-400' :
                    refStatus?.valid === false ? 'border-red-400 focus:ring-red-400' : ''
                  }`}
                  placeholder=""
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {refChecking && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-600 block" />}
                  {!refChecking && refStatus?.valid === true  && <CheckCircle2 size={16} className="text-emerald-500" />}
                  {!refChecking && refStatus?.valid === false && <XCircle      size={16} className="text-red-500" />}
                </div>
              </div>
              {refStatus?.valid === true  && <p className="text-emerald-600 text-xs mt-1.5">Got it. {refStatus.name?.split(' ')[0]} brought you in.</p>}
              {refStatus?.valid === false && <p className="text-red-500 text-xs mt-1.5">That code isn't one of ours. Double-check with whoever shared it.</p>}
            </div>

            {/* Delivery commitment */}
            <div className={`p-4 rounded-xl border-2 transition-all ${
              willDeliver ? 'border-emerald-400 bg-emerald-50' : 'border-[#e8dcc8] bg-parchment-100'
            }`}>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={willDeliver}
                  onChange={e => { setWillDeliver(e.target.checked); if (errors.form) setErrors(p => ({ ...p, form: undefined })); }}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-600 flex-shrink-0"
                />
                <div>
                  <p className={`font-semibold text-sm ${willDeliver ? 'text-emerald-800' : 'text-slate-700'}`}>
                    Yes, I'll deliver to consumers in my area. <span className="text-red-500">*</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Orders from your referral network come to you to pack and hand over. If you're a sub-partner, your parent partner may also route orders your way.
                  </p>
                </div>
              </label>
              {!willDeliver && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 ml-7 flex items-center gap-1.5">
                  <Truck size={12} className="flex-shrink-0" />
                  Tick the box above to finish signing up.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading || !willDeliver || (!!form.referralCode && refStatus?.valid === false)}
              className="btn-primary w-full py-3 text-base mt-2 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />}
              {loading ? 'Creating your account…' : (tier === 1 ? 'Join as a Tier 1 Partner' : 'Join as a Sub-Partner')}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-[#e8dcc8] text-center">
            <p className="text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="text-brand-600 font-semibold hover:text-brand-700">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
