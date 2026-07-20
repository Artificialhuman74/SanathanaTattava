import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Trash2, Mail, ShieldCheck, CheckCircle2, XCircle,
  AlertTriangle, Loader2, ArrowLeft,
} from 'lucide-react';
import { consumerApi } from '../../contexts/AuthContext';
import { useAuth } from '../../contexts/AuthContext';

/* ─────────────────────────────────────────────────────────────────────
 * Account deletion — Google Play "Data deletion" requirement + DPDP Act
 * right to erasure.
 *
 * Mounted ONLY by Legal.tsx, and only when the URL hash is exactly
 * "#delete-account" — there is no route for this in App.tsx and no
 * link to it anywhere in the app's normal navigation (header, footer,
 * profile menu, settings). The only way here is the direct URL:
 *   https://sanathanatattva.shop/shop/legal#delete-account
 * That URL is what gets pasted into Play Console's "Data deletion"
 * field. Deliberately login-free — someone who lost access to their
 * session must still be able to request deletion from any browser.
 * ───────────────────────────────────────────────────────────────────*/

type Stage = 'form' | 'sent' | 'verifying' | 'confirm' | 'invalid' | 'deleting' | 'done';

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function AccountDeletion({ token }: { token: string | null }) {
  const { consumer, consumerLogout } = useAuth();
  const [stage,       setStage]       = useState<Stage>(token ? 'verifying' : 'form');
  const [email,       setEmail]       = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');

  // A token in the URL means we arrived from the confirmation email —
  // verify it (read-only, no mutation) and show the confirm screen.
  useEffect(() => {
    if (!token) return;
    consumerApi.get('/auth/consumer/account-deletion/verify', { params: { token } })
      .then(r => { setMaskedEmail(r.data.maskedEmail); setStage('confirm'); })
      .catch(err => { setError(err.response?.data?.error || 'This link is invalid or has expired.'); setStage('invalid'); });
  }, [token]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    if (!clean || !isValidEmail(clean)) { setError('Enter a valid email address'); return; }
    setError('');
    setLoading(true);
    try {
      await consumerApi.post('/auth/consumer/account-deletion/request', { email: clean });
      setStage('sent');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!token || !acknowledged) return;
    setLoading(true);
    setStage('deleting');
    try {
      await consumerApi.post('/auth/consumer/account-deletion/confirm', { token });
      // If this browser happens to be signed in as the account that was
      // just deleted, clear the local session so the UI matches reality.
      if (consumer) consumerLogout();
      setStage('done');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Something went wrong deleting your account.');
      setStage('invalid');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-parchment-100 flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <Link
          to="/shop/legal"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6"
        >
          <ArrowLeft size={14} /> Back to policies
        </Link>

        <div className="card p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <Trash2 size={18} className="text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Delete Your Account</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            Sanathana Tattva — consumer account deletion request
          </p>

          {/* ── Stage: request form ─────────────────────────────────── */}
          {stage === 'form' && (
            <>
              <p className="text-sm text-slate-600 leading-relaxed mb-5">
                Sorry to see you go. Enter the email your account is registered
                with and we'll send you a confirmation link — nothing is
                deleted until you click it and confirm.
              </p>
              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div>
                  <label className="form-label" htmlFor="del-email">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                    <input
                      id="del-email"
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); if (error) setError(''); }}
                      onBlur={() => setEmail(v => v.trim())}
                      className={`form-input pl-10 ${error ? '!border-red-400' : ''}`}
                      placeholder="you@example.com"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </div>
                  {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full !py-3 flex items-center justify-center gap-2">
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? 'Sending…' : 'Send deletion link'}
                </button>
              </form>
              <RetainedDataNote />
            </>
          )}

          {/* ── Stage: link sent ────────────────────────────────────── */}
          {stage === 'sent' && (
            <div className="text-center py-4 animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <Mail size={24} className="text-emerald-600" />
              </div>
              <p className="font-semibold text-slate-900 mb-1.5">Check your inbox</p>
              <p className="text-sm text-slate-600 leading-relaxed max-w-sm mx-auto">
                If an account exists with that email, we've sent a confirmation
                link. It's valid for 30 minutes, and nothing is deleted until
                you click it and confirm.
              </p>
            </div>
          )}

          {/* ── Stage: verifying token ──────────────────────────────── */}
          {stage === 'verifying' && (
            <div className="text-center py-10">
              <Loader2 size={28} className="animate-spin text-brand-600 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Checking your link…</p>
            </div>
          )}

          {/* ── Stage: confirm (destructive step) ───────────────────── */}
          {stage === 'confirm' && (
            <>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Confirm permanent deletion for <strong className="text-slate-900">{maskedEmail}</strong>.
              </p>

              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4 flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-800 leading-relaxed">
                  This cannot be undone. Your name, email, phone, and saved
                  addresses will be permanently removed and you'll be signed out
                  everywhere.
                </p>
              </div>

              <RetainedDataNote />

              <label className="flex items-start gap-2.5 mt-5 mb-5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={e => setAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-red-600 flex-shrink-0"
                />
                <span className="text-sm text-slate-700">
                  I understand this permanently deletes my account and cannot be undone.
                </span>
              </label>

              <button
                onClick={handleConfirmDelete}
                disabled={!acknowledged || loading}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                Yes, permanently delete my account
              </button>
            </>
          )}

          {/* ── Stage: deleting ──────────────────────────────────────── */}
          {stage === 'deleting' && (
            <div className="text-center py-10">
              <Loader2 size={28} className="animate-spin text-red-600 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Deleting your account…</p>
            </div>
          )}

          {/* ── Stage: invalid/expired token or error ───────────────── */}
          {stage === 'invalid' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                <XCircle size={24} className="text-amber-600" />
              </div>
              <p className="font-semibold text-slate-900 mb-1.5">Link invalid or expired</p>
              <p className="text-sm text-slate-600 leading-relaxed max-w-sm mx-auto mb-5">
                {error || 'This deletion link is invalid or has expired.'}
              </p>
              <button
                onClick={() => { setStage('form'); setError(''); setAcknowledged(false); }}
                className="btn-secondary"
              >
                Start over
              </button>
            </div>
          )}

          {/* ── Stage: done ──────────────────────────────────────────── */}
          {stage === 'done' && (
            <div className="text-center py-4">
              <div
                className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4 animate-fade-in"
                style={{ animationDuration: '700ms' }}
              >
                <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
              <p
                className="font-semibold text-slate-900 mb-1.5 animate-fade-in"
                style={{ animationDuration: '700ms', animationDelay: '120ms', animationFillMode: 'backwards' }}
              >
                Done. Take care.
              </p>
              <p
                className="text-sm text-slate-600 leading-relaxed max-w-sm mx-auto animate-fade-in"
                style={{ animationDuration: '700ms', animationDelay: '220ms', animationFillMode: 'backwards' }}
              >
                Your personal details are gone, and we've sent a confirmation
                to your email. You've been signed out of this device. If you
                ever want to press oil with us again, you know where to find us.
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Questions? Write to{' '}
          <a href="mailto:privacy@sanathanatattva.shop" className="text-brand-700 hover:underline">
            privacy@sanathanatattva.shop
          </a>
        </p>
      </div>
    </div>
  );
}

function RetainedDataNote() {
  return (
    <div className="rounded-xl bg-parchment-100 border border-[#e8dcc8] px-4 py-3.5 mt-5">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={14} className="text-brand-700" />
        <p className="text-xs font-semibold text-brand-900">What happens to your data</p>
      </div>
      <ul className="space-y-1.5 text-xs text-slate-600 leading-relaxed">
        <li>• <strong className="text-slate-800">Deleted:</strong> name, email, phone, saved addresses, Google sign-in link, password.</li>
        <li>• <strong className="text-slate-800">Retained (anonymised):</strong> order and invoice records, for 8 years, as required by Indian tax law. These no longer identify you.</li>
      </ul>
    </div>
  );
}
