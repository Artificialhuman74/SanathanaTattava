import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Package, RefreshCw, ArrowLeftRight, X, History, AlertCircle, Wallet, ChevronRight, AlertTriangle, MessageCircle } from 'lucide-react';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import { formatIstDate } from '../../utils/dateTime';

type HoldingStatus =
  | 'pending_delivery'
  | 'held'
  | 'refund_requested'
  | 'refunded'
  | 'forfeited';

interface HeldHolding {
  id: number;
  invoice_id: number;
  order_item_id: number;
  original_product_id: number;
  current_product_id: number;
  container_type: string;
  deposit_amount: number;
  status: HoldingStatus;
  created_at: string;
  updated_at: string;
  current_product_name: string;
  current_product_unit: string;
  original_product_name: string;
}

interface HistoryHolding {
  id: number;
  invoice_id: number;
  container_type: string;
  deposit_amount: number;
  status: HoldingStatus;
  refund_destination: 'manual_bank' | 'store_credit' | null;
  requested_at: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  damage_photo_url: string | null;
  damage_dispute_status: 'open' | 'upheld' | 'rejected' | null;
  dispute_deadline: string | null;
  dispute_opened_at: string | null;
  dispute_resolved_at: string | null;
  current_product_name: string;
  original_product_name: string;
}

interface SwappableProduct {
  id: number;
  name: string;
  unit: string;
  container_type: string;
  price: number;
}

interface ContainersResponse {
  held: HeldHolding[];
  history: HistoryHolding[];
  swappable: SwappableProduct[];
  support_whatsapp_number: string | null;
}

interface LedgerEntry {
  id: number;
  delta: number;
  reason: string | null;
  source_type: string | null;
  source_id: number | null;
  created_at: string;
}

interface StoreCreditResponse {
  balance: number;
  ledger: LedgerEntry[];
}

const STATUS_LABELS: Record<HoldingStatus, string> = {
  pending_delivery: 'Awaiting delivery',
  held: 'In your care',
  refund_requested: 'Refund requested',
  refunded: 'Refunded',
  forfeited: 'Forfeited',
};

const STATUS_COLORS: Record<HoldingStatus, string> = {
  pending_delivery: 'bg-amber-50 text-amber-700 border-amber-200',
  held: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  refund_requested: 'bg-blue-50 text-blue-700 border-blue-200',
  refunded: 'bg-slate-50 text-slate-700 border-slate-200',
  forfeited: 'bg-red-50 text-red-700 border-red-200',
};

const DEST_LABEL: Record<NonNullable<HistoryHolding['refund_destination']>, string> = {
  manual_bank: 'Manual bank refund',
  store_credit: 'Store credit',
};

