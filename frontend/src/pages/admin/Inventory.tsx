import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import {
  Plus, Search, Edit2, Trash2, Package, AlertTriangle, X,
  Image, ChevronDown, CheckCircle2,
} from 'lucide-react';

interface Product {
  id: number; name: string; description: string; category: string; sku: string;
  price: number; cost_price: number; stock: number; min_stock: number;
  image_url: string; unit: string; status: string; created_at: string;
}

const UNITS    = ['piece','kg','litre','set','pair','box','bottle','tin','pack'];
const EMPTY: Partial<Product> = {
  name: '', description: '', category: '', sku: '', price: 0,
  cost_price: 0, stock: 0, min_stock: 10, image_url: '', unit: 'piece', status: 'active',
};

export default function AdminInventory() {
  const [products,    setProducts]    = useState<Product[]>([]);
  const [categories,  setCategories]  = useState<string[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [catFilter,   setCatFilter]   = useState('');
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState<Product | null>(null);
  const [form,        setForm]        = useState<Partial<Product>>(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState<number | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)    params.search   = search;
    if (catFilter) params.category = catFilter;
    api.get('/admin/products', { params })
      .then(r => { setProducts(r.data.products); setCategories(r.data.categories); })
      .finally(() => setLoading(false));
  }, [search, catFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  const openNew  = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (p: Product) => { setEditing(p); setForm({ ...p }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(EMPTY); };

  const set = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: ['price','cost_price','stock','min_stock'].includes(k) ? Number(e.target.value) : e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.sku || !form.category || form.price == null) {
      toast.error('Please fill in all required fields'); return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/admin/products/${editing.id}`, form);
        toast.success('Product updated');
      } else {
        await api.post('/admin/products', form);
        toast.success('Product created');
      }
      closeModal(); fetch();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Archive this product? It will be hidden from traders.')) return;
    setDeleting(id);
    try {
      await api.delete(`/admin/products/${id}`);
      toast.success('Product archived');
      fetch();
    } catch { toast.error('Failed to archive'); }
    finally { setDeleting(null); }
  };

  const lowStockCount = products.filter(p => p.stock <= p.min_stock).length;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-slate-900">Inventory</h2>
          <p className="text-slate-500 text-sm mt-0.5">{products.length} products · {lowStockCount > 0 && <span className="text-amber-600 font-medium">{lowStockCount} low stock</span>}</p>
        </div>
        <button onClick={openNew} className="btn-primary">
          <Plus size={16} /> Add Product
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="form-input pl-9" placeholder="Search products..." />
        </div>
        <div className="relative">
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="form-input pr-8 appearance-none min-w-36">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
        </div>
      </div>

      {/* Alert */}
      {lowStockCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
          <AlertTriangle size={15} />
          <span className="font-medium">{lowStockCount} product(s) are running low on stock</span>
        </div>
      )}

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-brand-600" />
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden">
                          {p.image_url
                            ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                            : <Package className="w-5 h-5 text-slate-400 m-auto mt-2.5" />
                          }
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate max-w-xs">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td><span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{p.sku}</span></td>
                    <td><span className="badge bg-slate-100 text-slate-600">{p.category}</span></td>
                    <td className="font-semibold">${p.price.toFixed(2)}</td>
                    <td>
                      <span className={`font-semibold ${p.stock <= p.min_stock ? 'text-red-600' : 'text-slate-900'}`}>
                        {p.stock}
                        {p.stock <= p.min_stock && <span className="text-red-400 text-xs ml-1">(low)</span>}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(p)} className="btn-ghost p-2 text-slate-500 hover:text-brand-600">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id} className="btn-ghost p-2 text-slate-500 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {products.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <Package size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No products found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-lg">{editing ? 'Edit Product' : 'Add New Product'}</h3>
              <button onClick={closeModal} className="btn-ghost p-2"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {/* Image Preview */}
              {form.image_url && (
                <div className="relative w-full h-36 rounded-xl overflow-hidden bg-slate-100">
                  <img src={form.image_url} alt="Preview" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">Product Name <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name || ''} onChange={set('name')} className="form-input" placeholder="e.g. Premium Wireless Headphones" required />
                </div>
                <div>
                  <label className="form-label">SKU <span className="text-red-500">*</span></label>
                  <input type="text" value={form.sku || ''} onChange={set('sku')} className="form-input font-mono uppercase" placeholder="e.g. ELEC-001" required />
                </div>
                <div>
                  <label className="form-label">Category <span className="text-red-500">*</span></label>
                  <input type="text" value={form.category || ''} onChange={set('category')} className="form-input" placeholder="e.g. Electronics" required list="cat-list" />
                  <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="form-label">Price ($) <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={form.price || ''} onChange={set('price')} className="form-input" placeholder="0.00" required />
                </div>
                <div>
                  <label className="form-label">Cost Price ($)</label>
                  <input type="number" min="0" step="0.01" value={form.cost_price || ''} onChange={set('cost_price')} className="form-input" placeholder="0.00" />
                </div>
                <div>
                  <label className="form-label">Stock Quantity <span className="text-red-500">*</span></label>
                  <input type="number" min="0" value={form.stock ?? ''} onChange={set('stock')} className="form-input" placeholder="0" required />
                </div>
                <div>
                  <label className="form-label">Min Stock Alert</label>
                  <input type="number" min="0" value={form.min_stock ?? ''} onChange={set('min_stock')} className="form-input" placeholder="10" />
                </div>
                <div>
                  <label className="form-label">Unit</label>
                  <select value={form.unit || 'piece'} onChange={set('unit')} className="form-input">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select value={form.status || 'active'} onChange={set('status')} className="form-input">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label flex items-center gap-1.5"><Image size={14} /> Image URL</label>
                  <input type="url" value={form.image_url || ''} onChange={set('image_url')} className="form-input" placeholder="https://..." />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label">Description</label>
                  <textarea value={form.description || ''} onChange={set('description')} className="form-input resize-none" rows={3} placeholder="Product description..." />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <CheckCircle2 size={15} />}
                  {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
