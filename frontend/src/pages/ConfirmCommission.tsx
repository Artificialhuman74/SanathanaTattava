import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { getApiHttpBaseUrl } from '../config/apiBase';
import {
  Check, X, ShieldAlert, Loader2, Banknote, AlertCircle, Mail,
} from 'lucide-react';

interface Loaded {
  commission: {
    id: number; amount: number; rate: number; type: string;
    status: 'awaiting_confirmation' | 'paid' | 'disputed';
    payment_method: 'cash' | 'bank_transfer' | null;
    paid_at_offline: string | null;
    payment_note: string | null;
    confirmed_at: string | null;
    disputed_at: string | null;
    dispute_reason: string | null;
    order_number: string | null;
    order_amount: number | null;
  };
  sub_dealer: { id: number; name: string; email: string | null };
  parent:     { id: number | null; name: string | null; email: string | null };
  expired: boolean;
}

const inr = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ConfirmCommission() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<'confirm' | 'dispute' | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'confirmed' | 'disputed' | null>(null);

  useEffect(() => {
    if (!token) { setError('Missing confirmation token'); setLoading(false); return; }
    axios.get(`${getApiHttpBaseUrl()}/public/commission-confirmation/${encodeURIComponent(token)}`)
      .then(r => setData(r.data))
      .catch(err => setError(err?.response?.data?.error || 'Could not load confirmation link'))
      .finally(() => setLoading(false));
  }, [token]);

  const confirm = async () => {
    setSubmitting('confirm');
    try {
      await axios.post(`${getApiHttpBaseUrl()}/public/commission-confirmation/${encodeURIComponent(token)}/confirm`);
      setDone('confirmed');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to confirm');
    } finally { setSubmitting(null); }
  };

  const dispute = async () => {
    setSubmitting('dispute');
    try {
      await axios.post(`${getApiHttpBaseUrl()}/public/commission-confirmation/${encodeURIComponent(token)}/dispute`,
        { reason: reason.trim() || undefined });
      setDone('disputed');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to submit dispute');
    } finally { setSubmitting(null); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="card max-w-md w-full p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Link Invalid</h1>
          <p className="text-sm text-slate-500">{error}</p>
          <Link to="/" className="inline-block mt-6 text-sm text-brand-600 hover:underline">Go to homepage</Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { commission: c, sub_dealer, parent, expired } = data;

  /* Success states */
  if (done === 'confirmed' || c.status === 'paid') {
    return (
      <ResultCard
        kind="success"
        title="Payment Confirmed"
        message={`Thanks ${sub_dealer.name}! We've recorded that you received ${inr(c.amount)} from ${parent.name || 'your parent dealer'}.`}
      />
    );
  }
  if (done === 'disputed' || c.status === 'disputed') {
    return (
      <ResultCard
        kind="warning"
        title="Dispute Submitted"
        message={`We've notified the admin and ${parent.name || 'the parent dealer'}. They will reach out to reconcile.`}
      />
    );
  }

  if (expired) {
    return (
      <ResultCard
        kind="error"
        title="Link Expired"
        message="This confirmation link has expired. Please ask the parent dealer to re-send a new link."
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#14532d] to-[#16a34a] px-6 py-8 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <Banknote className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Confirm Commission Payment</h1>
                <p className="text-emerald-100 text-sm">Hi {sub_dealer.name}, please review below</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>{parent.name || 'Your parent dealer'}</strong> has marked the commission below as paid to you.
              Please confirm whether you actually received it.
            </p>

            {/* Payment details */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 space-y-3">
              <Row label="Amount" value={inr(c.amount)} valueClass="text-2xl font-extrabold text-emerald-700" />
              <Row label="Method" value={c.payment_method === 'cash' ? '💵 Cash (in person)' : '🏦 Bank transfer'} />
              {c.order_number && <Row label="Order" value={c.order_number} valueClass="font-mono text-sm" />}
              {c.paid_at_offline && (
                <Row label="Marked paid on" value={new Date(c.paid_at_offline).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />
              )}
              {c.payment_note && (
                <div className="pt-2 border-t border-emerald-200">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Note from {parent.name}</p>
                  <p className="text-sm italic text-slate-700">"{c.payment_note}"</p>
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                {error}
              </div>
            )}

            {!showDispute ? (
              <>
                <div className="flex gap-3">
                  <button
                    onClick={confirm}
                    disabled={submitting !== null}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
                  >
                    {submitting === 'confirm' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Yes, I received it
                  </button>
                  <button
                    onClick={() => setShowDispute(true)}
                    disabled={submitting !== null}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold rounded-xl transition-colors disabled:opacity-50"
                  >
                    <X size={16} />
                    No, I didn't
                  </button>
                </div>
                <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1.5">
                  <Mail size={12} /> Disputing notifies the admin immediately
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
                  <ShieldAlert size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700 leading-relaxed">
                    You're about to dispute this payment. The admin and {parent.name} will both be notified by email.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">
                    Reason (optional but helpful)
                  </label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="e.g. 'I never received the cash' or 'No bank transfer arrived'"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">{reason.length}/1000</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowDispute(false); setReason(''); }}
                    className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={dispute}
                    disabled={submitting !== null}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {submitting === 'dispute' ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                    Submit Dispute
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Sanathana Tattva &middot; <Link to="/" className="hover:underline">Home</Link>
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-medium text-slate-900 ${valueClass}`}>{value}</span>
    </div>
  );
}

function ResultCard({ kind, title, message }: { kind: 'success' | 'warning' | 'error'; title: string; message: string }) {
  const styles = {
    success: { ring: 'bg-emerald-100', icon: 'text-emerald-600', Icon: Check },
    warning: { ring: 'bg-amber-100',   icon: 'text-amber-600',   Icon: ShieldAlert },
    error:   { ring: 'bg-red-100',     icon: 'text-red-600',     Icon: AlertCircle },
  }[kind];
  const I = styles.Icon;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card max-w-md w-full p-8 text-center">
        <div className={`w-16 h-16 rounded-full ${styles.ring} flex items-center justify-center mx-auto mb-4`}>
          <I className={`w-8 h-8 ${styles.icon}`} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
        <Link to="/" className="inline-block mt-6 text-sm text-brand-600 hover:underline">Go to homepage</Link>
      </div>
    </div>
  );
}
