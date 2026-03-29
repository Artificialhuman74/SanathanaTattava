import React, { useEffect, useState } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Warehouse, Search, AlertTriangle, Package, CheckCircle } from 'lucide-react';

interface InventoryItem {
  id: number;
  dealer_id: number;
  product_id: number;
  quantity: number;
  low_stock_threshold: number;
  product_name: string;
  sku: string;
  image_url: string | null;
  price: number;
  unit: string;
  category: string;
  stock_status: 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  OK:           { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'In Stock' },
  LOW_STOCK:    { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Low Stock' },
  OUT_OF_STOCK: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Out of Stock' },
};

export default function TraderInventory() {
  const [items, setItems]     = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    api.get('/trader/inventory')
      .then(r => setItems(r.data.inventory || []))
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(i =>
    i.product_name.toLowerCase().includes(search.toLowerCase()) ||
    i.sku.toLowerCase().includes(search.toLowerCase()) ||
    i.category.toLowerCase().includes(search.toLowerCase())
  );

  const totalProducts = items.length;
  const lowStock      = items.filter(i => i.stock_status === 'LOW_STOCK').length;
  const outOfStock    = items.filter(i => i.stock_status === 'OUT_OF_STOCK').length;
  const totalUnits    = items.reduce((s, i) => s + i.quantity, 0);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">My Inventory</h2>
        <p className="text-slate-500 text-sm mt-0.5">Stock allocated to you by the admin warehouse</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Products',     value: totalProducts, color: 'text-brand-600',   icon: Package },
          { label: 'Total Units',  value: totalUnits,    color: 'text-indigo-600',  icon: Warehouse },
          { label: 'Low Stock',    value: lowStock,      color: 'text-amber-600',   icon: AlertTriangle },
          { label: 'Out of Stock', value: outOfStock,    color: 'text-red-600',     icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card p-4 text-center">
            <Icon size={18} className={`mx-auto mb-1 ${color}`} />
            <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search products..." />
      </div>

      {/* Inventory List */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-slate-400">
          <Warehouse size={48} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium text-lg">{items.length === 0 ? 'No inventory allocated yet' : 'No matching products'}</p>
          {items.length === 0 && <p className="text-sm mt-1">Contact admin to get stock distributed to your account.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(item => {
            const st = STATUS_STYLE[item.stock_status] || STATUS_STYLE.OK;
            return (
              <div key={item.id} className="card overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-32 bg-slate-100 flex items-center justify-center overflow-hidden">
                  {item.image_url
                    ? <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                    : <Package size={32} className="text-slate-300" />
                  }
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 text-sm truncate">{item.product_name}</p>
                      <p className="text-xs text-slate-400">{item.sku} · {item.category}</p>
                    </div>
                    <span className={`badge text-xs flex-shrink-0 ${st.bg} ${st.text}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-end justify-between pt-2 border-t border-slate-100">
                    <div>
                      <p className="text-xs text-slate-400">Quantity</p>
                      <p className={`text-2xl font-extrabold ${
                        item.stock_status === 'OUT_OF_STOCK' ? 'text-red-600' :
                        item.stock_status === 'LOW_STOCK' ? 'text-amber-600' : 'text-slate-900'
                      }`}>
                        {item.quantity} <span className="text-xs font-normal text-slate-400">{item.unit}s</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Threshold</p>
                      <p className="text-sm font-semibold text-slate-600">{item.low_stock_threshold}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
