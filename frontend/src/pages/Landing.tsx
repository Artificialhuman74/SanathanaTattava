import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Leaf, Droplets, Heart, Zap, Shield, Users, ArrowRight, ChevronDown } from 'lucide-react';

/* ── Colour tokens ─────────────────────────────────────────────────────── */
const C = {
  cream:      '#fdf8f0',
  parchment:  '#f5ede0',
  greenDeep:  '#0f3d1a',
  greenMain:  '#14532d',
  greenMid:   '#1a6b2e',
  gold:       '#c8963c',
  goldLight:  '#e8b86d',
  brown:      '#5c3d1a',
  text:       '#1c1a14',
  textMuted:  '#6b5d4e',
  border:     '#e8dcc8',
};

/* ── Scroll-reveal helpers ─────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function RevealGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} className={className} data-visible={visible ? 'true' : 'false'}>
      {children}
    </div>
  );
}

function AnimCard({
  children, index, className = '',
}: { children: React.ReactNode; index: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.closest('[data-visible]') as HTMLElement | null;
    if (!parent) return;
    const trigger = () => { if (parent.dataset.visible === 'true') { setTimeout(() => setShow(true), index * 90); obs.disconnect(); } };
    const obs = new MutationObserver(trigger);
    obs.observe(parent, { attributes: true, attributeFilter: ['data-visible'] });
    trigger();
    return () => obs.disconnect();
  }, [index]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity:    show ? 1 : 0,
        transform:  show ? 'translateY(0)' : 'translateY(32px)',
        transition: 'opacity 0.55s ease, transform 0.55s ease',
      }}
    >
      {children}
    </div>
  );
}

/* ── Data ──────────────────────────────────────────────────────────────── */
const BENEFITS = [
  { icon: Leaf,     title: 'Nutrients Fully Preserved', desc: 'Cold pressing never uses heat — every vitamin, mineral, and antioxidant stays intact exactly as nature intended.' },
  { icon: Droplets, title: 'Zero Chemicals',             desc: 'No solvents, no bleaching, no deodorising. Pure oil extracted the traditional way in a wooden ghani press.' },
  { icon: Heart,    title: 'Heart & Gut Friendly',       desc: 'Rich in Omega-3, Omega-6, and natural phytosterols that actively support cardiovascular and digestive health.' },
  { icon: Zap,      title: 'Higher Smoke Point',         desc: 'Unrefined cold pressed oils handle everyday cooking temperatures without breaking down into harmful compounds.' },
  { icon: Shield,   title: 'Stronger Immunity',          desc: 'Natural Vitamin E and polyphenols act as antioxidants, helping your body fight inflammation and oxidative stress.' },
  { icon: Users,    title: 'Richer Flavour',             desc: 'Cold pressed oils carry the full aroma and taste of the seed — a world apart from refined supermarket oils.' },
];

const TRADER_STEPS = [
  { num: '01', title: 'Apply as a Dealer',  desc: 'Contact us to become an authorised dealer. We verify you and create your account with a unique referral code.' },
  { num: '02', title: 'Share Your Code',    desc: 'Give your referral code to customers in your area. When they order with your code, they are permanently linked to you.' },
  { num: '03', title: 'Earn Commission',    desc: 'Every paid order from your customers earns you a commission — automatically tracked in your dealer dashboard.' },
  { num: '04', title: 'Deliver Locally',    desc: 'Deliver nearby yourself or let the platform assign deliveries based on GPS location — your choice.' },
];

