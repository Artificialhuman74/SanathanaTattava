import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #f0fdf4 0%, #dcfce7 50%, #f0fdf4 100%)' }}>

      {/* Main content — centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">

        {/* Logo */}
        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-3xl overflow-hidden shadow-xl mb-6">
          <img
            src="/Gemini_Generated_Image_agra6kagra6kagra.png"
            alt="Sanathana Tattva"
            className="w-full h-full object-contain bg-white p-2"
          />
        </div>

        {/* Brand name + tagline */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 text-center mb-2">
          Sanathana Tattva
        </h1>
        <p className="text-slate-500 text-base text-center mb-10 max-w-xs leading-relaxed">
          Cold pressed oils crafted the traditional way, delivered to your doorstep.
        </p>

        {/* CTAs */}
        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => navigate('/shop/login')}
            className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-base transition-colors shadow-md"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/shop/register')}
            className="w-full py-3.5 bg-white hover:bg-slate-50 text-slate-800 font-bold rounded-2xl text-base border border-slate-200 transition-colors shadow-sm"
          >
            Create Account
          </button>
          <button
            onClick={() => navigate('/shop')}
            className="w-full py-3 text-slate-400 hover:text-slate-600 text-sm font-medium transition-colors"
          >
            Continue as Guest →
          </button>
        </div>
      </div>

      {/* Footer — subtle trader/admin links */}
      <footer className="py-5 px-6 text-center">
        <p className="text-slate-300 text-xs mb-2">
          &copy; {new Date().getFullYear()} Sanathana Tattva
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-slate-300">
          <button
            onClick={() => navigate('/login')}
            className="hover:text-slate-500 transition-colors flex items-center gap-1"
          >
            <Lock size={9} /> Trader Portal
          </button>
          <span>·</span>
          <button
            onClick={() => navigate('/login')}
            className="hover:text-slate-500 transition-colors flex items-center gap-1"
          >
            <Lock size={9} /> Admin
          </button>
        </div>
      </footer>
    </div>
  );
}
