import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  User, Mail, Lock, Eye, EyeOff, Phone, MapPin, Hash,
  CheckCircle2, XCircle, ArrowLeft, Star, Users, Truck, Info,
} from 'lucide-react';

export default function Register() {
  const { register: doRegister } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    phone: '', address: '', pincode: '', referralCode: '',
  });
  const [willDeliver,   setWillDeliver]   = useState<boolean>(false);
  const [showPw,        setShowPw]        = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [refStatus,     setRefStatus]     = useState<null | { valid: boolean; name?: string }>(null);
  const [refChecking,   setRefChecking]   = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  // Validate referral code with debounce
  useEffect(() => {
    if (!form.referralCode.trim()) { setRefStatus(null); return; }
    const t = setTimeout(async () => {
      setRefChecking(true);
      try {
        const { data } = await api.get(`/auth/validate-referral/${form.referralCode.trim()}`);
        setRefStatus({ valid: data.valid, name: data.referrerName });
      } catch { setRefStatus({ valid: false }); }
      finally { setRefChecking(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [form.referralCode]);

  const isSubDealer = refStatus?.valid === true;
  const tier = isSubDealer ? 2 : 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) { toast.error('Please fill in all required fields'); return; }
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (form.referralCode && refStatus?.valid === false) { toast.error('Invalid referral code'); return; }

    setLoading(true);
    try {
      await doRegister({
        name:          form.name,
        email:         form.email,
        password:      form.password,
        phone:         form.phone   || undefined,
        address:       form.address || undefined,
        pincode:       form.pincode || undefined,
        referralCode:  form.referralCode.trim() || undefined,
        willDeliver,
      });
      toast.success('You\'re in. Welcome to the family.');
      navigate('/trader', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1f10] via-[#14532d] to-[#0d1f10] flex flex-col items-center justify-center p-4 py-10">
      <div className="absolute inset-0 hero-pattern" />

      <div className="relative w-full max-w-lg">
        <div className="text-center mb-8">
          <Link to="/login" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to Login
          </Link>
          <div className="flex items-center justify-center gap-3">
            <img src="/logo.webp" className="h-12 w-12 object-contain rounded-xl" alt="Sanathana Tattva" />
            <span className="text-2xl font-extrabold text-white leading-tight">Sanathana Tattva</span>
          </div>
          <p className="text-white/70 mt-2 text-sm" style={{ fontFamily: "'Georgia', 'Times New Roman', serif", fontStyle: 'italic' }}>
            Join the family that delivers our oils.
          </p>
        </div>

        {/* What you'll get — the activation lever moment.
            Three concrete promises so a kirana owner reading this on
            their phone knows what they're signing up for in 30 seconds. */}
        <div className="mb-5 p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Hash size={14} className="text-indigo-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Your referral code</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Earn on every order you bring in</p>
            </div>
            <div>
              <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Truck size={14} className="text-emerald-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Local delivery</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Orders routed to your area</p>
            </div>
            <div>
              <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-1.5">
                <Star size={14} className="text-amber-300" />
              </div>
              <p className="text-[11px] text-white/90 font-semibold leading-tight">Weekly payouts</p>
              <p className="text-[10px] text-white/50 mt-0.5 leading-tight">Direct to your bank, every Sunday</p>
            </div>
          </div>
        </div>

        {/* How it works — concise, family-voice explainer of the two
            tiers. Replaces the dev-explainerly original. */}
        <div className="mb-5 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm">
          <div className="flex items-start gap-2.5">
            <Info size={16} className="text-blue-300 mt-0.5 flex-shrink-0" />
            <div className="text-white/80 text-xs leading-relaxed">
              <p className="font-semibold text-white/95 mb-1">Two ways to join:</p>
              <p>
                <strong className="text-indigo-300">No code?</strong> You become a Tier 1 Partner and get a code of your own to bring in sub-partners.
                <br />
                <strong className="text-purple-300">Got a code from another partner?</strong> Enter it below to join under them as a Sub-Partner.
              </p>
            </div>
          </div>
        </div>

        {/* Tier Preview */}
        <div className={`flex gap-3 mb-6 p-4 rounded-2xl border transition-all ${
          isSubDealer ? 'bg-purple-500/10 border-purple-500/30' : 'bg-indigo-500/10 border-indigo-500/30'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isSubDealer ? 'bg-purple-500/20' : 'bg-indigo-500/20'}`}>
            {isSubDealer ? <Users size={20} className="text-purple-400" /> : <Star size={20} className="text-indigo-400" />}
          </div>
          <div>
            <p className={`font-bold text-sm ${isSubDealer ? 'text-purple-300' : 'text-indigo-300'}`}>
              {isSubDealer ? `Joining under ${refStatus?.name}` : 'You\'ll be a Tier 1 Partner'}
            </p>
            <p className="text-white/60 text-xs mt-0.5 leading-relaxed">
              {isSubDealer
                ? `${refStatus?.name?.split(' ')[0]} brought you in. You'll still get your own code and earn on every order you bring in.`
                : 'You get your own referral code to bring in sub-partners. You earn on their orders too.'
              }
            </p>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Full Name <span className="text-red-500">*</span></label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" value={form.name} onChange={set('name')} className="form-input pl-10" placeholder="Your full name" required />
                </div>
              </div>
              <div>
                <label className="form-label">Email <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="email" value={form.email} onChange={set('email')} className="form-input pl-10" placeholder="your@email.com" required />
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')} className="form-input pl-10 pr-10" placeholder="Min. 6 characters" required />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="form-label">Confirm Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type={showPw ? 'text' : 'password'} value={form.confirmPassword} onChange={set('confirmPassword')} className="form-input pl-10" placeholder="Repeat password" required />
                </div>
              </div>
            </div>

            {/* Phone & Pincode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="tel" value={form.phone} onChange={set('phone')} className="form-input pl-10" placeholder="+91 98765 43210" />
                </div>
              </div>
              <div>
                <label className="form-label">Pincode</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input type="text" value={form.pincode} onChange={set('pincode')} className="form-input pl-10" placeholder="400001" maxLength={6} />
                </div>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="form-label">Address</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 text-slate-400 w-4 h-4" />
                <input type="text" value={form.address} onChange={set('address')} className="form-input pl-10" placeholder="Street, City, State" />
              </div>
            </div>

            {/* Referral code */}
            <div>
              <label className="form-label flex items-center gap-2">
                <Hash size={14} />
                Referral Code
                <span className="text-slate-400 text-xs font-normal">(leave blank = Tier 1 Partner)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={form.referralCode}
                  onChange={set('referralCode')}
                  className={`form-input pr-10 uppercase tracking-wider font-mono ${
                    refStatus?.valid === true  ? 'border-emerald-400 focus:ring-emerald-400' :
                    refStatus?.valid === false ? 'border-red-400 focus:ring-red-400' : ''
                  }`}
                  placeholder=""
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {refChecking && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-600 block" />}
                  {!refChecking && refStatus?.valid === true  && <CheckCircle2 size={16} className="text-emerald-500" />}
                  {!refChecking && refStatus?.valid === false && <XCircle      size={16} className="text-red-500" />}
                </div>
              </div>
              {refStatus?.valid === true  && <p className="text-emerald-600 text-xs mt-1.5">Got it. {refStatus.name?.split(' ')[0]} brought you in.</p>}
              {refStatus?.valid === false && <p className="text-red-500 text-xs mt-1.5">That code isn't one of ours. Double-check with whoever shared it.</p>}
            </div>

            {/* Delivery commitment — softened tone, same legal weight.
                The dealer needs to know they're saying yes to handling
                last-mile deliveries; we just don't have to sound like a
                contract about it. */}
            <div className={`p-4 rounded-xl border-2 transition-all ${
              willDeliver ? 'border-emerald-400 bg-emerald-50' : 'border-[#e8dcc8] bg-parchment-100'
            }`}>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={willDeliver}
                  onChange={e => setWillDeliver(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-brand-600 flex-shrink-0"
                />
                <div>
                  <p className={`font-semibold text-sm ${willDeliver ? 'text-emerald-800' : 'text-slate-700'}`}>
                    Yes, I'll deliver to consumers in my area.
                  </p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Orders from your referral network come to you to pack and hand over. If you're a sub-partner, your parent partner may also route orders your way.
                  </p>
                </div>
              </label>
              {!willDeliver && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 ml-7 flex items-center gap-1.5">
                  <Truck size={12} className="flex-shrink-0" />
                  Tick the box above to finish signing up.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !willDeliver || (!!form.referralCode && refStatus?.valid === false)}
              className="btn-primary w-full py-3 text-base mt-2 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white flex-shrink-0" />}
              {loading ? 'Creating your account…' : (tier === 1 ? 'Join as a Tier 1 Partner' : `Join as a Sub-Partner`)}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="text-brand-600 font-semibold hover:text-brand-700">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
