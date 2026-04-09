import React, { useState, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Mail, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';

export default function VerifyPending() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { consumerLoginWithToken } = useAuth();
  const email = (location.state as any)?.email || '';

  const [otp,     setOtp]     = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[i] = val.slice(-1);
    setOtp(next);
    if (val && i < 5) inputs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(''));
      inputs.current[5]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) { toast.error('Enter the 6-digit code'); return; }
    if (!email) { toast.error('Email not found. Please register again.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/consumer/verify-otp', { email, otp: code });
      consumerLoginWithToken(data.token, data.consumer);
      toast.success('Email verified! Welcome aboard.');
      navigate('/shop', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Invalid code. Please try again.');
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) { toast.error('Email not found. Please register again.'); return; }
    setResending(true);
    try {
      await api.post('/auth/consumer/resend-verification', { email });
      toast.success('New code sent! Check your inbox.');
      setOtp(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={28} className="text-brand-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Verify your email</h2>
          <p className="text-slate-500 mt-2 text-sm">
            We sent a 6-digit code to{' '}
            <strong className="text-slate-700">{email || 'your email'}</strong>
          </p>
        </div>

        {/* OTP boxes */}
        <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              autoFocus={i === 0}
              className={`w-11 h-14 text-center text-xl font-bold border-2 rounded-xl outline-none transition-colors
                ${digit ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-slate-200 text-slate-900'}
                focus:border-brand-500`}
            />
          ))}
        </div>

        <button
          onClick={handleVerify}
          disabled={loading || otp.join('').length < 6}
          className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
          {loading ? 'Verifying…' : 'Verify Code'}
        </button>

        <div className="mt-4 text-center space-y-3">
          <p className="text-xs text-slate-400">Didn't receive it? Check your spam folder.</p>
          <button
            onClick={handleResend}
            disabled={resending}
            className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50"
          >
            {resending ? <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-brand-600" /> : <RefreshCw size={13} />}
            Resend code
          </button>
        </div>

        <div className="mt-5 pt-5 border-t border-slate-100 text-center">
          <Link to="/shop/login" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600">
            <ArrowLeft size={13} /> Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
