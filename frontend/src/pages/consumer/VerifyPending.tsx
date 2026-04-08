import React, { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Mail, RefreshCw, CheckCircle2 } from 'lucide-react';

export default function VerifyPending() {
  const location = useLocation();
  const email    = (location.state as any)?.email || '';
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);

  const handleResend = async () => {
    if (!email) { toast.error('Email not found. Please register again.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/consumer/resend-verification', { email });
      setSent(true);
      toast.success('Verification email resent!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to resend email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail size={28} className="text-brand-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Check your email</h2>
        <p className="text-slate-500 mt-2 text-sm">
          We sent a verification link to <strong>{email || 'your email'}</strong>.
          Click the link to activate your account.
        </p>
        <p className="text-slate-400 text-xs mt-3">Didn't receive it? Check your spam folder.</p>

        {!sent ? (
          <button
            onClick={handleResend}
            disabled={loading}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
          >
            {loading ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <RefreshCw size={15} />}
            Resend verification email
          </button>
        ) : (
          <div className="mt-5 flex items-center justify-center gap-2 text-emerald-600 text-sm font-medium">
            <CheckCircle2 size={16} /> Sent! Check your inbox.
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-slate-100">
          <Link to="/shop/login" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
