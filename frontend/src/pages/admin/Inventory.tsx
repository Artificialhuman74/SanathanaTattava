import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  Plus, Search, Edit2, Trash2, Package, AlertTriangle, X,
  Upload, ChevronDown, CheckCircle2, ImageIcon, CropIcon,
} from 'lucide-react';

interface Product {
  id: number; name: string; description: string; category: string; sku: string;
  price: number; cost_price: number; stock: number; min_stock: number;
  image_url: string; unit: string; status: string; created_at: string;
}

const UNITS = ['piece','kg','litre','set','pair','box','bottle','tin','pack'];
const EMPTY: Partial<Product> = {
  name: '', description: '', category: '', sku: '', price: 0,
  cost_price: 0, stock: 0, min_stock: 10, image_url: '', unit: 'piece', status: 'active',
};

export default function AdminInventory() {
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [catFilter,  setCatFilter]  = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<Product | null>(null);
  const [form,       setForm]       = useState<Partial<Product>>(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [deleting,   setDeleting]   = useState<number | null>(null);

  // Image crop state
  const [cropSrc,        setCropSrc]        = useState<string | null>(null);
  const [crop,           setCrop]           = useState<Crop>({ unit: '%', width: 90, height: 90, x: 5, y: 5 });
  const [completedCrop,  setCompletedCrop]  = useState<PixelCrop | null>(null);
  const [croppingActive, setCroppingActive] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params: any = {};
    if (search)    params.search   = search;
    if (catFilter) params.category = catFilter;
    api.get('/admin/products', { params })
      .then(r => { setProducts(r.data.products); setCategories(r.data.categories); })
      .finally(() => setLoading(false));
  }, [search, catFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const openNew  = () => { setEditing(null); setForm(EMPTY); setShowModal(true); };
  const openEdit = (p: Product) => { setEditing(p); setForm({ ...p }); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditing(null); setForm(EMPTY); setCropSrc(null); };

  const set = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: ['price','cost_price','stock','min_stock'].includes(k) ? Number(e.target.value) : e.target.value }));

  // ── Image upload & crop ───────────────────────────────────────────────────
  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setCroppingActive(true);
      // Reset crop to full image
      setCrop({ unit: '%', width: 90, height: 90, x: 5, y: 5 });
      setCompletedCrop(null);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const applyCrop = () => {
    if (!imgRef.current || !completedCrop || completedCrop.width === 0) {
      // No crop drawn — use full image
      setForm(f => ({ ...f, image_url: cropSrc! }));
      setCroppingActive(false);
      setCropSrc(null);
      return;
    }
    const image = imgRef.current;
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const size = Math.min(completedCrop.width, completedCrop.height); // keep square
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0, 0, 800, 800
    );
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setForm(f => ({ ...f, image_url: dataUrl }));
    setCroppingActive(false);
    setCropSrc(null);
    toast.success('Image cropped and ready!');
  };

  const cancelCrop = () => {
    setCroppingActive(false);
    setCropSrc(null);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
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
      closeModal(); fetchProducts();
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
      fetchProducts();
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
          <p className="text-slate-500 text-sm mt-0.5">
            {products.length} products
            {lowStockCount > 0 && <> · <span className="text-amber-600 font-medium">{lowStockCount} low stock</span></>}
          </p>
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
                  <th>Product</th><th>SKU</th><th>Category</th>
                  <th>Price</th><th>Stock</th><th>Status</th><th>Actions</th>
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
                          <p className="text-xs text-slate-400 truncate max-w-xs">{p.description || p.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td><span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{p.sku}</span></td>
                    <td><span className="badge bg-slate-100 text-slate-600">{p.category}</span></td>
                    <td className="font-semibold">₹{p.price.toFixed(2)}</td>
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
                        <button onClick={() => openEdit(p)} className="btn-ghost p-2 text-slate-500 hover:text-brand-600"><Edit2 size={14} /></button>
                        <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id} className="btn-ghost p-2 text-slate-500 hover:text-red-600"><Trash2 size={14} /></button>
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

      {/* ── Crop Modal ──────────────────────────────────────────────────────── */}
      {croppingActive && cropSrc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={cancelCrop} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CropIcon size={16} className="text-brand-600" />
                <h3 className="font-bold text-slate-900">Crop Image</h3>
              </div>
              <button onClick={cancelCrop} className="btn-ghost p-2"><X size={18} /></button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center min-h-64">
              <ReactCrop
                crop={crop}
                onChange={c => setCrop(c)}
                onComplete={c => setCompletedCrop(c)}
                aspect={1}
                className="max-h-96"
              >
                <img
                  ref={imgRef}
                  src={cropSrc}
                  alt="Crop"
                  style={{ maxHeight: '380px', maxWidth: '100%' }}
                />
              </ReactCrop>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button onClick={cancelCrop} className="btn-secondary flex-1">Cancel</button>
              <button onClick={applyCrop} className="btn-primary flex-1">
                <CheckCircle2 size={15} /> Use This Crop
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-lg">{editing ? 'Edit Product' : 'Add New Product'}</h3>
              <button onClick={closeModal} className="btn-ghost p-2"><X size={18} /></button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-5">

              {/* ── Image section ───────────────────────────────────────── */}
              <div>
                <label className="form-label mb-2">Product Image</label>
                <div className="flex gap-4 items-start">
                  {/* Preview */}
                  <div className="w-28 h-28 rounded-xl bg-slate-100 flex-shrink-0 overflow-hidden border-2 border-dashed border-slate-200 flex items-center justify-center">
                    {form.image_url
                      ? <img src={form.image_url} alt="Preview" className="w-full h-full object-cover" />
                      : <div className="flex flex-col items-center gap-1 text-slate-300">
                          <ImageIcon size={28} />
                          <span className="text-xs">No image</span>
                        </div>
                    }
                  </div>

                  {/* Upload controls */}
                  <div className="flex-1 space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={onFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-brand-300 rounded-xl text-brand-600 font-medium text-sm hover:bg-brand-50 transition-colors"
                    >
                      <Upload size={16} />
                      Upload & Crop Image
                    </button>
                    <p className="text-xs text-slate-400 text-center">
                      JPG, PNG, WebP · Square crop recommended
                    </p>
                    {form.image_url && (
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                        className="w-full text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Fields ──────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="form-label">Product Name <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name || ''} onChange={set('name')} className="form-input" placeholder="e.g. Cold Pressed Coconut Oil" required />
                </div>

                {/* Description — full width, prominent */}
                <div className="sm:col-span-2">
                  <label className="form-label">Description</label>
                  <textarea
                    value={form.description || ''}
                    onChange={set('description')}
                    className="form-input resize-none"
                    rows={4}
                    placeholder="Describe the product — ingredients, benefits, how to use, shelf life…"
                  />
                  <p className="text-xs text-slate-400 mt-1">This is shown to customers on the shop page.</p>
                </div>

                <div>
                  <label className="form-label">SKU <span className="text-red-500">*</span></label>
                  <input type="text" value={form.sku || ''} onChange={set('sku')} className="form-input font-mono uppercase" placeholder="e.g. OIL-001" required />
                </div>
                <div>
                  <label className="form-label">Category <span className="text-red-500">*</span></label>
                  <input type="text" value={form.category || ''} onChange={set('category')} className="form-input" placeholder="e.g. Oils" required list="cat-list" />
                  <datalist id="cat-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label className="form-label">Price (₹) <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={form.price || ''} onChange={set('price')} className="form-input" placeholder="0.00" required />
                </div>
                <div>
                  <label className="form-label">Cost Price (₹)</label>
                  <input type="number" min="0" step="0.01" value={form.cost_price || ''} onChange={set('cost_price')} className="form-input" placeholder="0.00" />
                </div>
                <div>
                  <label className="form-label">Stock Quantity <span className="text-red-500">*</span></label>
                  <input type="number" min="0" value={form.stock ?? ''} onChange={set('stock')} className="form-input" placeholder="0" required />
                </div>
                <div>
                  <label className="form-label">Low Stock Alert</label>
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
