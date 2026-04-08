import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  TrendingUp, Mail, Lock, Eye, EyeOff, User, Hash, Phone,
  ArrowLeft, ShoppingCart, CheckCircle2, AlertCircle, Tag,
} from 'lucide-react';

export default function ConsumerRegister() {
  const { consumerRegister } = useAuth();
  const navigate = useNavigate();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [refCode,  setRefCode]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  const [codeValid,  setCodeValid]  = useState<boolean | null>(null);
  const [dealerName, setDealerName] = useState('');

  useEffect(() => {
    const code = refCode.trim().toUpperCase();
    if (code.length < 5) { setCodeValid(null); setDealerName(''); return; }
    const t = setTimeout(() => {
      api.get(`/auth/consumer/validate-dealer/${code}`)
        .then(r => { setCodeValid(r.data.valid); setDealerName(r.data.dealerName || ''); })
        .catch(() => setCodeValid(false));
    }, 350);
    return () => clearTimeout(t);
  }, [refCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())  { toast.error('Please enter your name'); return; }
    if (!email.trim()) { toast.error('Please enter your email'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    if (refCode && codeValid === false) { toast.error('Invalid referral code'); return; }

    setLoading(true);
    try {
      await consumerRegister(name.trim(), email.trim(), password, refCode.trim() || undefined, phone.trim() || undefined);
      toast.success('Account created! Check your email to verify.');
      navigate('/shop/verify-pending', { state: { email } });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <Link to="/shop/login" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm">
            <ArrowLeft size={14} /> Back to Login
          </Link>
        </div>

        <div className="text-center mb-6">
          <Link to="/shop" className="inline-flex items-center gap-2 justify-center">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-extrabold text-slate-900">TradeHub</span>
          </Link>
          <p className="text-slate-500 mt-2 text-sm">Create your shopping account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Your Details</h2>

            <div>
              <label className="form-label">Full Name <span className="text-red-500">*</span></label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="form-input pl-10" placeholder="Your full name" autoFocus required />
              </div>
            </div>

            <div>
              <label className="form-label">Email Address <span className="text-red-500">*</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="form-input pl-10" placeholder="you@example.com" autoComplete="email" required />
              </div>
            </div>

            <div>
              <label className="form-label">Phone Number <span className="text-slate-400 font-normal text-xs">(optional, for delivery)</span></label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="form-input pl-10" placeholder="e.g. 9876543210" autoComplete="tel" />
              </div>
            </div>

            <div>
              <label className="form-label">Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="form-input pl-10 pr-10"
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Confirm Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className={`form-input pl-10 ${confirm && confirm !== password ? 'border-red-400' : ''}`}
                  placeholder="Repeat your password"
                  required
                />
              </div>
              {confirm && confirm !== password && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
            </div>

            <div>
              <label className="form-label flex items-center gap-1.5">
                <Hash size={13} /> Dealer Referral Code
                <span className="text-slate-400 font-normal text-xs">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={refCode}
                  onChange={e => setRefCode(e.target.value.toUpperCase())}
                  className={`form-input uppercase tracking-wider font-mono pr-8 ${
                    codeValid === true ? 'border-emerald-400' : codeValid === false ? 'border-red-400' : ''
                  }`}
                  placeholder="e.g. A0001"
                  maxLength={5}
                />
                {codeValid === true  && <CheckCircle2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />}
                {codeValid === false && <AlertCircle  size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400" />}
              </div>
              {codeValid === true && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                  <Tag size={10} /> Linked to dealer: <strong>{dealerName}</strong>
                </p>
              )}
              {codeValid === false && <p className="text-xs text-red-500 mt-1">Invalid referral code.</p>}
            </div>

            <button type="submit" disabled={loading || codeValid === false} className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 disabled:opacity-60">
              {loading && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-slate-100 text-center space-y-3">
            <p className="text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/shop/login" className="text-brand-600 font-semibold hover:text-brand-700">Login here</Link>
            </p>
            <Link to="/shop" className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-600">
              <ShoppingCart size={14} /> Continue as guest
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
