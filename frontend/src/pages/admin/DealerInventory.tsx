import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Warehouse, Search, AlertTriangle, Package, ChevronDown, X,
  ArrowRight, RefreshCcw, Truck, Plus, Minus,
} from 'lucide-react';

interface DealerInvRow {
  dealer_id: number; product_id: number; quantity: number;
  low_stock_threshold: number; product_name: string; sku: string;
  warehouse_stock: number; image_url: string | null;
  dealer_name: string; dealer_tier: number; dealer_phone: string;
  stock_status: 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}
interface AlertRow extends DealerInvRow {}
interface WarehouseProduct {
  id: number; name: string; sku: string; stock: number; category: string;
  image_url: string | null; unit: string; total_dealer_stock: number; warehouse_stock: number;
}
interface Dealer { id: number; name: string; tier: number; phone: string }

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  OK:           { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'OK' },
  LOW_STOCK:    { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'LOW' },
  OUT_OF_STOCK: { bg: 'bg-red-100',     text: 'text-red-700',     label: 'OUT' },
};

export default function AdminDealerInventory() {
  const [tab, setTab] = useState<'overview' | 'warehouse' | 'restock' | 'alerts'>('overview');
  const [inventory, setInventory] = useState<DealerInvRow[]>([]);
  const [alerts, setAlerts]       = useState<AlertRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [warehouse, setWarehouse] = useState<WarehouseProduct[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [dealers, setDealers]     = useState<Dealer[]>([]);
  const [products, setProducts]   = useState<WarehouseProduct[]>([]);
  const [selDealer, setSelDealer] = useState<number | ''>('');
  const [restockItems, setRestockItems] = useState<{ product_id: number; quantity: number }[]>([]);
  const [restocking, setRestocking]     = useState(false);

  const fetchOverview = useCallback(() => {
    setLoading(true);
    api.get('/admin/inventory/overview')
      .then(r => { setInventory(r.data.inventory || []); setAlerts(r.data.alerts || []); })
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  }, []);

  const fetchWarehouse = () => {
    setWhLoading(true);
    api.get('/admin/inventory/warehouse')
      .then(r => setWarehouse(r.data.products || []))
      .finally(() => setWhLoading(false));
  };

  const fetchDealersAndProducts = () => {
    Promise.all([api.get('/admin/traders?status=active'), api.get('/admin/inventory/warehouse')])
      .then(([trRes, whRes]) => {
        setDealers((trRes.data.traders || []).filter((t: any) => t.role === 'trader'));
        setProducts(whRes.data.products || []);
      });
  };

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => {
    if (tab === 'warehouse') fetchWarehouse();
    if (tab === 'restock') fetchDealersAndProducts();
  }, [tab]);

  const addRestockItem = () => setRestockItems(p => [...p, { product_id: 0, quantity: 1 }]);
  const removeRestockItem = (idx: number) => setRestockItems(p => p.filter((_, i) => i !== idx));
  const updateRestockItem = (idx: number, field: 'product_id' | 'quantity', value: number) =>
    setRestockItems(p => p.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const submitRestock = async () => {
    if (!selDealer) return toast.error('Select a dealer');
    const valid = restockItems.filter(i => i.product_id > 0 && i.quantity > 0);
    if (!valid.length) return toast.error('Add at least one product');
    setRestocking(true);
    try {
      const r = await api.post('/admin/inventory/restock', { dealer_id: selDealer, items: valid });
      toast.success(`Restocked ${r.data.transferred?.length || 0} product(s)`);
      setRestockItems([]); fetchOverview(); fetchDealersAndProducts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Restock failed'); }
    finally { setRestocking(false); }
  };

  const filtered = inventory.filter(i =>
    i.product_name.toLowerCase().includes(search.toLowerCase()) ||
    i.dealer_name.toLowerCase().includes(search.toLowerCase()) ||
    i.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Dealer Inventory</h2>
          <p className="text-slate-500 text-sm mt-0.5">Distribute warehouse stock to dealers and monitor levels</p>
        </div>
        <button onClick={fetchOverview} className="btn-ghost text-sm flex items-center gap-1.5"><RefreshCcw size={14} /> Refresh</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit flex-wrap">
        {([
          { key: 'overview',  label: 'Dealer Stock',   icon: Package },
          { key: 'warehouse', label: 'Warehouse',      icon: Warehouse },
          { key: 'restock',   label: 'Restock Dealer', icon: Truck },
          { key: 'alerts',    label: `Alerts (${alerts.length})`, icon: AlertTriangle },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors
              ${tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── Overview ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search dealer / product..." />
          </div>
          <div className="card">
            {loading ? (
              <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" /></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Dealer</th><th>Product</th><th>Current Stock</th><th>Threshold</th><th>Status</th></tr></thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const st = STATUS_STYLE[r.stock_status] || STATUS_STYLE.OK;
                      return (
                        <tr key={i}>
                          <td>
                            <p className="font-medium text-sm">{r.dealer_name}</p>
                            <span className={`badge text-xs ${r.dealer_tier === 1 ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>
                              {r.dealer_tier === 1 ? 'Tier 1' : 'Sub-Dealer'}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded bg-slate-100 overflow-hidden flex-shrink-0">
                                {r.image_url ? <img src={r.image_url} className="w-full h-full object-cover" /> : <Package size={14} className="text-slate-300 m-auto mt-2" />}
                              </div>
                              <div><p className="text-sm font-medium">{r.product_name}</p><p className="text-xs text-slate-400">{r.sku}</p></div>
                            </div>
                          </td>
                          <td className={`font-bold ${r.stock_status === 'OUT_OF_STOCK' ? 'text-red-600' : r.stock_status === 'LOW_STOCK' ? 'text-amber-600' : 'text-slate-900'}`}>{r.quantity}</td>
                          <td className="text-slate-500">{r.low_stock_threshold}</td>
                          <td><span className={`badge text-xs ${st.bg} ${st.text}`}>{st.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className="text-center py-16 text-slate-400"><Warehouse size={40} className="mx-auto mb-3 opacity-30" /><p className="font-medium">No dealer inventory found</p></div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Warehouse ─────────────────────────────────────────────────────── */}
      {tab === 'warehouse' && (
        <div className="card">
          {whLoading ? (
            <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" /></div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Warehouse Stock</th><th>Distributed</th><th>Total</th></tr></thead>
                <tbody>
                  {warehouse.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded bg-slate-100 overflow-hidden flex-shrink-0">
                            {p.image_url ? <img src={p.image_url} className="w-full h-full object-cover" /> : <Package size={14} className="text-slate-300 m-auto mt-2" />}
                          </div>
                          <span className="font-medium text-sm">{p.name}</span>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-slate-500">{p.sku}</td>
                      <td className="text-sm">{p.category}</td>
                      <td className="font-bold text-brand-600">{p.warehouse_stock}</td>
                      <td className="font-semibold text-purple-600">{p.total_dealer_stock}</td>
                      <td className="font-bold">{p.warehouse_stock + p.total_dealer_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Restock ───────────────────────────────────────────────────────── */}
      {tab === 'restock' && (
        <div className="card p-6 space-y-6">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Truck size={18} className="text-brand-600" /> Distribute Stock to Dealer</h3>
          <div>
            <label className="form-label">Select Dealer</label>
            <select value={selDealer} onChange={e => setSelDealer(e.target.value ? Number(e.target.value) : '')} className="form-input max-w-md">
              <option value="">Choose a dealer...</option>
              {dealers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.tier === 1 ? 'Tier 1' : 'Sub-Dealer'}) — {d.phone}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">Products</label>
              <button onClick={addRestockItem} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"><Plus size={14} /> Add Product</button>
            </div>
            {restockItems.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center border-2 border-dashed border-slate-200 rounded-xl">Click "Add Product" to start distributing stock</p>
            )}
            {restockItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <select value={item.product_id || ''} onChange={e => updateRestockItem(idx, 'product_id', Number(e.target.value))} className="form-input flex-1 text-sm">
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (warehouse: {p.warehouse_stock})</option>)}
                </select>
                <input type="number" min={1} value={item.quantity} onChange={e => updateRestockItem(idx, 'quantity', Number(e.target.value))} className="form-input w-24 text-sm text-center" placeholder="Qty" />
                <button onClick={() => removeRestockItem(idx)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Minus size={16} /></button>
              </div>
            ))}
          </div>
          {restockItems.length > 0 && (
            <div className="flex justify-end pt-3 border-t border-slate-200">
              <button onClick={submitRestock} disabled={restocking} className="btn-primary flex items-center gap-2">
                {restocking ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <ArrowRight size={16} />}
                {restocking ? 'Distributing...' : 'Distribute Stock'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Alerts ────────────────────────────────────────────────────────── */}
      {tab === 'alerts' && (
        <div className="space-y-3">
          {alerts.length === 0 ? (
            <div className="card p-12 text-center text-slate-400">
              <AlertTriangle size={48} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium text-lg">No low stock alerts</p>
              <p className="text-sm mt-1">All dealers are well-stocked.</p>
            </div>
          ) : alerts.map((a, i) => (
            <div key={i} className={`card p-4 flex items-center gap-4 border-l-4 ${a.stock_status === 'OUT_OF_STOCK' ? 'border-red-500' : 'border-amber-500'}`}>
              <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                {a.image_url ? <img src={a.image_url} className="w-full h-full object-cover" /> : <Package size={16} className="text-slate-300 m-auto mt-3" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{a.dealer_name} — {a.product_name}</p>
                <p className="text-xs text-slate-500">{a.sku} · Threshold: {a.low_stock_threshold}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xl font-extrabold ${a.stock_status === 'OUT_OF_STOCK' ? 'text-red-600' : 'text-amber-600'}`}>{a.quantity}</p>
                <p className="text-xs text-slate-400">remaining</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
