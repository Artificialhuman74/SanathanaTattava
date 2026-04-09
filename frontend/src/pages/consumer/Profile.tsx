import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import { User, MapPin, ShoppingBag, LogOut, ChevronRight, Tag } from 'lucide-react';

export default function ConsumerProfile() {
  const { consumer, consumerLogout } = useAuth();
  const navigate = useNavigate();
  const [discountPct, setDiscountPct] = useState(0);

  useEffect(() => {
    consumerApi.get('/admin/settings')
      .then(r => setDiscountPct(parseFloat(r.data.referral_discount_percent) || 0))
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    consumerLogout();
    navigate('/shop');
  };

  if (!consumer) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center">
        <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <User size={36} className="text-gray-300" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">You're not logged in</h2>
        <p className="text-gray-400 text-sm mb-6">Login to view your profile and orders</p>
        <Link
          to="/shop/login"
          className="inline-block px-8 py-3 bg-brand-600 text-white rounded-full font-semibold text-sm"
        >
          Login
        </Link>
      </div>
    );
  }

  const initials = consumer.name
    ? consumer.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Avatar */}
      <div className="flex flex-col items-center pt-4 pb-8">
        <div className="w-24 h-24 rounded-full bg-brand-100 flex items-center justify-center mb-3 shadow-sm">
          <span className="text-brand-700 font-bold text-3xl">{initials}</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900">{consumer.name}</h2>
        {consumer.phone && <p className="text-sm text-gray-400 mt-0.5">{consumer.phone}</p>}
        {consumer.email && <p className="text-xs text-gray-400">{consumer.email}</p>}
      </div>

      {/* Menu */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
        <ProfileMenuItem
          icon={<User size={18} className="text-brand-600" />}
          label="My Account"
          sub="Manage your account details"
          to="/shop/profile/account"
          iconBg="bg-brand-50"
        />
        <ProfileMenuItem
          icon={<MapPin size={18} className="text-purple-600" />}
          label="My Location"
          sub="Manage delivery addresses"
          to="/shop/addresses"
          iconBg="bg-purple-50"
        />
        <ProfileMenuItem
          icon={<ShoppingBag size={18} className="text-emerald-600" />}
          label="Order History"
          sub="View your past purchases"
          to="/shop/orders"
          iconBg="bg-emerald-50"
        />
      </div>

      {/* Referral */}
      {discountPct > 0 && (
        <div className="mt-4">
          {consumer.referral_code_used ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Tag size={16} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-800">{discountPct}% referral discount active</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  Code: <span className="font-mono font-bold">{consumer.referral_code_used}</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Tag size={16} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800">Have a referral code?</p>
                <p className="text-xs text-amber-600 mt-0.5">Enter it at checkout to get <strong>{discountPct}% off</strong></p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logout */}
      <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-red-50 transition-colors"
        >
          <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
            <LogOut size={18} className="text-red-500" />
          </div>
          <span className="font-medium text-red-500 text-sm">Log Out</span>
          <ChevronRight size={14} className="ml-auto text-red-300" />
        </button>
      </div>

      <p className="text-center text-xs text-gray-300 mt-8">Sanathana Tattva · Purity of Tradition in Every Drop</p>
    </div>
  );
}

function ProfileMenuItem({
  icon, label, sub, to, iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  to: string;
  iconBg: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
    >
      <div className={`w-9 h-9 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
      <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
    </Link>
  );
}
