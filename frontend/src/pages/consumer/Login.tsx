import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  TrendingUp, Phone, ArrowLeft, ShoppingBag, ShoppingCart,
  RefreshCw, CheckCircle2, AlertCircle, ChevronRight,
} from 'lucide-react';

type Step = 'phone' | 'otp';

export default function ConsumerLogin() {
  const { consumerSendOtp, consumerVerifyOtp } = useAuth();
  const navigate = useNavigate();

  const [step,        setStep]        = useState<Step>('phone');
  const [phone,       setPhone]       = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [otp,         setOtp]         = useState(['', '', '', '', '', '']);
  const [loading,     setLoading]     = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [devOtp,      setDevOtp]      = useState<string | null>(null);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  /* Countdown */
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  /* Auto-focus first OTP box */
  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpRefs.current[0]?.focus(), 100);
  }, [step]);

  /* ── Step 1: Send OTP ──────────────────────────────────────────────── */
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error('Please enter your phone number'); return; }
    setLoading(true);
    try {
      const result = await consumerSendOtp(phone.trim());
      setEmailMasked(result.email_masked);
      if (result.dev_otp) setDevOtp(result.dev_otp);
      setStep('otp');
      setResendTimer(60);
      toast.success('OTP sent!');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to send OTP';
      /* "Email is required for first-time registration" = phone not found → redirect to register */
      if (
        msg.toLowerCase().includes('first-time') ||
        msg.toLowerCase().includes('no email') ||
        msg.toLowerCase().includes('not found') ||
        err.response?.status === 404
      ) {
        toast('Phone not registered. Create an account first!', { icon: '👋' });
        navigate('/shop/register', { state: { phone: phone.trim() } });
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ── OTP digit input handlers ─────────────────────────────────────── */
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
        toast.success('Welcome back!');
        navigate('/shop', { replace: true });
      } else if (result.needs_registration) {
        toast('New number — please complete registration 👋');
        navigate('/shop/register', {
          state: {
            phone: result.phone,
            email: result.email,
            phone_verified_token: result.phone_verified_token,
            otp_verified: true,
          },
        });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid OTP. Please try again.');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Back link */}
        <div className="mb-6">
          {step === 'phone' ? (
            <Link to="/shop" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm">
              <ArrowLeft size={14} /> Continue as Guest
            </Link>
          ) : (
            <button
              onClick={() => { setStep('phone'); setOtp(['', '', '', '', '', '']); setDevOtp(null); }}
              className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm"
            >
              <ArrowLeft size={14} /> Change Number
            </button>
          )}
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/shop" className="inline-flex items-center gap-2 justify-center">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-extrabold text-slate-900">TradeHub</span>
          </Link>
          <p className="text-slate-500 mt-2 text-sm">
            {step === 'phone' ? 'Sign in with your phone number' : 'Enter your verification code'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8">
          <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-brand-50 rounded-xl">
            <ShoppingBag size={18} className="text-brand-600" />
            <span className="text-brand-700 font-semibold text-sm">Consumer Login</span>
          </div>

          {/* ── STEP 1: Phone ────────────────────────────────────────── */}
          {step === 'phone' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="form-label">Mobile Number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="form-input pl-10"
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  We'll send a one-time verification code to your number.
                </p>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2">
                {loading
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />
                  : <ChevronRight size={18} />
                }
                {loading ? 'Sending OTP…' : 'Send OTP'}
              </button>
            </form>
          )}

          {/* ── STEP 2: OTP ──────────────────────────────────────────── */}
          {step === 'otp' && (
            <div className="space-y-5">
              {/* Sent-to info */}
              <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-700">
                  {emailMasked ? <>OTP sent to <strong>{emailMasked}</strong></> : <>Verification code generated</>}
                </p>
              </div>

              {/* Dev mode banner */}
              {devOtp && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                  <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-0.5">Dev Mode — SMTP not configured</p>
                    <p className="text-sm text-amber-800">
                      Your OTP: <span className="font-mono font-bold tracking-widest text-xl">{devOtp}</span>
                    </p>
                    <p className="text-xs text-amber-600 mt-1">Check server console too. Configure SMTP in .env for production.</p>
                  </div>
                </div>
              )}

              {/* 6-box OTP input */}
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
                      className={`w-11 h-14 text-center text-2xl font-bold rounded-xl border-2 outline-none transition-all select-none
                        ${digit
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-900'}
                        focus:border-brand-500 focus:ring-2 focus:ring-brand-100`}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={() => handleVerifyOtp()}
                disabled={loading || otp.join('').length < 6}
                className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />
                  : <CheckCircle2 size={18} />
                }
                {loading ? 'Verifying…' : 'Verify & Login'}
              </button>

              {/* Resend countdown */}
              <div className="text-center">
                {resendTimer > 0 ? (
                  <p className="text-sm text-slate-400">
                    Resend in <strong className="text-slate-600">{resendTimer}s</strong>
                  </p>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-semibold disabled:opacity-50"
                  >
                    <RefreshCw size={13} /> Resend OTP
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-5 pt-5 border-t border-slate-100 text-center space-y-3">
            <p className="text-sm text-slate-500">
              New here?{' '}
              <Link to="/shop/register" className="text-brand-600 font-semibold hover:text-brand-700">
                Create an account
              </Link>
            </p>
            <Link to="/shop" className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
              <ShoppingCart size={14} /> Continue shopping as guest
            </Link>
          </div>
        </div>

        {/* Trader/Admin access is at the footer of the landing page */}
      </div>
    </div>
  );
}
