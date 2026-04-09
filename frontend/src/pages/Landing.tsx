import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Leaf, Droplets, Heart, Zap, Shield, Users, ArrowRight, ChevronDown } from 'lucide-react';

const BENEFITS = [
  {
    icon: Leaf,
    title: 'Nutrients Fully Preserved',
    desc: 'Cold pressing never uses heat, so every vitamin, mineral, and antioxidant stays intact — exactly as nature intended.',
  },
  {
    icon: Droplets,
    title: 'Zero Chemicals',
    desc: 'No solvents, no bleaching, no deodorising. Just pure oil extracted the traditional way in a wooden ghani press.',
  },
  {
    icon: Heart,
    title: 'Heart & Gut Friendly',
    desc: 'Rich in Omega-3, Omega-6, and natural phytosterols that actively support cardiovascular and digestive health.',
  },
  {
    icon: Zap,
    title: 'Higher Smoke Point',
    desc: 'Unrefined cold pressed oils handle everyday cooking temperatures without breaking down into harmful compounds.',
  },
  {
    icon: Shield,
    title: 'Stronger Immunity',
    desc: 'Natural Vitamin E and polyphenols act as antioxidants, helping your body fight inflammation and oxidative stress.',
  },
  {
    icon: Users,
    title: 'Richer Flavour',
    desc: 'Cold pressed oils carry the full aroma and taste of the seed — a world apart from refined supermarket oils.',
  },
];

const TRADER_STEPS = [
  {
    num: '01',
    title: 'Apply as a Dealer',
    desc: 'Contact us to become an authorised Sanathana Tattva dealer. We verify you and create your account with a unique referral code.',
  },
  {
    num: '02',
    title: 'Share Your Code',
    desc: 'Give your referral code to customers in your area. When they register or order with your code, they are linked to you permanently.',
  },
  {
    num: '03',
    title: 'Earn Commission',
    desc: 'Every paid order from your customers earns you a commission automatically tracked in your dealer dashboard.',
  },
  {
    num: '04',
    title: 'Deliver Locally',
    desc: 'Deliver to nearby customers yourself or let the platform assign deliveries based on location — your choice.',
  },
];

