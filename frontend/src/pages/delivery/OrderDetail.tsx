import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Phone, MapPin, Package, Clock, CheckCircle2,
  Truck, Loader2, AlertCircle, X, User, ShoppingBag,
  XCircle,
} from 'lucide-react';

const DELIVERY_STATUS_COLORS: Record<string, string> = {
  pending:          'bg-amber-100 text-amber-700',
  accepted:         'bg-blue-100 text-blue-700',
  packed:           'bg-purple-100 text-purple-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered:        'bg-emerald-100 text-emerald-700',
  failed:           'bg-red-100 text-red-600',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending:          'Pending',
  accepted:         'Accepted',
  packed:           'Packed',
  out_for_delivery: 'Out for Delivery',
  delivered:        'Delivered',
  failed:           'Failed',
};

const STATUS_FLOW = ['pending', 'accepted', 'packed', 'out_for_delivery', 'delivered'];

export default function DeliveryOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showFailModal, setShowFailModal] = useState(false);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    try {
      const { data } = await api.get(`/delivery/orders/${id}`);
      setOrder(data.order);
    } catch (err: any) {
      setError('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      await api.post(`/delivery/orders/${id}/accept`);
      toast.success('Order accepted!');
      await fetchOrder();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to accept order');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePacked = async () => {
    setActionLoading(true);
    try {
      await api.post(`/delivery/orders/${id}/packed`);
      toast.success('Order marked as packed!');
      await fetchOrder();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to mark as packed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartDelivery = async () => {
    setActionLoading(true);
    try {
      await api.post(`/delivery/orders/${id}/start-delivery`);
      toast.success('Delivery started! OTP sent to customer.');
      await fetchOrder();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start delivery');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyOtp = async (otp: string) => {
    setActionLoading(true);
    try {
      await api.post(`/delivery/orders/${id}/verify-otp`, { otp });
      toast.success('Delivery completed successfully!');
      setShowOtpModal(false);
      await fetchOrder();
    } catch (err: any) {
      const msg = err.response?.data?.error || 'OTP verification failed';
      setError(msg);
      throw new Error(msg); // Re-throw so modal can show error
    } finally {
      setActionLoading(false);
    }
  };

  const handleFail = async (reason: string) => {
    setActionLoading(true);
    try {
      await api.post(`/delivery/orders/${id}/fail`, { reason });
      toast.error('Delivery marked as failed');
      setShowFailModal(false);
      await fetchOrder();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to report delivery failure');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
    </div>
  );

  if (!order) return (
    <div className="p-4">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-emerald-600 font-medium text-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        Order not found or not assigned to you.
      </div>
    </div>
  );

  const status = order.delivery_status || 'pending';
  const items = order.items || [];
  const timeline = order.timeline;

  return (
    <div className="animate-fade-in pb-6">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-slate-100">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-800">
              Order #{order.order_number}
            </p>
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${DELIVERY_STATUS_COLORS[status] || 'bg-slate-100 text-slate-600'}`}>
              {DELIVERY_STATUS_LABELS[status] || status}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Customer Info */}
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Customer</h3>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {order.consumer_name || 'Customer'}
                </p>
                {order.consumer_phone && (
                  <a
                    href={`tel:${order.consumer_phone}`}
                    className="text-xs text-emerald-600 font-medium flex items-center gap-1 mt-1"
                  >
                    <Phone className="w-3 h-3" />
                    {order.consumer_phone}
                  </a>
                )}
              </div>
            </div>
            {order.consumer_phone && (
              <a
                href={`tel:${order.consumer_phone}`}
                className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0"
              >
                <Phone className="w-4 h-4 text-white" />
              </a>
            )}
          </div>
          {order.delivery_address && (
            <div className="flex items-start gap-2 mt-3 pt-3 border-t border-slate-50">
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-600">{order.delivery_address}</p>
                {order.pincode && <p className="text-xs text-slate-400 mt-0.5">PIN: {order.pincode}</p>}
              </div>
            </div>
          )}
          {order.delivery_distance_km && (
            <div className="flex items-center gap-1.5 mt-2 ml-6">
              <Truck className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs text-slate-500">{parseFloat(order.delivery_distance_km).toFixed(1)} km away</p>
            </div>
          )}
        </div>

        {/* Order Items */}
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Order Items ({items.length})
          </h3>
          {items.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No item details available</p>
          ) : (
            <div className="space-y-3">
              {items.map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <ShoppingBag className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.product_name || 'Product'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Qty: {item.quantity} × ₹{parseFloat(item.price || 0).toFixed(2)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    ₹{parseFloat(item.total || 0).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-600">Total</p>
            <p className="text-base font-bold text-slate-800">₹{parseFloat(order.total_amount || 0).toFixed(2)}</p>
          </div>
        </div>

        {/* Delivery Progress */}
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Delivery Progress</h3>
          <div className="flex items-center gap-1">
            {STATUS_FLOW.map((s, i) => {
              const currentIdx = STATUS_FLOW.indexOf(status);
              const isCompleted = i <= currentIdx;
              const isCurrent = s === status;
              return (
                <React.Fragment key={s}>
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold ${
                    isCompleted
                      ? isCurrent ? 'bg-emerald-600 text-white' : 'bg-emerald-400 text-white'
                      : 'bg-slate-200 text-slate-400'
                  }`}>
                    {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : (i + 1)}
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div className={`flex-1 h-0.5 ${i < currentIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            {STATUS_FLOW.map(s => (
              <span key={s} className="text-[8px] text-slate-400 text-center" style={{ width: '20%' }}>
                {DELIVERY_STATUS_LABELS[s]}
              </span>
            ))}
          </div>

          {/* Timeline with actual timestamps */}
          {timeline && (
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
              {timeline.created_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Order Created</span>
                  <span className="text-slate-400">{new Date(timeline.created_at).toLocaleString('en-IN')}</span>
                </div>
              )}
              {timeline.delivery_accepted_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-blue-600 font-medium">Accepted</span>
                  <span className="text-slate-400">{new Date(timeline.delivery_accepted_at).toLocaleString('en-IN')}</span>
                </div>
              )}
              {timeline.delivery_packed_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-purple-600 font-medium">Packed</span>
                  <span className="text-slate-400">{new Date(timeline.delivery_packed_at).toLocaleString('en-IN')}</span>
                </div>
              )}
              {timeline.delivery_started_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-orange-600 font-medium">Out for Delivery</span>
                  <span className="text-slate-400">{new Date(timeline.delivery_started_at).toLocaleString('en-IN')}</span>
                </div>
              )}
              {timeline.delivery_verified_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-600 font-medium">Delivered</span>
                  <span className="text-slate-400">{new Date(timeline.delivery_verified_at).toLocaleString('en-IN')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {status === 'pending' && (
          <button
            onClick={handleAccept}
            disabled={actionLoading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] text-base"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Accept Order
          </button>
        )}

        {status === 'accepted' && (
          <button
            onClick={handlePacked}
            disabled={actionLoading}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] text-base"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Package className="w-5 h-5" />}
            Mark as Packed
          </button>
        )}

        {status === 'packed' && (
          <button
            onClick={handleStartDelivery}
            disabled={actionLoading}
            className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] text-base"
          >
            {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5" />}
            Start Delivery
          </button>
        )}

        {status === 'out_for_delivery' && (
          <div className="space-y-3">
            <button
              onClick={() => setShowOtpModal(true)}
              disabled={actionLoading}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] text-base"
            >
              Enter OTP to Complete Delivery
            </button>
            <button
              onClick={() => setShowFailModal(true)}
              disabled={actionLoading}
              className="w-full py-3 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] text-sm"
            >
              <XCircle className="w-4 h-4" />
              Report Delivery Failed
            </button>
          </div>
        )}

        {status === 'delivered' && (
          <div className="w-full py-4 bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold rounded-xl flex items-center justify-center gap-2 text-base">
            <CheckCircle2 className="w-5 h-5" />
            Delivered Successfully
            {order.delivery_verified_at && (
              <span className="text-sm font-normal text-emerald-600 ml-1">
                at {new Date(order.delivery_verified_at).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        )}

        {status === 'failed' && (
          <div className="w-full py-4 bg-red-50 border border-red-200 text-red-700 font-bold rounded-xl text-center text-base">
            <div className="flex items-center justify-center gap-2">
              <XCircle className="w-5 h-5" />
              Delivery Failed
            </div>
            {order.delivery_failed_reason && (
              <p className="text-sm font-normal text-red-600 mt-1">
                Reason: {order.delivery_failed_reason}
              </p>
            )}
          </div>
        )}
      </div>

      {/* OTP Modal */}
      {showOtpModal && (
        <OtpModal
          onClose={() => setShowOtpModal(false)}
          onVerify={handleVerifyOtp}
          loading={actionLoading}
        />
      )}

      {/* Failure Reason Modal */}
      {showFailModal && (
        <FailModal
          onClose={() => setShowFailModal(false)}
          onSubmit={handleFail}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ── OTP Verification Modal ────────────────────────────────────────────── */

function OtpModal({
  onClose,
  onVerify,
  loading,
}: {
  onClose: () => void;
  onVerify: (otp: string) => Promise<void>;
  loading: boolean;
}) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError('');
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      const newDigits = [...digits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pasted[i] || '';
      }
      setDigits(newDigits);
      const focusIdx = Math.min(pasted.length, 5);
      inputRefs.current[focusIdx]?.focus();
    }
  };

  const handleSubmit = async () => {
    const otp = digits.join('');
    if (otp.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    try {
      await onVerify(otp);
    } catch (err: any) {
      setError(err.message || 'Incorrect OTP. Please try again.');
    }
  };

  const otp = digits.join('');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-slate-800">Verify Delivery OTP</h3>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-6">
          Enter the 6-digit OTP provided by the customer to complete this delivery.
        </p>

        <div className="flex gap-2 justify-center mb-4" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              className={`w-12 h-14 text-center text-xl font-bold rounded-xl border-2 transition-colors focus:outline-none ${
                error
                  ? 'border-red-300 focus:border-red-500'
                  : digit
                    ? 'border-emerald-300 focus:border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 focus:border-emerald-500'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center mb-4">{error}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || otp.length !== 6}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify & Complete Delivery'
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Failure Reason Modal ────────────────────────────────────────────── */

function FailModal({
  onClose,
  onSubmit,
  loading,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  const reasons = [
    'Customer not available',
    'Wrong address',
    'Customer refused delivery',
    'Unable to reach location',
    'Other',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">Report Delivery Failure</h3>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-4">Select or describe why the delivery failed:</p>

        <div className="space-y-2 mb-4">
          {reasons.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                reason === r
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {reason === 'Other' && (
          <textarea
            placeholder="Describe the reason..."
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm mb-4 resize-none focus:outline-none focus:border-red-400"
            rows={3}
            onChange={e => setReason(e.target.value || 'Other')}
          />
        )}

        <button
          onClick={() => reason && onSubmit(reason)}
          disabled={loading || !reason}
          className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          Confirm Delivery Failed
        </button>
      </div>
    </div>
  );
}
