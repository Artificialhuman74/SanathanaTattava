import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { ArrowLeft, User, Mail, Phone, Lock, Eye, EyeOff } from 'lucide-react';

export default function ConsumerAccount() {
  const { consumer, refreshConsumer } = useAuth();
  const navigate = useNavigate();

  const [name,    setName]    = useState(consumer?.name    || '');
  const [phone,   setPhone]   = useState(consumer?.phone   || '');
  const [saving,  setSaving]  = useState(false);

  const [oldPw,   setOldPw]   = useState('');
  const [newPw,   setNewPw]   = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  if (!consumer) {
    navigate('/shop/login', { replace: true });
    return null;
  }

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await consumerApi.patch('/consumer/me', { name: name.trim(), phone: phone.trim() || null });
      await refreshConsumer();
      toast.success('Details updated');
    } catch {
      toast.error('Failed to update details');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPw || !newPw) { toast.error('Fill in both password fields'); return; }
    if (newPw.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    setPwSaving(true);
    try {
      await consumerApi.post('/consumer/change-password', { old_password: oldPw, new_password: newPw });
      toast.success('Password changed');
      setOldPw(''); setNewPw('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-5">
      <button
        onClick={() => navigate('/shop/profile')}
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm mb-5 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Profile
      </button>

      <h1 className="text-xl font-bold text-gray-900 mb-5">My Account</h1>

      {/* ── Account Details ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Personal Details</p>
        <form onSubmit={handleSaveDetails} className="space-y-4">
          <div>
            <label className="form-label">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="form-input pl-10"
                placeholder="Your full name"
                required
              />
            </div>
          </div>
          <div>
            <label className="form-label">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="email"
                value={consumer.email || ''}
                className="form-input pl-10 opacity-60 cursor-not-allowed"
                disabled
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed</p>
          </div>
          <div>
            <label className="form-label">Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="form-input pl-10"
                placeholder="e.g. 9876543210"
              />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            {saving && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* ── Change Password ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Change Password</p>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="form-label">Current Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type={showOld ? 'text' : 'password'}
                value={oldPw}
                onChange={e => setOldPw(e.target.value)}
                className="form-input pl-10 pr-10"
                placeholder="Current password"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowOld(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type={showNew ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="form-input pl-10 pr-10"
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={pwSaving} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            {pwSaving && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            {pwSaving ? 'Updating…' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
