import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  Plus, Search, Edit2, Trash2, Package, AlertTriangle, X,
  Upload, ChevronDown, CheckCircle2, CropIcon,
} from 'lucide-react';

interface Product {
  id: number; name: string; description: string; category: string; sku: string;
  price: number; cost_price: number; stock: number; min_stock: number;
  image_url: string; image_urls?: string | null; unit: string; status: string; created_at: string;
}

const UNITS = ['piece','kg','litre','set','pair','box','bottle','tin','pack'];
const EMPTY: Partial<Product> = {
  name: '', description: '', category: '', sku: '', price: 0,
  cost_price: 0, stock: 0, min_stock: 10, image_url: '', image_urls: '', unit: 'piece', status: 'active',
};

function parseImageUrls(raw?: string | null): string[] {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map(v => String(v || '').trim())
        .filter(Boolean);
    }
  } catch {
    // Not JSON, fallback to line/comma parsing.
  }

  if (text.includes('\n')) {
    return text.split('\n').map(v => v.trim()).filter(Boolean);
  }
  if (!text.startsWith('data:') && text.includes(',')) {
    return text.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [text];
}

function dedupeImages(images: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  images.forEach((img) => {
    const v = img.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function getProductImages(p?: Partial<Product> | null): string[] {
  if (!p) return [];
  const fromList = parseImageUrls(p.image_urls || '');
  const list = dedupeImages([p.image_url || '', ...fromList]);
  return list;
}

function getPrimaryImage(p?: Partial<Product> | null): string {
  return getProductImages(p)[0] || '';
}

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
  const [additionalImages, setAdditionalImages] = useState<string[]>([]);

  // Image crop state
  const [cropSrc,        setCropSrc]        = useState<string | null>(null);
  const [crop,           setCrop]           = useState<Crop>({ unit: '%', width: 90, height: 90, x: 5, y: 5 });
  const [completedCrop,  setCompletedCrop]  = useState<PixelCrop | null>(null);
  const [croppingActive, setCroppingActive] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropTargetRef = useRef<'primary' | number>('primary');

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

  const openNew  = () => {
    setEditing(null);
    setForm(EMPTY);
    setAdditionalImages([]);
    setShowModal(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    const images = getProductImages(p);
    setForm({ ...p, image_url: images[0] || '' });
    setAdditionalImages(images.slice(1));
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY);
    setAdditionalImages([]);
    setCropSrc(null);
  };

  const set = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: ['price','cost_price','stock','min_stock'].includes(k) ? Number(e.target.value) : e.target.value }));

  // ── Image upload & crop ───────────────────────────────────────────────────
  const triggerUpload = (target: 'primary' | number) => {
    cropTargetRef.current = target;
    fileInputRef.current?.click();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setCroppingActive(true);
      setCrop({ unit: '%', width: 90, height: 90, x: 5, y: 5 });
      setCompletedCrop(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const applyCrop = () => {
    const target = cropTargetRef.current;
    let dataUrl = cropSrc!;
    if (imgRef.current && completedCrop && completedCrop.width > 0) {
      const image = imgRef.current;
      const canvas = document.createElement('canvas');
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      canvas.width = 800;
      canvas.height = 800;
      canvas.getContext('2d')!.drawImage(
        image,
        completedCrop.x * scaleX, completedCrop.y * scaleY,
        completedCrop.width * scaleX, completedCrop.height * scaleY,
        0, 0, 800, 800
      );
      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }
    if (target === 'primary') {
      setForm(f => ({ ...f, image_url: dataUrl }));
    } else {
      setAdditionalImages(imgs => {
        const next = [...imgs];
        if (target >= next.length) next.push(dataUrl);
        else next[target] = dataUrl;
        return next;
      });
    }
    setCroppingActive(false);
    setCropSrc(null);
    toast.success('Image ready!');
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
      const allImages = dedupeImages([String(form.image_url || '').trim(), ...additionalImages.filter(Boolean)]).slice(0, 12);
      const payload = {
        ...form,
        image_url: allImages[0] || null,
        image_urls: allImages.length ? JSON.stringify(allImages) : null,
      };

      if (editing) {
        await api.put(`/admin/products/${editing.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/admin/products', payload);
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
                          {getPrimaryImage(p)
                            ? <img src={getPrimaryImage(p)} alt={p.name} className="w-full h-full object-cover" />
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
                <label className="form-label mb-2">Product Images</label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileSelect} className="hidden" />

                {/* Image grid: primary + additional slots */}
                <div className="flex flex-wrap gap-3">
                  {/* Primary image slot */}
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => triggerUpload('primary')}
                      className="w-24 h-24 rounded-xl bg-slate-100 overflow-hidden border-2 border-dashed border-brand-300 flex items-center justify-center hover:bg-brand-50 transition-colors relative group"
                    >
                      {form.image_url
                        ? <>
                            <img src={form.image_url} alt="Primary" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <CropIcon size={18} className="text-white" />
                            </div>
                          </>
                        : <div className="flex flex-col items-center gap-1 text-brand-400">
                            <Upload size={20} />
                            <span className="text-[10px] font-medium">Add Photo</span>
                          </div>
                      }
                    </button>
                    <span className="text-[10px] text-slate-400">Cover</span>
                    {form.image_url && (
                      <button type="button" onClick={() => setForm(f => ({ ...f, image_url: '' }))} className="text-[10px] text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>

                  {/* Additional image slots */}
                  {additionalImages.map((img, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => triggerUpload(idx)}
                        className="w-24 h-24 rounded-xl bg-slate-100 overflow-hidden border-2 border-dashed border-slate-300 flex items-center justify-center hover:bg-slate-200 transition-colors relative group"
                      >
                        {img
                          ? <>
                              <img src={img} alt={`Image ${idx + 2}`} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <CropIcon size={18} className="text-white" />
                              </div>
                            </>
                          : <div className="flex flex-col items-center gap-1 text-slate-400">
                              <Upload size={20} />
                              <span className="text-[10px]">Add Photo</span>
                            </div>
                        }
                      </button>
                      <span className="text-[10px] text-slate-400">Photo {idx + 2}</span>
                      <button
                        type="button"
                        onClick={() => setAdditionalImages(imgs => imgs.filter((_, i) => i !== idx))}
                        className="text-[10px] text-red-400 hover:text-red-600"
                      >Remove</button>
                    </div>
                  ))}

                  {/* Add another photo button */}
                  {additionalImages.length < 7 && (
                    <div className="flex flex-col items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAdditionalImages(imgs => [...imgs, '']);
                          // Trigger upload for the new slot after state updates
                          setTimeout(() => triggerUpload(additionalImages.length), 50);
                        }}
                        className="w-24 h-24 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors text-slate-400"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <Plus size={22} />
                          <span className="text-[10px]">Add</span>
                        </div>
                      </button>
                      <span className="text-[10px] text-slate-400">More</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-2">Up to 8 images · JPG, PNG, WebP · Tap any photo to re-crop</p>
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
