import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  TrendingUp, Phone, User, Hash, ArrowLeft, ShoppingCart,
  RefreshCw, CheckCircle2, AlertCircle, ChevronRight, Tag,
} from 'lucide-react';

type Step = 'details' | 'otp' | 'profile';

interface LocationState {
  phone?: string;
  email?: string;
  phone_verified_token?: string;
  otp_verified?: boolean;
}

export default function ConsumerRegister() {
  const { consumerSendOtp, consumerVerifyOtp, consumerCompleteRegistration } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();
  const state      = (location.state as LocationState) || {};

  /* If redirected from Login with verified phone, jump straight to profile */
  const [step,       setStep]       = useState<Step>(state.otp_verified ? 'profile' : 'details');
  const [name,       setName]       = useState('');
  const [phone,      setPhone]      = useState(state.phone || '');
  const [refCode,    setRefCode]    = useState('');

  const [pvToken,    setPvToken]    = useState(state.phone_verified_token || '');
  const [otp,        setOtp]        = useState(['', '', '', '', '', '']);
  const [emailMask,  setEmailMask]  = useState('');
  const [loading,    setLoading]    = useState(false);
  const [resendTimer,setResendTimer]= useState(0);
  const [devOtp,     setDevOtp]     = useState<string | null>(null);

  /* Referral code validation */
  const [codeValid,  setCodeValid]  = useState<boolean | null>(null);
  const [dealerName, setDealerName] = useState('');

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  /* Countdown */
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpRefs.current[0]?.focus(), 100);
  }, [step]);

  /* Live referral code validation */
  useEffect(() => {
    const code = refCode.trim().toUpperCase();
    if (code.length < 5) { setCodeValid(null); setDealerName(''); return; }
    const t = setTimeout(() => {
      api.get(`/auth/consumer/validate-dealer/${code}`)
        .then(r => { setCodeValid(r.data.valid); setDealerName(r.data.dealerName || ''); })
        .catch(() => setCodeValid(false));
    }, 350);
    return () => clearTimeout(t);
  }, [refCode]);

  /* ── Step 1: Send OTP ──────────────────────────────────────────────── */
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())  { toast.error('Please enter your name'); return; }
    if (!phone.trim()) { toast.error('Please enter your phone number'); return; }
    setLoading(true);
    try {
      const result = await consumerSendOtp(phone.trim());
      if (!result.is_new_user) {
        toast.error('This number is already registered. Please login.');
        navigate('/shop/login');
        return;
      }
      setEmailMask(result.email_masked);
      if (result.dev_otp) setDevOtp(result.dev_otp);
      setStep('otp');
      setResendTimer(60);
      toast.success('OTP sent to your email!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  /* ── OTP digit handlers ───────────────────────────────────────────── */
  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next  = [...otp]; next[index] = digit; setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const full = next.join('');
      if (full.length === 6) setTimeout(() => handleVerifyOtp(full), 80);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      const next = [...otp]; next[index - 1] = ''; setOtp(next);
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split('')); otpRefs.current[5]?.focus();
      setTimeout(() => handleVerifyOtp(text), 80);
    }
  };

  /* ── Step 2: Verify OTP ───────────────────────────────────────────── */
  const handleVerifyOtp = async (code?: string) => {
    const otpCode = code || otp.join('');
    if (otpCode.length < 6) { toast.error('Please enter all 6 digits'); return; }
    setLoading(true);
    try {
      const result = await consumerVerifyOtp(phone.trim(), otpCode);
      if (result.logged_in) {
        // edge case: account registered between send and verify
        toast.success('Account verified!');
        navigate('/shop', { replace: true });
      } else if (result.needs_registration) {
        setPvToken(result.phone_verified_token || '');
        setStep('profile');
        toast.success('Phone verified! Complete your profile.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  /* ── Resend OTP ───────────────────────────────────────────────────── */
  const handleResend = async () => {
    if (resendTimer > 0) return;
    setLoading(true);
    try {
      const result = await consumerSendOtp(phone.trim());
      if (result.dev_otp) setDevOtp(result.dev_otp);
      setOtp(['', '', '', '', '', '']); setResendTimer(60);
      otpRefs.current[0]?.focus();
      toast.success('New OTP sent!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  };

  /* ── Step 3: Complete registration ───────────────────────────────── */
  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Please enter your name'); return; }
    if (refCode && codeValid === false) { toast.error('Invalid referral code'); return; }
    setLoading(true);
    try {
      await consumerCompleteRegistration(pvToken, name.trim(), refCode.trim() || undefined);
      toast.success('Account created! Welcome to TradeHub 🎉');
      navigate('/shop', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  /* Progress indicator */
  const steps = [
    { id: 'details', label: 'Details' },
    { id: 'otp',     label: 'Verify' },
    { id: 'profile', label: 'Done' },
  ];
  const stepIdx = steps.findIndex(s => s.id === step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Back */}
        <div className="mb-6">
          <Link to="/shop/login" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm">
            <ArrowLeft size={14} /> Back to Login
          </Link>
        </div>

        {/* Logo */}
        <div className="text-center mb-6">
          <Link to="/shop" className="inline-flex items-center gap-2 justify-center">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-extrabold text-slate-900">TradeHub</span>
          </Link>
          <p className="text-slate-500 mt-2 text-sm">Create your shopping account</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-0 mb-6">
          {steps.map((s, i) => (
            <React.Fragment key={s.id}>
              <div className="flex flex-col items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${i < stepIdx ? 'bg-brand-600 text-white' : i === stepIdx ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-slate-100 text-slate-400'}`}>
                  {i < stepIdx ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <span className={`text-xs mt-1 font-medium ${i <= stepIdx ? 'text-brand-600' : 'text-slate-400'}`}>{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 flex-1 mt-[-14px] transition-all ${i < stepIdx ? 'bg-brand-500' : 'bg-slate-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8">

          {/* ── STEP 1: Details ──────────────────────────────────────── */}
          {step === 'details' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Your Details</h2>

              <div>
                <label className="form-label">Full Name <span className="text-red-500">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className="form-input pl-10" placeholder="Your full name" required />
                </div>
              </div>

              <div>
                <label className="form-label">Mobile Number <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="form-input pl-10" placeholder="+91 98765 43210" autoComplete="tel" required />
                </div>
              </div>

              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Hash size={13} /> Dealer Referral Code
                  <span className="text-slate-400 font-normal text-xs">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={refCode}
                    onChange={e => setRefCode(e.target.value.toUpperCase())}
                    className={`form-input uppercase tracking-wider font-mono pr-8 ${
                      codeValid === true ? 'border-emerald-400 focus:border-emerald-500' :
                      codeValid === false ? 'border-red-400 focus:border-red-500' : ''
                    }`}
                    placeholder="e.g. A0001"
                    maxLength={5}
                  />
                  {codeValid === true && <CheckCircle2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />}
                  {codeValid === false && <AlertCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400" />}
                </div>
                {codeValid === true && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                    <Tag size={10} /> Linked to dealer: <strong>{dealerName}</strong> — get a referral discount!
                  </p>
                )}
                {codeValid === false && <p className="text-xs text-red-500 mt-1">Invalid referral code.</p>}
              </div>

              <button type="submit" disabled={loading || codeValid === false} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" /> : <ChevronRight size={18} />}
                {loading ? 'Sending OTP…' : 'Send Verification OTP'}
              </button>
            </form>
          )}

          {/* ── STEP 2: OTP ──────────────────────────────────────────── */}
          {step === 'otp' && (
            <div className="space-y-5">
              <h2 className="text-lg font-bold text-slate-900">Verify your number</h2>

              <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-700">
                  {emailMask ? <>OTP sent to <strong>{emailMask}</strong></> : <>OTP generated — check below</>}
                </p>
              </div>

              {devOtp && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-0.5">Dev Mode — SMTP not configured</p>
                    <p className="text-sm text-amber-800">
                      Your OTP: <span className="font-mono font-bold tracking-widest text-xl">{devOtp}</span>
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="form-label text-center block mb-3">Enter 6-digit OTP</label>
                <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => handleOtpChange(i, e.target.value)}
                      onKeyDown={e => handleOtpKeyDown(i, e)}
                      className={`w-11 h-14 text-center text-2xl font-bold rounded-xl border-2 outline-none transition-all
                        ${digit ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-900'}
                        focus:border-brand-500 focus:ring-2 focus:ring-brand-100`}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={() => handleVerifyOtp()}
                disabled={loading || otp.join('').length < 6}
                className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" /> : <CheckCircle2 size={18} />}
                {loading ? 'Verifying…' : 'Verify OTP'}
              </button>

              <div className="text-center">
                {resendTimer > 0 ? (
                  <p className="text-sm text-slate-400">Resend in <strong className="text-slate-600">{resendTimer}s</strong></p>
                ) : (
                  <button onClick={handleResend} disabled={loading} className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-semibold disabled:opacity-50">
                    <RefreshCw size={13} /> Resend OTP
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Profile (for new users landing from login or completing registration) */}
          {step === 'profile' && (
            <form onSubmit={handleCompleteRegistration} className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100 mb-2">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                <p className="text-sm text-emerald-700 font-medium">Phone verified! Complete your profile.</p>
              </div>

              <div>
                <label className="form-label">Full Name <span className="text-red-500">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className="form-input pl-10" placeholder="Your full name" required autoFocus />
                </div>
              </div>

              {/* If came from login (no referral code yet), show referral field */}
              <div>
                <label className="form-label flex items-center gap-1.5">
                  <Hash size={13} /> Dealer Referral Code
                  <span className="text-slate-400 font-normal text-xs">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={refCode}
                    onChange={e => setRefCode(e.target.value.toUpperCase())}
                    className={`form-input uppercase tracking-wider font-mono pr-8 ${
                      codeValid === true ? 'border-emerald-400' : codeValid === false ? 'border-red-400' : ''
                    }`}
                    placeholder="e.g. A0001"
                    maxLength={5}
                  />
                  {codeValid === true && <CheckCircle2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />}
                  {codeValid === false && <AlertCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400" />}
                </div>
                {codeValid === true && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                    <Tag size={10} /> Linked to: <strong>{dealerName}</strong>
                  </p>
                )}
              </div>

              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                📍 You'll add a delivery address at checkout — no need to enter one now.
              </p>

              <button type="submit" disabled={loading || codeValid === false} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-60">
                {loading ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" /> : <CheckCircle2 size={18} />}
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
          )}

          {step !== 'profile' && (
            <div className="mt-5 pt-5 border-t border-slate-100 text-center space-y-3">
              <p className="text-sm text-slate-500">
                Already have an account?{' '}
                <Link to="/shop/login" className="text-brand-600 font-semibold hover:text-brand-700">Login here</Link>
              </p>
              <Link to="/shop" className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-600">
                <ShoppingCart size={14} /> Continue as guest
              </Link>
            </div>
          )}
        </div>

        {/* Trader/Admin access is at the footer of the landing page */}
      </div>
    </div>
  );
}
