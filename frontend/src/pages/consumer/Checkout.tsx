import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { clearCart, loadCart, saveCart } from '../../services/cartStorage';
import {
  ArrowLeft, MapPin, Tag, CheckCircle2, Package, Home, Briefcase,
  PlusCircle, User, Phone, Star, Hash, ShoppingBag,
} from 'lucide-react';

interface CartItem {
  product: {
    id: number;
    name: string;
    price: number;
    unit: string;
    image_url: string;
  };
  quantity: number;
}

interface SavedAddress {
  id: number;
  label: string;
  name: string;
  phone: string;
  address: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  h3_index: string | null;
  is_default: number;
}

const LABEL_ICONS: Record<string, React.ReactNode> = {
  Home:  <Home size={13} />,
  Work:  <Briefcase size={13} />,
  Other: <MapPin size={13} />,
};
const labelIcon = (l: string) => LABEL_ICONS[l] ?? <MapPin size={13} />;

export default function Checkout() {
  const { consumer, refreshConsumer } = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();

  const navCart: CartItem[] = (location.state as any)?.cart || [];
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (navCart.length) return navCart;
    return loadCart<CartItem['product']>().map(i => ({ product: i.product, quantity: i.quantity }));
  });

  const [discountPct,        setDiscountPct]        = useState(0);
  const [savedAddresses,     setSavedAddresses]     = useState<SavedAddress[]>([]);
  const [selectedAddressId,  setSelectedAddressId]  = useState<number | null>(null);
  const [useNewAddress,      setUseNewAddress]      = useState(false);
  const [newAddr,            setNewAddr]            = useState({ label: 'Home', name: '', phone: '', address: '', pincode: '' });
  const [saveNewAddr,        setSaveNewAddr]        = useState(true);   // default ON
  const [makeDefaultAddr,    setMakeDefaultAddr]    = useState(false);
  const [guestForm,          setGuestForm]          = useState({ name: '', phone: '', address: '', pincode: '' });

  /* Referral code — checkbox reveals input; skipped if already linked to account */
  const [hasCode,      setHasCode]      = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState<{
    orderNumber: string;
    message?: string;
    deliveryDealerName?: string;
    deliveryDistanceKm?: number;
    deliveryMethod?: string;
  } | null>(null);

  /* Guard: if someone lands here with an empty cart, send them back */
  useEffect(() => {
    if (cart.length === 0) navigate('/shop', { replace: true });
  }, [cart.length, navigate]);

  // Keep checkout cart in persistent storage as source of truth.
  useEffect(() => {
    if (navCart.length) {
      saveCart(navCart);
      return;
    }
    if (cart.length) {
      saveCart(cart);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Fetch discount settings */
  useEffect(() => {
    api.get('/consumer/settings')
      .then(r => setDiscountPct(parseFloat(r.data.referral_discount_percent) || 0))
      .catch(() => {});
  }, []);

  /* Pre-fill from consumer account */
  useEffect(() => {
    if (consumer) {
      setNewAddr(a => ({ ...a, name: consumer.name || '', phone: consumer.phone || '' }));
    }
  }, [consumer]);

  /* Fetch saved addresses for logged-in consumers */
  useEffect(() => {
    if (!consumer) return;
    consumerApi.get('/consumer/addresses')
      .then(({ data }) => {
        const addrs: SavedAddress[] = data.addresses || [];
        setSavedAddresses(addrs);
        const def = addrs.find(a => a.is_default);
        if (def)              { setSelectedAddressId(def.id);      setUseNewAddress(false); }
        else if (addrs.length) { setSelectedAddressId(addrs[0].id); setUseNewAddress(false); }
        else                   { setUseNewAddress(true); }
      })
      .catch(() => setUseNewAddress(true));
  }, [consumer]);

  /* ── Calculations ──────────────────────────────────────────────────── */
  const cartTotal        = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const effectiveCode    = consumer?.referral_code_used || (hasCode ? referralCode : '');
  const hasReferral      = !!effectiveCode.trim();
  const effectiveDiscount= hasReferral ? discountPct : 0;
  const discountAmt      = parseFloat((cartTotal * effectiveDiscount / 100).toFixed(2));
  const finalTotal       = parseFloat((cartTotal - discountAmt).toFixed(2));

  /* ── Place order ───────────────────────────────────────────────────── */
  const placeOrder = async () => {
    if (cart.length === 0) return;
    const items = cart.map(i => ({ product_id: i.product.id, quantity: i.quantity }));
    let payload: any = { items, referral_code: effectiveCode.trim() || undefined };

    if (consumer) {
      if (useNewAddress || savedAddresses.length === 0) {
        if (!newAddr.address.trim() || !newAddr.pincode.trim()) {
          toast.error('Please enter a delivery address and PIN code'); return;
        }
        payload = {
          ...payload,
          delivery_address:     newAddr.address.trim(),
          pincode:              newAddr.pincode.trim(),
          delivery_name:        newAddr.name.trim(),
          delivery_phone:       newAddr.phone.trim(),
          save_address:         saveNewAddr,
          make_default_address: saveNewAddr && makeDefaultAddr,
          address_label:        newAddr.label,
        };
      } else {
        if (!selectedAddressId) { toast.error('Please select a delivery address'); return; }
        payload = { ...payload, address_id: selectedAddressId };
      }
    } else {
      const { name, phone, address, pincode } = guestForm;
      if (!name.trim() || !phone.trim() || !address.trim() || !pincode.trim()) {
        toast.error('Please fill in all delivery details'); return;
      }
      payload = {
        ...payload,
        delivery_address: address.trim(),
        pincode:          pincode.trim(),
        delivery_name:    name.trim(),
        delivery_phone:   phone.trim(),
      };
    }

    setPlacing(true);
    try {
      const res  = consumer
        ? await consumerApi.post('/consumer/orders', payload)
        : await api.post('/consumer/orders', payload);
      const data = res.data;

      if (!consumer) {
        // Guest: no payment, show success immediately
        clearCart();
        setCart([]);
        setSuccess({
          orderNumber:        data.order_number || data.order?.order_number,
          message:            data.confirmation?.message,
          deliveryDealerName: data.delivery?.dealerName,
          deliveryDistanceKm: data.delivery?.distanceKm,
          deliveryMethod:     data.delivery?.method,
        });
        setPlacing(false);
        return;
      }

      // Logged-in consumer: initiate Razorpay payment
      const payRes = await consumerApi.post('/payments/create-order', {
        consumer_order_id: data.order.id,
      });
      const { razorpay_order_id, amount, currency, key_id } = payRes.data;

      setPlacing(false); // Razorpay modal handles UX from here

      const rzp = new window.Razorpay({
        key:         key_id,
        amount,
        currency,
        name:        'Sanathana Tattva',
        description: `Order ${data.order.order_number}`,
        image:       '/Gemini_Generated_Image_agra6kagra6kagra.png',
        order_id:    razorpay_order_id,
        handler: async (response: any) => {
          setPlacing(true);
          try {
            await consumerApi.post('/payments/verify', {
              razorpay_order_id:  response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              consumer_order_id:  data.order.id,
            });
            refreshConsumer();
            clearCart();
            setCart([]);
            setSuccess({
              orderNumber:        data.order.order_number,
              message:            data.confirmation?.message,
              deliveryDealerName: data.delivery?.dealerName,
              deliveryDistanceKm: data.delivery?.distanceKm,
              deliveryMethod:     data.delivery?.method,
            });
          } catch {
            toast.error('Payment verification failed. Please contact support.');
          } finally {
            setPlacing(false);
          }
        },
        prefill: {
          name:    consumer?.name    || '',
          contact: consumer?.phone   || '',
          email:   consumer?.email   || '',
        },
        theme: { color: '#16a34a' },
        modal: {
          ondismiss: () => {
            toast('Payment cancelled. Complete payment from My Orders anytime.', { icon: 'ℹ️' });
          },
        },
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to place order');
      setPlacing(false);
    }
  };

  /* ── Success screen ────────────────────────────────────────────────── */
  if (success) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={44} className="text-emerald-600" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Order Confirmed!</h1>
        <p className="text-slate-500 mb-3">Your order has been placed successfully.</p>
        <p className="text-brand-600 font-mono font-bold text-xl mb-2">{success.orderNumber}</p>
        {success.message && (
          <p className="text-slate-600 text-sm mb-4 px-4">{success.message}</p>
        )}
        {success.deliveryDealerName && (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 mb-8">
            <MapPin size={14} />
            <span>
              Delivery by <strong>{success.deliveryDealerName}</strong>
              {success.deliveryDistanceKm != null && (
                <span className="text-emerald-600"> ({success.deliveryDistanceKm.toFixed(1)} km away)</span>
              )}
            </span>
          </div>
        )}
        {!success.deliveryDealerName && !success.message && <div className="mb-8" />}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {consumer && (
            <Link to="/shop/orders" className="btn-primary py-3 px-8 flex items-center gap-2 justify-center">
              <ShoppingBag size={16} /> My Orders
            </Link>
          )}
          <Link to="/shop" className="btn-ghost border border-slate-200 py-3 px-8">
            Continue Shopping
          </Link>
        </div>
      </div>
    );
  }

  /* ── Main checkout ─────────────────────────────────────────────────── */
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> Back to cart
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-6">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

        {/* ── Left column: Delivery + Referral ──────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Guest prompt */}
          {!consumer && (
            <div className="p-4 bg-brand-50 rounded-xl border border-brand-100 text-sm text-brand-800">
              <Link to="/shop/login" className="font-semibold hover:underline" state={{ from: '/shop/checkout' }}>
                Sign in
              </Link>{' '}
              for faster checkout and to save your addresses for next time.
            </div>
          )}

          {/* ── Delivery Address ──────────────────────────────────── */}
          <div className="card p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <MapPin size={16} className="text-brand-600" /> Delivery Address
              </h2>
              {consumer && (
                <Link to="/shop/addresses" className="text-xs text-brand-600 hover:underline font-medium">
                  Manage saved addresses
                </Link>
              )}
            </div>

            {/* Logged-in: saved address picker */}
            {consumer && (
              <div className="space-y-2">
                {savedAddresses.map(addr => (
                  <label
                    key={addr.id}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      !useNewAddress && selectedAddressId === addr.id
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={!useNewAddress && selectedAddressId === addr.id}
                      onChange={() => { setSelectedAddressId(addr.id); setUseNewAddress(false); }}
                      className="mt-0.5 accent-brand-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          !useNewAddress && selectedAddressId === addr.id
                            ? 'bg-brand-100 text-brand-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {labelIcon(addr.label)} {addr.label}
                        </span>
                        {addr.is_default === 1 && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <Star size={10} className="fill-current" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{addr.name} · {addr.phone}</p>
                      <p className="text-sm text-slate-600 leading-snug">{addr.address}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-slate-400">PIN: {addr.pincode}</p>
                        {addr.latitude && addr.longitude ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
                            <MapPin size={9} /> Mapped
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
                            <MapPin size={9} /> Not mapped
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}

                {/* Use new/different address */}
                <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  useNewAddress
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-dashed border-slate-300 hover:border-brand-300'
                }`}>
                  <input
                    type="radio"
                    name="address"
                    checked={useNewAddress}
                    onChange={() => { setUseNewAddress(true); setSelectedAddressId(null); }}
                    className="accent-brand-600"
                  />
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <PlusCircle size={15} className="text-brand-600" />
                    {savedAddresses.length ? 'Use a different address' : 'Add a delivery address'}
                  </span>
                </label>

                {/* New address form */}
                {useNewAddress && (
                  <div className="mt-2 space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    {/* Label picker */}
                    <div className="flex gap-2">
                      {['Home', 'Work', 'Other'].map(l => (
                        <button
                          key={l} type="button"
                          onClick={() => setNewAddr(a => ({ ...a, label: l }))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            newAddr.label === l
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {labelIcon(l)} {l}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                        <input
                          value={newAddr.name}
                          onChange={e => setNewAddr(a => ({ ...a, name: e.target.value }))}
                          className="form-input pl-9 text-sm" placeholder="Full name"
                        />
                      </div>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                        <input
                          value={newAddr.phone}
                          onChange={e => setNewAddr(a => ({ ...a, phone: e.target.value }))}
                          className="form-input pl-9 text-sm" placeholder="Phone number"
                        />
                      </div>
                    </div>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 text-slate-400 w-3.5 h-3.5" />
                      <textarea
                        value={newAddr.address}
                        onChange={e => setNewAddr(a => ({ ...a, address: e.target.value }))}
                        className="form-input pl-9 text-sm resize-none" rows={2}
                        placeholder="House/Flat, Street, Area, City"
                      />
                    </div>
                    <input
                      value={newAddr.pincode}
                      onChange={e => setNewAddr(a => ({ ...a, pincode: e.target.value }))}
                      className="form-input text-sm" placeholder="PIN Code" maxLength={6}
                    />
                    <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200 space-y-2.5">
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveNewAddr}
                          onChange={e => { setSaveNewAddr(e.target.checked); if (!e.target.checked) setMakeDefaultAddr(false); }}
                          className="w-4 h-4 rounded accent-brand-600 mt-0.5 flex-shrink-0"
                        />
                        <div>
                          <span className="text-sm text-slate-700 font-medium">Save this address to my profile</span>
                          <p className="text-xs text-slate-400 mt-0.5">You can reuse it in future checkouts</p>
                        </div>
                      </label>
                      {saveNewAddr && (
                        <label className="flex items-start gap-3 cursor-pointer select-none pt-2 border-t border-slate-100">
                          <input
                            type="checkbox"
                            checked={makeDefaultAddr}
                            onChange={e => setMakeDefaultAddr(e.target.checked)}
                            className="w-4 h-4 rounded accent-brand-600 mt-0.5 flex-shrink-0"
                          />
                          <div>
                            <span className="text-sm text-slate-600 font-medium">Set as my default address</span>
                            <p className="text-xs text-slate-400 mt-0.5">Auto-selected on your next order</p>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Guest: inline address form */}
            {!consumer && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Full Name <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input
                        type="text" value={guestForm.name}
                        onChange={e => setGuestForm(f => ({ ...f, name: e.target.value }))}
                        className="form-input pl-10" placeholder="Your full name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Phone <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input
                        type="tel" value={guestForm.phone}
                        onChange={e => setGuestForm(f => ({ ...f, phone: e.target.value }))}
                        className="form-input pl-10" placeholder="+91 98765 43210"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="form-label">Delivery Address <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 text-slate-400 w-4 h-4" />
                    <textarea
                      value={guestForm.address}
                      onChange={e => setGuestForm(f => ({ ...f, address: e.target.value }))}
                      className="form-input pl-10 resize-none" rows={2}
                      placeholder="House/Flat, Street, Area, City"
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">PIN Code <span className="text-red-500">*</span></label>
                  <input
                    type="text" value={guestForm.pincode}
                    onChange={e => setGuestForm(f => ({ ...f, pincode: e.target.value }))}
                    className="form-input" placeholder="400001" maxLength={6}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Referral Code ─────────────────────────────────────── */}
          <div className="card p-5 sm:p-6">
            <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-4">
              <Tag size={16} className="text-brand-600" /> Referral Discount
            </h2>

            {consumer?.referral_code_used ? (
              /* Already linked — show confirmation pill */
              <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Referral discount applied</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Code: <span className="font-mono font-bold">{consumer.referral_code_used}</span>
                    {discountPct > 0 && <span> · {discountPct}% off your order</span>}
                  </p>
                </div>
              </div>
            ) : (
              /* Checkbox → reveal input */
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasCode}
                    onChange={e => { setHasCode(e.target.checked); if (!e.target.checked) setReferralCode(''); }}
                    className="w-4 h-4 rounded accent-brand-600 flex-shrink-0"
                  />
                  <span className="text-sm font-medium text-slate-700">I have a dealer referral code</span>
                </label>

                {hasCode && (
                  <div className="pl-7 space-y-2">
                    <div className="relative max-w-xs">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input
                        type="text"
                        value={referralCode}
                        onChange={e => setReferralCode(e.target.value.toUpperCase())}
                        className="form-input pl-10 uppercase tracking-widest font-mono"
                        placeholder=""
                        maxLength={5}
                        autoFocus
                      />
                    </div>
                    {referralCode.length >= 4 && discountPct > 0 && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                        <Tag size={11} /> {discountPct}% discount will be applied at order confirmation.
                      </p>
                    )}
                    <p className="text-xs text-slate-400">
                      Enter your dealer's code to get {discountPct > 0 ? `${discountPct}%` : 'a'} discount on this order.
                    </p>
                  </div>
                )}

                {!hasCode && discountPct > 0 && (
                  <p className="text-xs text-slate-400 pl-7">
                    Check this if you have a dealer referral code to unlock {discountPct}% off.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Order Summary ────────────────────────────── */}
        <div className="lg:sticky lg:top-6">
          <div className="card p-5 sm:p-6">
            <h2 className="font-bold text-slate-900 mb-4">Order Summary</h2>

            <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
              {cart.map(({ product, quantity }) => (
                <div key={product.id} className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                    {product.image_url
                      ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                      : <Package size={14} className="text-slate-300 m-auto mt-3" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">{product.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">×{quantity} · ₹{product.price.toFixed(2)}/{product.unit}</p>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 flex-shrink-0">
                    ₹{(product.price * quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal ({cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>₹{cartTotal.toFixed(2)}</span>
              </div>
              {effectiveDiscount > 0 && (
                <div className="flex justify-between text-sm text-emerald-600 font-semibold">
                  <span className="flex items-center gap-1.5"><Tag size={11} />Referral discount ({effectiveDiscount}%)</span>
                  <span>−₹{discountAmt.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-extrabold text-lg pt-2 border-t border-slate-100 mt-2">
                <span>Total</span>
                <span className="text-brand-600">₹{finalTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={placeOrder}
              disabled={placing}
              className="btn-primary w-full py-4 mt-5 text-base font-bold flex items-center justify-center gap-2"
            >
              {placing && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />}
              {placing ? 'Processing…' : consumer ? `Pay ₹${finalTotal.toFixed(2)}` : `Place Order · ₹${finalTotal.toFixed(2)}`}
            </button>

            {!consumer && (
              <p className="text-xs text-center text-slate-400 mt-3">
                <Link to="/shop/login" className="text-brand-600 hover:underline font-medium">Sign in</Link>
                {' '}to save your address for future orders
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