export default function Landing() {
  const navigate  = useNavigate();
  const heroRef   = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // progress: 0 → 1 over first 400px of scroll
  const progress    = Math.min(scrollY / 400, 1);

  // Logo starts at 75vh tall, expands to 100vh
  const logoHeightVh = 75 + progress * 25;

  // Bottom corners round from 24px → 0 as it expands edge-to-edge
  const logoRadius   = 24 * Math.max(0, 1 - progress * 2);

  // Logo fades to a subtle background after 50% scroll
  const logoOpacity  = progress < 0.5 ? 1 : Math.max(0.13, 1 - (progress - 0.5) * 2 * 0.87);

  // Text below logo fades out in the first 35% of scroll
  const textOpacity  = Math.max(0, 1 - progress / 0.35);

  return (
    <div className="bg-white overflow-x-hidden">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div
        ref={heroRef}
        className="relative h-[180vh]"
        style={{ background: 'linear-gradient(160deg, #f0fdf4 0%, #dcfce7 60%, #f0fdf4 100%)' }}
      >
        {/* Sticky viewport — stays fixed while user scrolls through the 180vh block */}
        <div className="sticky top-0 h-screen overflow-hidden flex flex-col">

          {/* Logo — fills top 75% initially, expands to full screen on scroll */}
          <div
            style={{
              height:        `${logoHeightVh}vh`,
              flexShrink:    0,
              overflow:      'hidden',
              opacity:       logoOpacity,
              borderRadius:  `0 0 ${logoRadius}px ${logoRadius}px`,
            }}
          >
            <img
              src="/Gemini_Generated_Image_agra6kagra6kagra.png"
              alt="Sanathana Tattva"
              className="w-full h-full object-cover"
              style={{ objectPosition: 'center center' }}
            />
          </div>

          {/* Text — sits naturally below the logo in the remaining 25vh */}
          <div
            className="flex-1 flex flex-col items-center justify-center px-6 pb-4"
            style={{ opacity: textOpacity }}
          >
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-1 text-center">
              Sanathana Tattva
            </h1>
            <p className="text-slate-500 text-sm text-center max-w-xs mb-6">
              Cold pressed oils crafted the traditional way, delivered to your doorstep.
            </p>
            <div className="w-full max-w-xs space-y-2.5">
              <button
                onClick={() => navigate('/shop/login')}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-md"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate('/shop/register')}
                className="w-full py-3 bg-white hover:bg-slate-50 text-slate-800 font-bold rounded-2xl text-sm border border-slate-200 transition-colors shadow-sm"
              >
                Create Account
              </button>
              <button
                onClick={() => navigate('/shop')}
                className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors"
              >
                Continue as Guest →
              </button>
            </div>
          </div>

          {/* Scroll hint */}
          <div
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
            style={{ opacity: Math.max(0, 1 - progress * 6) }}
          >
            <span className="text-xs text-slate-400">Scroll to explore</span>
            <ChevronDown size={14} className="text-slate-300 animate-bounce" />
          </div>
        </div>
      </div>

      {/* ── Benefits of Cold Pressed Oils ─────────────────────── */}
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-14">
            <span className="inline-block px-4 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-semibold mb-4 uppercase tracking-wider">
              Why Cold Pressed
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
              The Oil Your Body Deserves
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">
              Modern refined oils strip away everything valuable. Cold pressing keeps it all in.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-slate-100 hover:border-brand-200 hover:shadow-md transition-all group">
                <div className="w-11 h-11 bg-brand-50 group-hover:bg-brand-100 rounded-xl flex items-center justify-center mb-4 transition-colors">
                  <Icon className="w-5 h-5 text-brand-600" />
                </div>
                <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <button
              onClick={() => navigate('/shop')}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl transition-colors shadow-md"
            >
              Shop Our Oils <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Divider ───────────────────────────────────────────── */}
      <div
        className="h-48 sm:h-64 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #14532d, #16a34a)' }}
      >
        <img
          src="/Gemini_Generated_Image_agra6kagra6kagra.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-10"
        />
        <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
          <p className="text-white/90 text-xl sm:text-2xl font-bold max-w-lg leading-snug">
            "Purity of Tradition in Every Drop"
          </p>
          <p className="text-white/50 text-sm mt-2">Sanathana Tattva — since tradition</p>
        </div>
      </div>

      {/* ── Trader / Dealer Section ────────────────────────────── */}
      <section className="py-20 sm:py-28 bg-slate-50">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-14">
            <span className="inline-block px-4 py-1.5 bg-slate-200 text-slate-600 rounded-full text-xs font-semibold mb-4 uppercase tracking-wider">
              For Dealers
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">
              Grow with Us as a Trader
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">
              Join our dealer network. Earn commissions, serve your local community, and build a sustainable business.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
            {TRADER_STEPS.map(({ num, title, desc }) => (
              <div key={num} className="bg-white p-6 rounded-2xl border border-slate-100 flex gap-5">
                <div className="text-3xl font-extrabold text-brand-100 leading-none flex-shrink-0 select-none">
                  {num}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1.5">{title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-5">
            <div>
              <h3 className="font-bold text-slate-900 text-lg mb-1">Already a dealer?</h3>
              <p className="text-slate-500 text-sm">Log in to your trader dashboard to manage orders, inventory, and commissions.</p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors text-sm"
            >
              Trader Login <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="py-8 px-6 bg-white border-t border-slate-100 text-center">
        <p className="text-slate-400 text-xs mb-2">
          &copy; {new Date().getFullYear()} Sanathana Tattva. All rights reserved.
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-slate-300">
          <button onClick={() => navigate('/login')} className="hover:text-slate-500 transition-colors flex items-center gap-1">
            <Lock size={9} /> Trader Portal
          </button>
          <span>·</span>
          <button onClick={() => navigate('/login')} className="hover:text-slate-500 transition-colors flex items-center gap-1">
            <Lock size={9} /> Admin
          </button>
        </div>
      </footer>
    </div>
  );
}
