import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';
import { useSocket } from '../../contexts/SocketContext';
import {
  RotateCcw, Loader2, AlertCircle, MapPin, Phone, CheckCircle2, XCircle,
  Camera, Upload, IndianRupee, Wallet, Building2, ShieldAlert,
} from 'lucide-react';

type Destination = 'manual_bank' | 'store_credit' | 'manual_upi';

type Pickup = {
  id: number;
  invoice_id: number;
  container_type: string;
  deposit_amount: number;
  refund_destination: Destination;
  requested_at: string;
  notes: string | null;
  consumer_id: number;
  consumer_name: string;
  consumer_phone: string | null;
  consumer_address: string | null;
  current_product_name: string;
  original_product_name: string;
};

type ModalState =
  | { kind: 'refund'; pickup: Pickup }
  | { kind: 'forfeit'; pickup: Pickup };

export default function ContainerPickups() {
  const { on, off } = useSocket();
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [destination, setDestination] = useState<Destination>('manual_upi');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/delivery/container-pickups');
      setPickups(data.pickups || []);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load pickups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /* Live updates: when a new refund is requested or another driver resolves
   * a pickup, refresh the list so the agent doesn't drive to a stale stop. */
  useEffect(() => {
    const onUpdate = () => load();
    on('container_holding_update', onUpdate);
    on('container_refund_requested', onUpdate);
    return () => {
      off('container_holding_update', onUpdate);
      off('container_refund_requested', onUpdate);
    };
  }, [on, off]);

  const openRefund = (p: Pickup) => {
    setModal({ kind: 'refund', pickup: p });
    setDestination(p.refund_destination === 'store_credit' ? 'store_credit' : 'manual_upi');
    setNotes('');
    setPhoto(null);
  };

  const openForfeit = (p: Pickup) => {
    setModal({ kind: 'forfeit', pickup: p });
    setNotes('');
    setPhoto(null);
  };

  const submit = async () => {
    if (!modal) return;
    const outcome = modal.kind === 'refund' ? 'refunded' : 'forfeited';

    /* Hard guard: UPI refunds need a proof screenshot — admin verifies it
     * before reimbursing the driver out-of-band. Without the photo there
     * is no auditable trail. */
    if (modal.kind === 'refund' && destination === 'manual_upi' && !photo) {
      alert('Upload the UPI payment screenshot before confirming.');
      return;
    }

    setResolving(modal.pickup.id);
    try {
      const fd = new FormData();
      fd.append('outcome', outcome);
      if (modal.kind === 'refund') fd.append('destination', destination);
      if (notes) fd.append('notes', notes);
      if (photo) fd.append('photo', photo);

      await api.post(`/delivery/container-pickups/${modal.pickup.id}/resolve`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setModal(null);
      setNotes('');
      setPhoto(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to resolve pickup');
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw className="w-5 h-5 text-emerald-700" />
        <h1 className="text-lg font-bold text-slate-800">Container Pickups</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {pickups.length === 0 ? (
        <div className="bg-[#fffbf2] rounded-xl border border-[#e8dcc8] p-8 text-center">
          <RotateCcw className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">No pickup tasks right now</p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
            When a consumer asks to return a steel can (for a deposit refund or store credit), it'll appear here as a standalone pickup. Same loop as a refill swap, except you don't hand anything over: just collect the empty.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pickups.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.consumer_name}</p>
                  <p className="text-xs text-slate-500">Holding #{p.id} · {p.container_type}</p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                    p.refund_destination === 'store_credit'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {p.refund_destination === 'store_credit' ? 'Consumer asked: Store credit' : 'Consumer asked: Bank refund'}
                </span>
              </div>

              <div className="text-xs text-slate-600 space-y-1 mb-3">
                <p>Product: <span className="text-slate-800">{p.current_product_name}</span></p>
                <p>Deposit: <span className="text-slate-800 font-semibold">₹{Number(p.deposit_amount).toFixed(2)}</span></p>
                {p.consumer_phone && (
                  <a href={`tel:${p.consumer_phone}`} className="flex items-center gap-1 text-emerald-700">
                    <Phone className="w-3 h-3" /> {p.consumer_phone}
                  </a>
                )}
                {p.consumer_address && (
                  <p className="flex items-start gap-1">
                    <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{p.consumer_address}</span>
                  </p>
                )}
                {p.notes && (
                  <p className="mt-1 p-2 bg-slate-50 rounded text-slate-700 italic">"{p.notes}"</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => openRefund(p)}
                  disabled={resolving === p.id}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" /> Refund
                </button>
                <button
                  onClick={() => openForfeit(p)}
                  disabled={resolving === p.id}
                  className="flex-1 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-sm font-semibold rounded-lg flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Damaged
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-800 mb-1">
              {modal.kind === 'refund' ? 'Confirm refund' : 'Mark as damaged'}
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              {modal.pickup.consumer_name} · ₹{Number(modal.pickup.deposit_amount).toFixed(2)}
            </p>

            {modal.kind === 'refund' && (
              <>
                <p className="text-xs font-semibold text-slate-700 mb-2">How is the refund being paid?</p>
                <div className="space-y-2 mb-3">
                  <DestinationOption
                    icon={<IndianRupee className="w-4 h-4" />}
                    label="UPI from my phone"
                    sub="Pay now, upload screenshot. Admin reimburses you."
                    active={destination === 'manual_upi'}
                    onClick={() => setDestination('manual_upi')}
                  />
                  <DestinationOption
                    icon={<Building2 className="w-4 h-4" />}
                    label="Bank transfer (admin handles)"
                    sub="Mark as pending; admin wires the deposit later."
                    active={destination === 'manual_bank'}
                    onClick={() => setDestination('manual_bank')}
                  />
                  <DestinationOption
                    icon={<Wallet className="w-4 h-4" />}
                    label="Store credit"
                    sub="Credit lands in their wallet instantly."
                    active={destination === 'store_credit'}
                    onClick={() => setDestination('store_credit')}
                  />
                </div>

                {destination === 'manual_upi' && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-slate-700 mb-1">UPI payment proof <span className="text-red-500">*</span></p>
                    <PhotoPicker
                      photo={photo}
                      onPick={setPhoto}
                      hint="Screenshot of the successful UPI transfer"
                      inputRef={fileRef}
                    />
                  </div>
                )}
              </>
            )}

            {modal.kind === 'forfeit' && (
              <>
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      Forfeit means the consumer loses their ₹{Number(modal.pickup.deposit_amount).toFixed(2)} deposit.
                      They get a <strong>48-hour window</strong> to dispute. Upload a clear photo of the damage so admin can defend the call.
                    </div>
                  </div>
                </div>
                <div className="mb-3">
                  <p className="text-xs font-semibold text-slate-700 mb-1">Damage photo</p>
                  <PhotoPicker
                    photo={photo}
                    onPick={setPhoto}
                    hint="Show the crack, dent, leak, or missing part"
                    inputRef={fileRef}
                  />
                </div>
              </>
            )}

            <p className="text-xs font-semibold text-slate-700 mb-1">Notes</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={modal.kind === 'forfeit'
                ? 'e.g. cracked at the base, missing lid'
                : 'Optional context for the admin'}
              className="w-full border border-slate-200 rounded-lg p-2 text-sm mb-3 h-20"
            />

            <div className="flex gap-2">
              <button
                onClick={() => { setModal(null); setPhoto(null); }}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={resolving !== null}
                className={`flex-1 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1 ${
                  modal.kind === 'refund'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {resolving !== null && <Loader2 className="w-4 h-4 animate-spin" />}
                {resolving !== null ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DestinationOption({ icon, label, sub, active, onClick }: {
  icon: React.ReactNode; label: string; sub: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2 p-2 rounded-lg border text-left transition ${
        active
          ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-100'
          : 'bg-white border-slate-200 hover:border-slate-300'
      }`}
    >
      <span className={`mt-0.5 ${active ? 'text-emerald-700' : 'text-slate-500'}`}>{icon}</span>
      <span>
        <span className={`block text-sm font-semibold ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{label}</span>
        <span className="block text-[11px] text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function PhotoPicker({ photo, onPick, hint, inputRef }: {
  photo: File | null;
  onPick: (f: File | null) => void;
  hint: string;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => onPick(e.target.files?.[0] || null)}
      />
      {preview ? (
        <div className="relative">
          <img src={preview} alt="preview" className="w-full max-h-48 object-cover rounded-lg border border-slate-200" />
          <button
            type="button"
            onClick={() => onPick(null)}
            className="absolute top-1 right-1 bg-white/90 text-slate-700 rounded-full p-1 shadow"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 text-xs hover:border-emerald-400 hover:text-emerald-600"
        >
          <Camera className="w-4 h-4" />
          <span>Tap to take a photo or upload</span>
        </button>
      )}
      <p className="text-[10px] text-slate-400 mt-1">{hint}</p>
    </div>
  );
}
