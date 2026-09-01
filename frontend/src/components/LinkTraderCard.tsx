import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Tag, Loader2 } from 'lucide-react';
import { useAuth, consumerApi } from '../contexts/AuthContext';

/**
 * Link a trader from the profile, by referral code.
 *
 * This used to be a notice telling people to enter their code at checkout,
 * because checkout was the only place that could accept one. That was fine
 * while a linked trader only affected the discount; it stopped being fine when
 * joining the lucky draw started requiring one, since someone who wanted to
 * join before their first order had nowhere to go.
 */
export default function LinkTraderCard({ discountPct }: { discountPct: number }) {
  const { refreshConsumer } = useAuth();
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setSaving(true);
    try {
      // The route is mounted under /api/consumer, like every other consumer
      // endpoint. Posting to /link-dealer hit a 404, which surfaced as the
      // generic "couldn't link that code" because there was no error body.
      const { data } = await consumerApi.post('/consumer/link-dealer', { referral_code: code.trim() }, { skipBaseRotation: true });
      toast.success(`Linked to ${data.dealer_name}.`);
      setCode('');
      await refreshConsumer();
    } catch (err: any) {
      // Only say the code was wrong when the server actually said so. A 404 or
      // a dropped connection is not the same thing, and telling someone their
      // correct code is invalid sends them to their dealer for no reason.
      toast.error(
        err?.response?.data?.error
        || (err?.response ? 'Something went wrong linking that code. Try again.' : 'No connection. Check your network and try again.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Tag size={16} className="text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">Link your trader</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Your trader packs and delivers your orders.
            {discountPct > 0 && <> Linking one also gets you <strong>{discountPct}% off</strong>.</>}
            {' '}You need one before you can join Bhagya Chakra.
          </p>

          <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mt-3">
            <label htmlFor="referral-code" className="sr-only">Dealer referral code</label>
            <input
              id="referral-code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              /* Tier-1 codes are one letter plus four digits (A0000); once
                 A-Z is used up the prefix becomes two letters (AA0000), so a
                 valid code is 5 or 6 characters. A cap of 5 silently
                 truncated every two-letter code. */
              maxLength={6}
              placeholder="A0001"
              className="form-input w-36 py-2 uppercase tracking-widest font-mono text-sm"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={saving || !code.trim()}
              className="px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              style={{ minHeight: 40 }}
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Link
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
