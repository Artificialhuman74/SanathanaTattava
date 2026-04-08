import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const { consumerLoginWithToken } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error,  setError]  = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) { setStatus('error'); setError('No verification token found.'); return; }

    api.get(`/auth/consumer/verify-email?token=${encodeURIComponent(token)}`)
      .then(({ data }) => {
        consumerLoginWithToken(data.token, data.consumer);
        setStatus('success');
        setTimeout(() => navigate('/shop', { replace: true }), 2000);
      })
      .catch(err => {
        setStatus('error');
        setError(err.response?.data?.error || 'Verification failed.');
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <Loader2 size={48} className="mx-auto text-brand-600 animate-spin mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Verifying your email…</h2>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={48} className="mx-auto text-emerald-500 mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Email Verified!</h2>
            <p className="text-slate-500 mt-2">Redirecting you to the shop…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={48} className="mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Verification Failed</h2>
            <p className="text-slate-500 mt-2">{error}</p>
            <Link to="/shop/resend-verification" className="mt-4 inline-block text-brand-600 font-semibold hover:text-brand-700 text-sm">
              Resend verification email →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