/* ── Component ─────────────────────────────────────────────────────────── */
export default function Landing() {
  const navigate = useNavigate();
  const heroRef  = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const fn = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const progress     = Math.min(scrollY / 500, 1);
  const logoHeightVh = 37 + progress * 63;
  const logoRadius   = 20 * Math.max(0, 1 - progress * 2.5);
  const logoOpacity  = progress < 0.55 ? 1 : Math.max(0.1, 1 - (progress - 0.55) / 0.45 * 0.9);
  const textOpacity  = Math.max(0, 1 - progress / 0.25);
  const navOpacity   = Math.min(Math.max(0, (scrollY - 120) / 80), 1);
  const navVisible   = scrollY > 120;

  return (
    <div style={{ background: C.cream, color: C.text }} className="overflow-x-hidden">

      {/* ── Sticky nav ─────────────────────────────────────────── */}
      <div
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background:    'rgba(253,248,240,0.96)',
          backdropFilter:'blur(16px)',
          borderColor:   C.border,
          opacity:       navOpacity,
          pointerEvents: navVisible ? 'auto' : 'none',
          transform:     `translateY(${navVisible ? 0 : -8}px)`,
          transition:    'transform 0.3s ease',
        }}
      >
        <div className="max-w-2xl mx-auto px-5 h-14 flex items-center gap-3">
          <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-8 w-8 rounded-lg object-contain flex-shrink-0" alt="logo" />
          <span className="font-bold text-sm flex-1 truncate" style={{ color: C.text }}>Sanathana Tattva</span>
          <button
            onClick={() => navigate('/shop/register')}
            className="text-sm font-medium transition-colors px-2 hidden sm:block"
            style={{ color: C.textMuted }}
          >
            Register
          </button>
          <button
            onClick={() => navigate('/shop/login')}
            className="px-4 py-1.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
            style={{ background: C.greenMain, color: '#fff' }}
          >
            Sign In
          </button>
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div
        ref={heroRef}
        className="relative h-[200vh]"
        style={{ background: `linear-gradient(170deg, ${C.parchment} 0%, #ede3d0 60%, ${C.parchment} 100%)` }}
      >
        <div className="sticky top-0 h-screen overflow-hidden flex flex-col">

          {/* Logo */}
          <div style={{
            height:       `${logoHeightVh}vh`,
            flexShrink:   0,
            overflow:     'hidden',
            opacity:      logoOpacity,
            borderRadius: `0 0 ${logoRadius}px ${logoRadius}px`,
          }}>
            <img
              src="/Gemini_Generated_Image_agra6kagra6kagra.png"
              alt="Sanathana Tattva"
              className="w-full h-full object-cover"
              style={{ objectPosition: 'center center' }}
            />
          </div>

          {/* Text below logo */}
          <div
            className="flex-1 flex flex-col items-center justify-center px-6"
            style={{ opacity: textOpacity, pointerEvents: textOpacity > 0.1 ? 'auto' : 'none' }}
          >
            <h1 className="text-2xl sm:text-3xl font-extrabold mb-1.5 text-center tracking-tight" style={{ color: C.text }}>
              Sanathana Tattva
            </h1>
            <p className="text-sm text-center max-w-xs mb-7 leading-relaxed" style={{ color: C.textMuted }}>
              Cold pressed oils crafted the traditional way, delivered to your doorstep.
            </p>
            <div className="w-full max-w-xs space-y-2.5">
              <button
                onClick={() => navigate('/shop/login')}
                className="w-full py-3 rounded-2xl text-sm font-bold transition-colors shadow-md"
                style={{ background: C.greenMain, color: '#fff' }}
              >
                Sign In
              </button>
              <button
                onClick={() => navigate('/shop/register')}
                className="w-full py-3 rounded-2xl text-sm font-bold border transition-colors"
                style={{ background: '#fff', color: C.text, borderColor: C.border }}
              >
                Create Account
              </button>
              <button
                onClick={() => navigate('/shop')}
                className="w-full py-2 text-xs font-medium transition-colors"
                style={{ color: C.textMuted }}
              >
                Continue as Guest →
              </button>
            </div>
            <div
              className="mt-6 flex flex-col items-center gap-1"
              style={{ opacity: scrollY < 20 ? 1 : 0, transition: 'opacity 0.4s ease' }}
            >
              <span className="text-xs" style={{ color: C.border }}>Scroll to explore</span>
              <ChevronDown size={13} style={{ color: C.border }} className="animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Benefits ───────────────────────────────────────────── */}
      <section className="py-20 sm:py-28" style={{ background: C.cream }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8">

          <div className="text-center mb-14">
            <span
              className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold mb-4 uppercase tracking-wider"
              style={{ background: `${C.gold}22`, color: C.gold }}
            >
              Why Cold Pressed
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 tracking-tight" style={{ color: C.text }}>
              The Oil Your Body Deserves
            </h2>
            <p className="max-w-xl mx-auto leading-relaxed text-sm sm:text-base" style={{ color: C.textMuted }}>
              Modern refined oils strip away everything valuable. Cold pressing keeps it all in.
            </p>
          </div>

          <RevealGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {BENEFITS.map(({ icon: Icon, title, desc }, i) => (
              <AnimCard key={title} index={i}>
                <div
                  className="p-6 rounded-2xl border h-full transition-all hover:-translate-y-0.5"
                  style={{ background: '#fff', borderColor: C.border }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: C.greenDeep }}
                  >
                    <Icon className="w-5 h-5" style={{ color: C.goldLight }} />
                  </div>
                  <h3 className="font-bold mb-2" style={{ color: C.text }}>{title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: C.textMuted }}>{desc}</p>
                </div>
              </AnimCard>
            ))}
          </RevealGrid>

          <div className="text-center mt-12">
            <button
              onClick={() => navigate('/shop')}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl font-bold text-sm transition-colors shadow-md"
              style={{ background: C.greenMain, color: '#fff' }}
            >
              Shop Our Oils <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Quote divider ──────────────────────────────────────── */}
      <div
        className="relative py-16 sm:py-20 overflow-hidden"
        style={{ background: C.greenDeep }}
      >
        <img
          src="/Gemini_Generated_Image_agra6kagra6kagra.png"
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover opacity-[0.07] pointer-events-none"
        />
        {/* Gold top border */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)` }} />
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)` }} />

        <div className="relative text-center px-6">
          {/* Decorative dot */}
          <div className="w-8 h-0.5 mx-auto mb-6 rounded-full" style={{ background: C.gold }} />
          <p className="text-xl sm:text-2xl font-bold max-w-lg mx-auto leading-snug" style={{ color: C.goldLight }}>
            "Purity of Tradition in Every Drop"
          </p>
          <p className="text-xs mt-3 font-medium tracking-widest uppercase" style={{ color: `${C.goldLight}66` }}>
            Sanathana Tattva
          </p>
          <div className="w-8 h-0.5 mx-auto mt-6 rounded-full" style={{ background: C.gold }} />
        </div>
      </div>

      {/* ── Trader section ─────────────────────────────────────── */}
      <section className="py-20 sm:py-28" style={{ background: C.parchment }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8">

          <div className="text-center mb-14">
            <span
              className="inline-block px-4 py-1.5 rounded-full text-xs font-semibold mb-4 uppercase tracking-wider"
              style={{ background: `${C.brown}22`, color: C.brown }}
            >
              For Dealers
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 tracking-tight" style={{ color: C.text }}>
              Grow with Us as a Trader
            </h2>
            <p className="max-w-xl mx-auto leading-relaxed text-sm sm:text-base" style={{ color: C.textMuted }}>
              Join our dealer network. Earn commissions, serve your local community, and build a sustainable business.
            </p>
          </div>

          <RevealGrid className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {TRADER_STEPS.map(({ num, title, desc }, i) => (
              <AnimCard key={num} index={i}>
                <div
                  className="p-6 rounded-2xl border h-full"
                  style={{ background: '#fff', borderColor: C.border }}
                >
                  <div className="flex gap-4">
                    <span className="text-4xl font-extrabold leading-none select-none flex-shrink-0"
                      style={{ color: `${C.gold}40` }}>
                      {num}
                    </span>
                    <div>
                      <h3 className="font-bold mb-1.5" style={{ color: C.text }}>{title}</h3>
                      <p className="text-sm leading-relaxed" style={{ color: C.textMuted }}>{desc}</p>
                    </div>
                  </div>
                </div>
              </AnimCard>
            ))}
          </RevealGrid>

          {/* Dealer CTA card */}
          <div
            className="rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-5 border"
            style={{ background: C.greenDeep, borderColor: `${C.gold}33` }}
          >
            <div>
              <h3 className="font-bold text-lg mb-1" style={{ color: C.goldLight }}>Already a dealer?</h3>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Log in to your trader dashboard to manage orders, inventory, and commissions.
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-colors"
              style={{ background: C.gold, color: C.greenDeep }}
            >
              Trader Login <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        className="py-8 px-6 text-center border-t"
        style={{ background: C.cream, borderColor: C.border }}
      >
        <p className="text-xs mb-2" style={{ color: C.textMuted }}>
          &copy; {new Date().getFullYear()} Sanathana Tattva. All rights reserved.
        </p>
        <div className="flex items-center justify-center gap-4 text-xs" style={{ color: C.border }}>
          <button onClick={() => navigate('/login')} className="hover:opacity-70 transition-opacity flex items-center gap-1">
            <Lock size={9} /> Trader Portal
          </button>
          <span>·</span>
          <button onClick={() => navigate('/login')} className="hover:opacity-70 transition-opacity flex items-center gap-1">
            <Lock size={9} /> Admin
          </button>
        </div>
      </footer>

    </div>
  );
}
