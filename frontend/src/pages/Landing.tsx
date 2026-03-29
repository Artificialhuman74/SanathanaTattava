import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Shield,
  Star, ArrowRight, CheckCircle2, Zap, Globe, Award,
  ChevronDown, Truck, Percent, Clock,
  Phone, MapPin, Lock,
} from 'lucide-react';

const consumerSteps = [
  { step: '01', icon: Phone,        title: 'Sign Up Instantly',  desc: 'Create your account with just your mobile number. No forms, no hassle — verified with OTP in seconds.' },
  { step: '02', icon: ShoppingCart,  title: 'Browse & Order',     desc: 'Explore hundreds of quality products, add to cart, and checkout with your saved delivery address.' },
  { step: '03', icon: Truck,         title: 'Get It Delivered',   desc: 'Your local dealer delivers directly to your doorstep. Track your order in real-time from packed to delivered.' },
];

const whyShop = [
  { icon: Percent,      title: 'Referral Discounts',    desc: 'Got a dealer referral code? Get exclusive discounts on every order you place.' },
  { icon: Truck,        title: 'Local Delivery',         desc: 'Fast delivery by trusted local dealers who know your area.' },
  { icon: Shield,       title: 'Quality Guaranteed',     desc: 'Every product is vetted for quality. Shop with confidence.' },
  { icon: Clock,        title: 'Real-time Tracking',     desc: 'Know exactly when your order is packed, dispatched, and arriving.' },
  { icon: MapPin,       title: 'Multiple Addresses',     desc: 'Save home, work, and other addresses for quick checkout.' },
  { icon: Globe,        title: 'Works on Any Device',    desc: 'Shop from your phone, tablet, or desktop — the experience is seamless.' },
];

