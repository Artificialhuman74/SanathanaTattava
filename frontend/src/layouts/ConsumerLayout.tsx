import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Home, ShoppingBag, User, Menu, X, LogOut, MapPin, ChevronRight, HeadphonesIcon, ShoppingCart } from 'lucide-react';
import NotificationBell from '../components/NotificationBell';
import { getCartCount } from '../services/cartStorage';

export default function ConsumerLayout() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [cartCount, setCartCount] = useState(getCartCount());
  const [cartBounce, setCartBounce] = useState(false);

  // Track scroll to swap bell → cart icon
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Sync cart count from storage events (fired by cartStorage.ts)
  useEffect(() => {
    const onCart = (e: Event) => {
      const count = (e as CustomEvent<number>).detail;
      setCartCount(count);
    };
    window.addEventListener('cart-updated', onCart);
    return () => window.removeEventListener('cart-updated', onCart);
  }, []);

  // Bounce the layout cart icon when the fly dot lands
  const prevCartRef = useRef(cartCount);
  useEffect(() => { prevCartRef.current = cartCount; }, [cartCount]);
  useEffect(() => {
    const onLand = () => {
      setCartBounce(true);
      setTimeout(() => setCartBounce(false), 500);
    };
    window.addEventListener('cart-land', onLand);
    return () => window.removeEventListener('cart-land', onLand);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const handleLogout = () => {
    consumerLogout();
    navigate('/shop');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Top Header ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 h-14">
          {/* Left: hamburger */}
          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-700" />
          </button>

          {/* Center: text only */}
          <Link to="/shop" className="absolute left-1/2 -translate-x-1/2">
            <span className="text-base font-semibold tracking-tight text-gray-900" style={{ fontFamily: "'Georgia', 'Times New Roman', serif", letterSpacing: '-0.01em' }}>Sanathana Tattva</span>
          </Link>

          {/* Right: cart when scrolled, bell when at top */}
          <div className="flex items-center justify-center w-10 h-10">
            {scrolled ? (
              <button
                data-cart-fly-target="layout"
                data-cart-fly-priority="2"
                onClick={() => window.dispatchEvent(new Event('open-cart'))}
                className={`relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors ${cartBounce ? 'animate-cart-land' : ''}`}
              >
                <ShoppingCart size={20} className="text-gray-700" />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                )}
              </button>
            ) : (
              consumer ? <NotificationBell variant="consumer" /> : <div className="w-10 h-10" />
            )}
          </div>
        </div>
      </header>

      {/* ── Full-screen Menu Overlay ────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />

          {/* Menu panel — full screen on mobile */}
          <div className="relative w-full bg-white flex flex-col animate-slide-up sm:w-80 sm:animate-none sm:slide-in">
            {/* Menu header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900 text-base" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>Sanathana Tattva</p>
                <p className="text-xs text-gray-400">Purity of Tradition in Every Drop</p>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* User info */}
            {consumer && (
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-brand-700 font-bold text-base">{consumer.name?.[0]?.toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{consumer.name}</p>
                    <p className="text-xs text-gray-400">{consumer.email || consumer.phone}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Nav links */}
            <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
              <NavItem to="/shop" icon={<Home size={18} />} label="Home" onClick={() => setMenuOpen(false)} />
              {consumer && (
                <>
                  <NavItem to="/shop/orders" icon={<ShoppingBag size={18} />} label="My Orders" onClick={() => setMenuOpen(false)} />
                  <NavItem to="/shop/addresses" icon={<MapPin size={18} />} label="My Addresses" onClick={() => setMenuOpen(false)} />
                  <NavItem to="/shop/profile" icon={<User size={18} />} label="Profile" onClick={() => setMenuOpen(false)} />
                </>
              )}
              <NavItem to="/shop/support" icon={<HeadphonesIcon size={18} />} label="Get Support" onClick={() => setMenuOpen(false)} />
            </nav>

            {/* Bottom auth */}
            <div className="px-3 pb-6 pt-3 border-t border-gray-100 space-y-2">
              {consumer ? (
                <button
                  onClick={() => { handleLogout(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-500 hover:bg-red-50 transition-colors text-sm font-medium"
                >
                  <LogOut size={18} />
                  Log Out
                </button>
              ) : (
                <>
                  <Link
                    to="/shop/login"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center justify-center py-3 rounded-xl bg-brand-600 text-white font-semibold text-sm"
                  >
                    Login
                  </Link>
                  <Link
                    to="/shop/register"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center justify-center py-3 rounded-xl border border-brand-600 text-brand-600 font-semibold text-sm"
                  >
                    Register
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Page Content ──────────────────────────────────────────────── */}
      <main className="flex-1 pb-20 sm:pb-0">
        <Outlet />
      </main>

      {/* ── Bottom Navigation (mobile only) ───────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100 safe-bottom">
        <div className="flex items-center">
          <BottomNavItem
            to="/shop"
            icon={<Home size={20} />}
            label="Home"
            active={isActive('/shop')}
          />
          {consumer ? (
            <>
              <BottomNavItem
                to="/shop/orders"
                icon={<ShoppingBag size={20} />}
                label="Orders"
                active={isActive('/shop/orders')}
              />
              <BottomNavItem
                to="/shop/profile"
                icon={<User size={20} />}
                label="Profile"
                active={isActive('/shop/profile')}
              />
            </>
          ) : (
            <BottomNavItem
              to="/shop/login"
              icon={<User size={20} />}
              label="Login"
              active={isActive('/shop/login')}
            />
          )}
        </div>
      </nav>

      {/* ── Desktop horizontal nav (sm and above) ─────────────────────── */}
      <div className="hidden sm:block">
        {/* Desktop uses the menu overlay above; keep a simple footer */}
        <footer className="bg-gray-900 py-4 mt-auto">
          <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
            <span className="font-semibold text-white text-sm" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>Sanathana Tattva</span>
            <p className="text-gray-500 text-xs">© {new Date().getFullYear()} Purity of Tradition in Every Drop</p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {consumer && (
                <>
                  <NavLink to="/shop/orders" className="hover:text-gray-300">Orders</NavLink>
                  <NavLink to="/shop/addresses" className="hover:text-gray-300">Addresses</NavLink>
                </>
              )}
              <Link to="/login" className="hover:text-gray-300">Trader Login</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, onClick }: { to: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
        active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className={active ? 'text-brand-600' : 'text-gray-400'}>{icon}</span>
      {label}
      <ChevronRight size={14} className="ml-auto text-gray-300" />
    </Link>
  );
}

function BottomNavItem({ to, icon, label, active }: { to: string; icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className="flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors"
    >
      <span className={active ? 'text-brand-600' : 'text-gray-400'}>{icon}</span>
      <span className={`text-[10px] font-medium ${active ? 'text-brand-600' : 'text-gray-400'}`}>{label}</span>
    </Link>
  );
}
