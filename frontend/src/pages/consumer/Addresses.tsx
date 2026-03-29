import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  MapPin, Plus, Pencil, Trash2, Star, Home, Briefcase,
  X, Check, AlertCircle, Navigation, Loader2, RefreshCw,
} from 'lucide-react';

interface Address {
  id: number;
  consumer_id: number;
  label: string;
  name: string;
  phone: string;
  address: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  h3_index: string | null;
  is_default: number;
  created_at: string;
}

const LABEL_ICONS: Record<string, React.ReactNode> = {
  Home:  <Home size={14} />,
  Work:  <Briefcase size={14} />,
  Other: <MapPin size={14} />,
};

const labelIcon = (label: string) => LABEL_ICONS[label] ?? <MapPin size={14} />;

const emptyForm = { label: 'Home', name: '', phone: '', address: '', pincode: '' };

export default function Addresses() {
  const { consumer } = useAuth();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<Address | null>(null);
  const [form, setForm]           = useState({ ...emptyForm });
  const [saving, setSaving]       = useState(false);
  const [deleteId, setDeleteId]   = useState<number | null>(null);
  const [geocodingId, setGeocodingId] = useState<number | null>(null);

  useEffect(() => {
    if (!consumer) { navigate('/shop/login'); return; }
    fetchAddresses();
  }, [consumer]);

  const fetchAddresses = async () => {
    try {
      const { data } = await consumerApi.get('/consumer/addresses');
      setAddresses(data.addresses);
    } catch {
      toast.error('Failed to load addresses');
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, name: consumer?.name ?? '' });
    setShowForm(true);
  };

  const openEdit = (addr: Address) => {
    setEditing(addr);
    setForm({ label: addr.label, name: addr.name, phone: addr.phone, address: addr.address, pincode: addr.pincode });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditing(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.pincode.trim()) {
      toast.error('Please fill all fields');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { data } = await consumerApi.put(`/consumer/addresses/${editing.id}`, form);
        if (data.geocoded) {
          toast.success('Address updated & location mapped');
        } else {
          toast.success('Address updated (location could not be determined)');
        }
      } else {
        const makeDefault = addresses.length === 0;
        const { data } = await consumerApi.post('/consumer/addresses', { ...form, is_default: makeDefault });
        if (data.geocoded) {
          toast.success('Address added & location mapped');
        } else {
          toast.success('Address added (location will be mapped when possible)');
        }
      }
      await fetchAddresses();
      closeForm();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save address');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await consumerApi.delete(`/consumer/addresses/${id}`);
      toast.success('Address removed');
      setDeleteId(null);
      await fetchAddresses();
    } catch {
      toast.error('Failed to delete address');
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await consumerApi.put(`/consumer/addresses/${id}/default`);
      toast.success('Default address updated');
      await fetchAddresses();
    } catch {
      toast.error('Failed to update default');
    }
  };

  // Try auto-geocode from address text first; if that fails, offer GPS
  const handleGeocode = async (id: number) => {
    setGeocodingId(id);
    try {
      const { data } = await consumerApi.post(`/consumer/addresses/${id}/geocode`);
      if (data.geocoded) {
        toast.success('Location mapped successfully!');
        await fetchAddresses();
      }
    } catch (err: any) {
      // Text geocoding failed — try browser GPS as fallback
      const errorMsg = err.response?.data?.error || 'Auto-mapping failed';
      toast(errorMsg + ' Trying your GPS...', { icon: '📍' });
      await handleGeocodeWithGPS(id);
    } finally {
      setGeocodingId(null);
    }
  };

  // Use browser geolocation to map an address
  const handleGeocodeWithGPS = (id: number): Promise<void> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        toast.error('Geolocation not supported by your browser');
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { data } = await consumerApi.post(`/consumer/addresses/${id}/geocode`, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            if (data.geocoded) {
              toast.success('Location mapped using your GPS!');
              await fetchAddresses();
            }
          } catch (e: any) {
            toast.error(e.response?.data?.error || 'GPS mapping failed');
          }
          resolve();
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            toast.error('Location permission denied. Allow location access and try again.');
          } else {
            toast.error('Could not get your location. Please try again.');
          }
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  };

  // Directly use GPS for an address
  const handleUseMyLocation = async (id: number) => {
    setGeocodingId(id);
    await handleGeocodeWithGPS(id);
    setGeocodingId(null);
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">Loading addresses…</div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Saved Addresses</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage delivery addresses for faster checkout</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} />
          Add Address
        </button>
      </div>

      {/* Address cards */}
      {addresses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <MapPin size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium">No saved addresses yet</p>
          <p className="text-slate-400 text-sm mt-1 mb-5">Add an address to speed up checkout</p>
          <button onClick={openNew} className="btn-primary px-6 py-2">
            <Plus size={16} className="inline mr-1.5" />
            Add your first address
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className={`bg-white rounded-2xl border shadow-sm p-5 transition-colors ${
                addr.is_default ? 'border-brand-200 ring-1 ring-brand-200' : 'border-slate-100'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* Label badge */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0 ${
                    addr.is_default
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}>
                    {labelIcon(addr.label)}
                    {addr.label}
                    {addr.is_default && <Star size={10} className="ml-0.5 fill-current" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">{addr.name}</p>
                    <p className="text-slate-500 text-sm">{addr.phone}</p>
                    <p className="text-slate-700 text-sm mt-1 leading-snug">{addr.address}</p>
                    <p className="text-slate-500 text-xs mt-0.5">PIN: {addr.pincode}</p>

                    {/* Geocoding status */}
                    {addr.latitude && addr.longitude ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                          <Navigation size={10} className="text-emerald-600" />
                          <span className="text-[10px] font-medium text-emerald-700">Location mapped</span>
                        </div>
                        {addr.h3_index && (
                          <span className="text-[10px] font-mono text-slate-400">{addr.h3_index}</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100">
                          <AlertCircle size={10} className="text-amber-500" />
                          <span className="text-[10px] font-medium text-amber-700">Location not mapped</span>
                        </div>
                        <button
                          onClick={() => handleGeocode(addr.id)}
                          disabled={geocodingId === addr.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-[10px] font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                          {geocodingId === addr.id ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <RefreshCw size={10} />
                          )}
                          {geocodingId === addr.id ? 'Mapping...' : 'Auto map'}
                        </button>
                        <button
                          onClick={() => handleUseMyLocation(addr.id)}
                          disabled={geocodingId === addr.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          <Navigation size={10} />
                          Use my location
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!addr.is_default && (
                    <button
                      onClick={() => handleSetDefault(addr.id)}
                      title="Set as default"
                      className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                    >
                      <Star size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(addr)}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setDeleteId(addr.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {addr.is_default && (
                <p className="text-xs text-brand-600 font-medium mt-2.5 flex items-center gap-1">
                  <Check size={12} />
                  Default delivery address
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">{editing ? 'Edit Address' : 'Add New Address'}</h2>
              <button onClick={closeForm} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Label */}
              <div>
                <label className="form-label">Label</label>
                <div className="flex gap-2">
                  {['Home', 'Work', 'Other'].map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, label: l }))}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        form.label === l
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {labelIcon(l)} {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input"
                  placeholder="Recipient name"
                  required
                />
              </div>

              {/* Phone */}
              <div>
                <label className="form-label">Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="form-input"
                  placeholder="+91 98765 43210"
                  required
                />
              </div>

              {/* Address */}
              <div>
                <label className="form-label">Street Address</label>
                <textarea
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="form-input resize-none"
                  rows={3}
                  placeholder="Flat / House no, Street, Area, City"
                  required
                />
              </div>

              {/* Pincode */}
              <div>
                <label className="form-label">PIN Code</label>
                <input
                  type="text"
                  value={form.pincode}
                  onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))}
                  className="form-input"
                  placeholder="400001"
                  maxLength={6}
                  required
                />
              </div>

              {/* Geocoding info */}
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-700 flex items-center gap-1.5">
                  <Navigation size={12} />
                  Your address will be automatically mapped for nearest dealer assignment when you save.
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeForm} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? 'Saving…' : editing ? 'Update Address' : 'Save Address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteId != null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <AlertCircle size={36} className="mx-auto text-red-500 mb-3" />
            <h3 className="font-bold text-slate-900 mb-1">Remove address?</h3>
            <p className="text-slate-500 text-sm mb-5">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