const categories = [
  { name: 'Electronics',        img: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&q=80', color: 'from-blue-600 to-blue-400' },
  { name: 'Food & Beverage',    img: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=400&q=80', color: 'from-amber-600 to-amber-400' },
  { name: 'Sports & Fitness',   img: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&q=80', color: 'from-emerald-600 to-emerald-400' },
  { name: 'Health & Wellness',  img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', color: 'from-purple-600 to-purple-400' },
  { name: 'Home & Living',      img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80', color: 'from-rose-600 to-rose-400' },
  { name: 'Fashion',            img: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&q=80', color: 'from-pink-600 to-pink-400' },
];

const testimonials = [
  { name: 'Priya Nair',    role: 'Consumer, Delhi',       text: 'The ordering experience is so smooth. I love that my dealer delivers the same day and I get great discounts with my referral code!', avatar: 'P' },
  { name: 'Arjun Singh',   role: 'Consumer, Bangalore',   text: 'Finally a platform where I can shop quality products and track my delivery in real-time. The OTP login is super quick.', avatar: 'A' },
  { name: 'Sneha Patel',   role: 'Consumer, Mumbai',      text: 'I saved multiple addresses for home and office. Checkout takes 10 seconds now. And the referral discount is a lovely bonus!', avatar: 'S' },
];

function AnimatedCounter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        let start = 0;
        const step = Math.ceil(target / 50);
        const timer = setInterval(() => {
          start = Math.min(start + step, target);
          setCount(start);
          if (start >= target) clearInterval(timer);
        }, 30);
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);
  return <span ref={ref}>{count}{suffix}</span>;
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      {/* Navbar — consumer-focused */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-9 w-9 object-contain rounded-lg" alt="Sanathana Tattva" />
            <span className="font-bold text-base text-slate-900 leading-tight">Sanathana Tattva</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => navigate('/shop')} className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
              <ShoppingCart size={15} />
              Shop
            </button>
            <button onClick={() => navigate('/shop/login')} className="btn-ghost text-slate-700 text-sm">
              Sign In
            </button>
            <button onClick={() => navigate('/shop/register')} className="btn-primary text-sm px-4 py-2">
              Register <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero — consumer-focused */}
      <section
        className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0d1f10 0%, #14532d 50%, #1a2e0d 100%)',
        }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1920&q=60)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-green-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-1/4 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/80 text-sm font-medium mb-8">
            <Zap size={14} className="text-yellow-400" />
            Quality Products. Local Delivery. Great Prices.
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold text-white leading-tight mb-6">
            Pure Tradition.<br />
            <span className="bg-gradient-to-r from-gold-400 to-gold-200 bg-clip-text text-transparent">
              Sanathana Tattva
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed">
            Cold pressed oils crafted the traditional way. Get exclusive referral discounts and enjoy fast local delivery right to your doorstep.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={() => navigate('/shop')}
              className="w-full sm:w-auto px-8 py-4 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-2xl text-base transition-all shadow-lg hover:shadow-brand-500/30 flex items-center justify-center gap-2"
            >
              <ShoppingCart size={18} /> Start Shopping
            </button>
            <button
              onClick={() => navigate('/shop/register')}
              className="w-full sm:w-auto px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold rounded-2xl text-base transition-all backdrop-blur-sm flex items-center justify-center gap-2"
            >
              Create Account <ArrowRight size={18} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 mt-10 text-white/50 text-sm">
            {['Free to join', 'Referral discounts', 'Local delivery', 'Real-time tracking'].map(item => (
              <span key={item} className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-emerald-400" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Hero Image */}
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 mt-16">
          <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
            <img
              src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1200&q=80"
              alt="TradeHub marketplace preview"
              className="w-full object-cover h-48 sm:h-72 md:h-96"
            />
          </div>
          <div className="absolute -bottom-4 -right-2 sm:right-8 bg-white rounded-xl p-3 sm:p-4 shadow-xl border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Delivered to your door</p>
              <p className="text-base font-bold text-slate-900">Fast & Free</p>
            </div>
          </div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-5 h-5 text-white/30" />
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 bg-brand-600">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8 text-center">
            {[
              { value: 500, suffix: '+', label: 'Products' },
              { value: 10,  suffix: 'k+', label: 'Happy Customers' },
              { value: 50,  suffix: '+', label: 'Cities' },
              { value: 99,  suffix: '%', label: 'On-time Delivery' },
            ].map(({ value, suffix, label }) => (
              <div key={label}>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  <AnimatedCounter target={value} suffix={suffix} />
                </div>
                <p className="text-brand-200 text-sm font-medium mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — consumer steps */}
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-4 py-1.5 bg-brand-50 text-brand-700 rounded-full text-sm font-semibold mb-4">How It Works</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">Shopping Made Simple</h2>
            <p className="text-slate-500 max-w-xl mx-auto">Get started in under a minute. No email needed — just your phone number.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-8 left-1/3 right-1/3 h-0.5 bg-gradient-to-r from-brand-200 to-brand-400" />
            {consumerSteps.map(({ step, icon: Icon, title, desc }, i) => (
              <div key={step} className="text-center relative">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5
                  ${i === 0 ? 'bg-brand-600' : i === 1 ? 'bg-brand-100' : 'bg-emerald-100'}`}>
                  <Icon size={28} className={i === 0 ? 'text-white' : i === 1 ? 'text-brand-700' : 'text-emerald-600'} />
                </div>
                <div className="text-xs font-bold text-slate-400 mb-1">STEP {step}</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">{title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Categories */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-sm font-semibold mb-4">Categories</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">Shop by Category</h2>
            <p className="text-slate-500 max-w-xl mx-auto">Explore hundreds of quality products across popular categories.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.map(({ name, img, color }) => (
              <button
                key={name}
                onClick={() => navigate('/shop')}
                className="group relative overflow-hidden rounded-2xl aspect-square shadow-md hover:shadow-xl transition-all hover:-translate-y-1"
              >
                <img src={img} alt={name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                <div className={`absolute inset-0 bg-gradient-to-t ${color} opacity-60 group-hover:opacity-70 transition-opacity`} />
                <div className="absolute inset-0 flex items-end p-3">
                  <p className="text-white font-bold text-sm leading-tight">{name}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="text-center mt-8">
            <button onClick={() => navigate('/shop')} className="btn-primary px-8 py-3 text-base">
              Browse All Products <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Why Shop With Us */}
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <span className="inline-block px-4 py-1.5 bg-brand-50 text-brand-700 rounded-full text-sm font-semibold mb-4">Why Sanathana Tattva</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">Built for Smart Shoppers</h2>
            <p className="text-lg text-slate-500 max-w-xl mx-auto">Everything you need for a seamless shopping experience.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {whyShop.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="card p-6 hover:shadow-card-hover transition-all group">
                <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                  <Icon className="w-6 h-6 text-brand-600" />
                </div>
                <h3 className="font-bold text-slate-900 text-base mb-2">{title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 sm:py-28 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 bg-brand-50 text-brand-700 rounded-full text-sm font-semibold mb-4">Testimonials</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4">What Our Shoppers Say</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map(({ name, role, text, avatar }) => (
              <div key={name} className="card p-6">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => <Star key={i} size={14} className="fill-yellow-400 text-yellow-400" />)}
                </div>
                <p className="text-slate-600 text-sm leading-relaxed mb-5 italic">"{text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center text-white font-bold text-sm">{avatar}</div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{name}</p>
                    <p className="text-slate-500 text-xs">{role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — consumer focused */}
      <section className="py-20 bg-gradient-to-br from-brand-600 to-brand-800 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1920&q=40)', backgroundSize: 'cover' }}
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <Award className="w-12 h-12 text-yellow-400 mx-auto mb-5" />
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">Ready to Start Shopping?</h2>
          <p className="text-brand-200 text-lg mb-8">Join thousands of happy shoppers. Sign up in seconds.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => navigate('/shop')} className="px-8 py-4 bg-white text-brand-700 font-bold rounded-2xl hover:bg-brand-50 transition-all shadow-lg flex items-center justify-center gap-2">
              <ShoppingCart size={18} /> Shop Now
            </button>
            <button onClick={() => navigate('/shop/register')} className="px-8 py-4 bg-white/10 border border-white/20 text-white font-bold rounded-2xl hover:bg-white/20 transition-all flex items-center justify-center gap-2">
              Create Free Account <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pb-8 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <img src="/Gemini_Generated_Image_agra6kagra6kagra.png" className="h-8 w-8 object-contain rounded-lg" alt="logo" />
                <span className="font-bold text-white text-base leading-tight">Sanathana Tattva</span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">Pure cold pressed oils delivered to your doorstep. Purity of Tradition in Every Drop.</p>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Quick Links</p>
              <div className="space-y-2">
                {[
                  { label: 'Shop Products', to: '/shop' },
                  { label: 'Sign In', to: '/shop/login' },
                  { label: 'Create Account', to: '/shop/register' },
                ].map(({ label, to }) => (
                  <button key={label} onClick={() => navigate(to)} className="block text-slate-400 text-sm hover:text-white transition-colors">{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Contact</p>
              <p className="text-slate-400 text-sm">gravitycoir@gmail.com</p>
              <p className="text-slate-400 text-sm mt-1">+91 9972922514</p>
            </div>
          </div>

          {/* Trader / Admin access — subtle, at the very bottom */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6">
            <p className="text-slate-500 text-sm">&copy; {new Date().getFullYear()} Sanathana Tattva. All rights reserved.</p>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <button onClick={() => navigate('/login')} className="hover:text-slate-400 transition-colors flex items-center gap-1">
                <Lock size={10} /> Trader Portal
              </button>
              <span className="text-slate-700">|</span>
              <button onClick={() => navigate('/login')} className="hover:text-slate-400 transition-colors flex items-center gap-1">
                <Lock size={10} /> Admin
              </button>
              <span className="text-slate-700">|</span>
              <span className="text-slate-600">Privacy Policy</span>
              <span className="text-slate-600">Terms</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
