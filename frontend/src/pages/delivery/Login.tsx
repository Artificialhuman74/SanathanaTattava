import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Mail, Lock, AlertCircle, Loader2 } from 'lucide-react';

export default function DeliveryLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // After login, check from localStorage since state update is async
      const stored = localStorage.getItem('user');
      const user = stored ? JSON.parse(stored) : null;

      if (!user || user.role !== 'trader') {
        // Not a trader — logout and show error
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setError('This account is not authorized as a delivery partner. Please contact admin.');
        setLoading(false);
        return;
      }

      navigate('/delivery/dashboard', { replace: true });
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Login failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1f10] to-[#166534] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="text-center mb-8">
          <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-16 w-16 object-contain rounded-2xl mx-auto mb-4" alt="Sanathana Tattva" />
          <h1 className="text-2xl font-bold text-white">Sanathana Tattva</h1>
          <p className="text-green-200 text-sm mt-1">Delivery Partner Sign In</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="Enter your password"
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p className="text-center text-green-200 text-xs mt-6">
          Only authorized delivery partners can sign in.
        </p>
      </div>
    </div>
  );
}