export default function ConsumerContainers() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [held, setHeld] = useState<HeldHolding[]>([]);
  const [history, setHistory] = useState<HistoryHolding[]>([]);
  const [swappable, setSwappable] = useState<SwappableProduct[]>([]);
  const [refundModal, setRefundModal] = useState<HeldHolding | null>(null);
  const [swapModal, setSwapModal] = useState<HeldHolding | null>(null);
  const [disputeModal, setDisputeModal] = useState<HistoryHolding | null>(null);
  const [wallet, setWallet] = useState<StoreCreditResponse | null>(null);
  const [supportWhatsapp, setSupportWhatsapp] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    if (!consumer) { navigate('/shop/login', { replace: true }); return; }
    setLoading(true);
    Promise.all([
      consumerApi.get<ContainersResponse>('/consumer/containers'),
      consumerApi.get<StoreCreditResponse>('/consumer/store-credit').catch(() => null),
    ])
      .then(([containersRes, walletRes]) => {
        setHeld(containersRes.data.held || []);
        setHistory(containersRes.data.history || []);
        setSwappable(containersRes.data.swappable || []);
        setSupportWhatsapp(containersRes.data.support_whatsapp_number || null);
        if (walletRes) setWallet(walletRes.data);
      })
      .catch(err => {
        if (err.response?.status === 401) {
          consumerLogout();
          navigate('/shop/login', { replace: true });
        } else {
          toast.error('Failed to load containers');
        }
      })
      .finally(() => setLoading(false));
  }, [consumer]); // eslint-disable-line

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* Restrict the history list to terminal/transitional statuses so the
   * Held section above isn't duplicated. */
  const visibleHistory = useMemo(
    () => history.filter(h => h.status !== 'held' && h.status !== 'pending_delivery'),
    [history]
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My Containers</h1>
        <p className="text-sm text-slate-500 mt-1">
          Steel containers in your care. Refill them with the same product to skip the deposit,
          swap them for a different oil of the same size, or return them for a refund.
        </p>
      </header>

      {wallet && wallet.balance > 0 && <WalletPill balance={wallet.balance} />}

      {loading ? (
        <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
      ) : held.length === 0 && visibleHistory.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Held / active holdings ─────────────────────────────────── */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
              In your care ({held.length})
            </h2>
            {held.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                You currently hold no containers.
              </div>
            ) : (
              <ul className="space-y-3">
                {held.map(h => (
                  <HeldCard
                    key={h.id}
                    holding={h}
                    onRefill={() => navigate('/shop')}
                    onRefund={() => setRefundModal(h)}
                    onSwap={() => setSwapModal(h)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ── History ────────────────────────────────────────────────── */}
          {visibleHistory.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                <History className="w-4 h-4" />
                History
              </h2>
              <ul className="space-y-2">
                {visibleHistory.map(h => (
                  <HistoryCard
                    key={h.id}
                    holding={h}
                    supportWhatsapp={supportWhatsapp}
                    onOpenDispute={() => setDisputeModal(h)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {refundModal && (
        <RefundModal
          holding={refundModal}
          onClose={() => setRefundModal(null)}
          onDone={() => { setRefundModal(null); fetchAll(); }}
        />
      )}
      {swapModal && (
        <SwapModal
          holding={swapModal}
          swappable={swappable}
          onClose={() => setSwapModal(null)}
          onDone={() => { setSwapModal(null); fetchAll(); }}
        />
      )}
      {disputeModal && (
        <DisputeModal
          holding={disputeModal}
          supportWhatsapp={supportWhatsapp}
          onClose={() => setDisputeModal(null)}
          onDone={() => { setDisputeModal(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

function WalletPill({ balance }: { balance: number }) {
  return (
    <Link
      to="/shop/wallet"
      className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 active:bg-emerald-100/40 transition"
    >
      <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
        <Wallet className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Store credit</p>
        <p className="text-lg font-bold text-slate-900 leading-tight">₹{balance.toFixed(2)}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-emerald-600 flex-shrink-0" />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
      <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <Package className="w-7 h-7 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-800">The shelf is empty.</h3>
      <p className="text-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
        Your steel cans will show up here once your first order arrives. Bring one back for the deposit, or refill it next time to skip the deposit.
      </p>
    </div>
  );
}

function HeldCard({
  holding,
  onRefill,
  onRefund,
  onSwap,
}: {
  holding: HeldHolding;
  onRefill: () => void;
  onRefund: () => void;
  onSwap: () => void;
}) {
  const isHeld = holding.status === 'held';
  const isPending = holding.status === 'pending_delivery';
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 text-sm truncate">
              {holding.container_type} · {holding.current_product_name}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Deposit ₹{holding.deposit_amount.toFixed(0)} · since {formatIstDate(holding.created_at)}
            </p>
            {holding.current_product_id !== holding.original_product_id && (
              <p className="text-xs text-slate-400 mt-0.5">
                originally {holding.original_product_name}
              </p>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border ${STATUS_COLORS[holding.status]}`}>
          {STATUS_LABELS[holding.status]}
        </span>
      </div>

      {isPending && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          This container will be marked as yours once the delivery agent verifies the OTP.
        </p>
      )}

      {isHeld && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            onClick={onRefill}
            className="flex flex-col items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition text-emerald-700 py-2 px-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-[11px] font-semibold">Refill</span>
          </button>
          <button
            onClick={onSwap}
            className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-slate-700 py-2 px-2"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span className="text-[11px] font-semibold">Swap product</span>
          </button>
          <button
            onClick={onRefund}
            className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition text-slate-700 py-2 px-2"
          >
            <X className="w-4 h-4" />
            <span className="text-[11px] font-semibold">Return</span>
          </button>
        </div>
      )}
    </li>
  );
}

function HistoryCard({
  holding,
  supportWhatsapp,
  onOpenDispute,
}: {
  holding: HistoryHolding;
  supportWhatsapp: string | null;
  onOpenDispute: () => void;
}) {
  const isForfeited = holding.status === 'forfeited';
  const deadlineMs = holding.dispute_deadline
    ? new Date(holding.dispute_deadline + 'Z').getTime()
    : null;
  const now = Date.now();
  const withinWindow = !!deadlineMs && deadlineMs > now;
  const disputeStatus = holding.damage_dispute_status;
  const alreadyOpen = isForfeited && disputeStatus === 'open';
  const canDispute = isForfeited && withinWindow && !disputeStatus;
  const wa = supportWhatsapp ? `https://wa.me/${supportWhatsapp}` : null;

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">
            {holding.container_type} · {holding.current_product_name}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {holding.refund_destination ? DEST_LABEL[holding.refund_destination] + ' · ' : ''}
            {formatIstDate(holding.resolved_at || holding.requested_at || holding.updated_at)}
          </p>
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border ${STATUS_COLORS[holding.status]}`}>
          {STATUS_LABELS[holding.status]}
        </span>
      </div>

      {isForfeited && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 leading-relaxed flex-1">
              <p className="font-semibold">Container marked damaged — deposit forfeited.</p>
              {disputeStatus === 'upheld' && (
                <p className="mt-1">Admin reviewed and upheld the forfeit.</p>
              )}
              {disputeStatus === 'rejected' && (
                <p className="mt-1">Admin sided with you — deposit will be refunded.</p>
              )}
              {alreadyOpen && (
                <p className="mt-1">Your dispute is under review. We&apos;ll notify you with the outcome.</p>
              )}
              {!disputeStatus && withinWindow && (
                <p className="mt-1">
                  You have until {formatIstDate(holding.dispute_deadline!)} to dispute this.
                </p>
              )}
              {!disputeStatus && !withinWindow && (
                <p className="mt-1">The 48-hour dispute window has closed.</p>
              )}
            </div>
          </div>
          {(canDispute || alreadyOpen) && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {canDispute && (
                <button
                  onClick={onOpenDispute}
                  className="py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                >
                  Dispute forfeit
                </button>
              )}
              {wa && (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`py-2 rounded-lg border border-emerald-300 bg-white text-emerald-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-emerald-50 ${canDispute ? '' : 'col-span-2'}`}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  WhatsApp support
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function RefundModal({
  holding,
  onClose,
  onDone,
}: {
  holding: HeldHolding;
  onClose: () => void;
  onDone: () => void;
}) {
  const [destination, setDestination] = useState<'manual_bank' | 'store_credit'>('manual_bank');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await consumerApi.post(`/consumer/containers/${holding.id}/request-refund`, {
        destination,
        notes: notes.trim() || undefined,
      });
      toast.success('Refund requested. Your linked dealer will pick it up.');
      onDone();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to request refund');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Return container" onClose={onClose}>
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 mb-4">
        <p className="font-medium">{holding.container_type} · {holding.current_product_name}</p>
        <p className="text-xs text-slate-500 mt-0.5">Deposit ₹{holding.deposit_amount.toFixed(0)}</p>
      </div>

      <p className="text-xs text-slate-600 mb-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        Your linked dealer will collect the container on their next visit. The refund is paid
        only after they confirm the container is undamaged.
      </p>

      <label className="block text-xs font-semibold text-slate-700 mb-2">Where should we refund?</label>
      <div className="space-y-2 mb-4">
        {(['manual_bank', 'store_credit'] as const).map(opt => (
          <label key={opt} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer ${
            destination === opt ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'
          }`}>
            <input
              type="radio"
              checked={destination === opt}
              onChange={() => setDestination(opt)}
              className="accent-emerald-600"
            />
            <span className="text-sm text-slate-800">
              {opt === 'manual_bank' ? 'Bank transfer (manual)' : 'Store credit'}
            </span>
          </label>
        ))}
      </div>

      <label className="block text-xs font-semibold text-slate-700 mb-1">Notes (optional)</label>
      <textarea
        rows={2}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        placeholder="Anything the dealer should know?"
      />

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? 'Requesting…' : 'Request refund'}
        </button>
      </div>
    </ModalShell>
  );
}

function SwapModal({
  holding,
  swappable,
  onClose,
  onDone,
}: {
  holding: HeldHolding;
  swappable: SwappableProduct[];
  onClose: () => void;
  onDone: () => void;
}) {
  const sameSize = swappable.filter(
    p => p.container_type === holding.container_type && p.id !== holding.current_product_id
  );
  const [targetId, setTargetId] = useState<number | null>(sameSize[0]?.id ?? null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    try {
      await consumerApi.post(`/consumer/containers/${holding.id}/swap`, {
        target_product_id: targetId,
      });
      toast.success('Container reassigned to your chosen product.');
      onDone();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Swap product" onClose={onClose}>
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 mb-4">
        <p className="font-medium">{holding.container_type} · {holding.current_product_name}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Only same-size ({holding.container_type}) products are eligible. The deposit stays the same.
        </p>
      </div>

      {sameSize.length === 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
          No other {holding.container_type} products are available to swap to right now.
        </div>
      ) : (
        <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
          {sameSize.map(p => (
            <label key={p.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer ${
              targetId === p.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'
            }`}>
              <input
                type="radio"
                checked={targetId === p.id}
                onChange={() => setTargetId(p.id)}
                className="accent-emerald-600"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                <p className="text-xs text-slate-500">{p.unit} · ₹{p.price.toFixed(0)}</p>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !targetId || sameSize.length === 0}
          className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? 'Swapping…' : 'Confirm swap'}
        </button>
      </div>
    </ModalShell>
  );
}

function DisputeModal({
  holding,
  supportWhatsapp,
  onClose,
  onDone,
}: {
  holding: HistoryHolding;
  supportWhatsapp: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const photoSrc = useMemo(() => {
    if (!holding.damage_photo_url) return null;
    if (/^https?:/i.test(holding.damage_photo_url)) return holding.damage_photo_url;
    const base = (consumerApi.defaults.baseURL || '').replace(/\/api\/?$/, '');
    return `${base}${holding.damage_photo_url.startsWith('/') ? '' : '/'}${holding.damage_photo_url}`;
  }, [holding.damage_photo_url]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await consumerApi.post(`/consumer/containers/${holding.id}/dispute`, {
        notes: notes.trim() || undefined,
      });
      toast.success('Dispute opened — our team will review and get back to you.');
      onDone();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to open dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Dispute damage claim" onClose={onClose}>
      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-4">
        <p className="font-medium">{holding.container_type} · {holding.current_product_name}</p>
        <p className="text-xs mt-0.5">
          Deposit ₹{holding.deposit_amount.toFixed(0)} · forfeited {formatIstDate(holding.resolved_at || holding.updated_at)}
        </p>
      </div>

      {photoSrc && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-700 mb-1.5">Driver&apos;s damage photo</p>
          <a href={photoSrc} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={photoSrc}
              alt="Damage proof"
              className="w-full max-h-56 object-contain rounded-lg border border-slate-200 bg-slate-50"
            />
          </a>
        </div>
      )}

      <label className="block text-xs font-semibold text-slate-700 mb-1">
        Tell us what happened (optional)
      </label>
      <textarea
        rows={4}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Add any context — was the container actually fine, was it photographed at the wrong angle, did the driver misclassify it?"
        className="w-full rounded-lg border border-slate-200 text-sm p-2 mb-3 focus:outline-none focus:ring-2 focus:ring-red-200"
      />

      {supportWhatsapp && (
        <a
          href={`https://wa.me/${supportWhatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 flex items-center justify-center gap-2 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100"
        >
          <MessageCircle className="w-4 h-4" />
          Also message us on WhatsApp ({supportWhatsapp})
        </a>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit dispute'}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
