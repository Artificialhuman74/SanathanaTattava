import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth, consumerApi } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Star, Camera, X, CheckCircle2, ArrowLeft } from 'lucide-react';

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="p-1 transition-transform active:scale-90"
        >
          <Star
            size={36}
            className={
              n <= (hover || value)
                ? 'fill-amber-400 text-amber-400'
                : 'text-slate-200 fill-slate-200'
            }
          />
        </button>
      ))}
    </div>
  );
}

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function ReviewPage() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const { consumer } = useAuth();

  const token  = params.get('token');
  const pid    = params.get('pid');

  const [product,         setProduct]         = useState<{ id: number; name: string; image_url: string; category: string } | null>(null);
  const [consumerName,    setConsumerName]     = useState('');
  const [tokenValid,      setTokenValid]       = useState<boolean | null>(null);
  const [alreadyReviewed, setAlreadyReviewed]  = useState(false);
  const [canReview,       setCanReview]        = useState(false);
  const [loading,         setLoading]          = useState(true);
  const [submitting,      setSubmitting]       = useState(false);
  const [done,            setDone]             = useState(false);

  const [rating,  setRating]  = useState(0);
  const [body,    setBody]    = useState('');
  const [images,  setImages]  = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pid) { setLoading(false); return; }

    if (token) {
      // Token-based (from email link)
      consumerApi.get(`/consumer/review/validate?token=${token}&pid=${pid}`)
        .then(r => {
          setProduct(r.data.product);
          setConsumerName(r.data.consumer_name);
          setTokenValid(!r.data.already_reviewed);
          setAlreadyReviewed(r.data.already_reviewed);
          setCanReview(!r.data.already_reviewed);
        })
        .catch(() => setTokenValid(false))
        .finally(() => setLoading(false));
    } else if (consumer) {
      // Logged-in consumer
      Promise.all([
        consumerApi.get(`/consumer/products/${pid}/reviews`),
        consumerApi.get(`/consumer/review/check?pid=${pid}`),
      ]).then(([rev, chk]) => {
        // get product info from reviews response is not enough — fetch product separately
        setConsumerName(consumer.name);
        setCanReview(chk.data.can_review);
        setAlreadyReviewed(chk.data.already_reviewed);
        setTokenValid(true);
        // Fetch product info
        return consumerApi.get('/consumer/products', { params: { search: '' } })
          .then(r => {
            const p = (r.data.products || []).find((x: any) => String(x.id) === String(pid));
            if (p) setProduct({ id: p.id, name: p.name, image_url: p.image_url, category: p.category });
          });
      }).catch(() => setTokenValid(false))
        .finally(() => setLoading(false));
    } else {
      setTokenValid(false);
      setLoading(false);
    }
  }, [token, pid, consumer]);

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImages(imgs => [...imgs, reader.result as string].slice(0, 4));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const submit = async () => {
    if (!rating) { toast.error('Please select a star rating'); return; }
    setSubmitting(true);
    try {
      await consumerApi.post(`/consumer/products/${pid}/reviews`, {
        rating,
        body: body.trim() || undefined,
        images: images.length ? images : undefined,
        token: token || undefined,
      });
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!pid) {
    return <div className="p-6 text-center text-slate-500">Invalid review link.</div>;
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <CheckCircle2 size={52} className="text-brand-500" />
        <h2 className="text-xl font-bold text-slate-900">Thank you!</h2>
        <p className="text-slate-500 text-sm">Your review has been submitted successfully.</p>
        <button onClick={() => navigate('/shop')} className="mt-2 px-6 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors">
          Back to Shop
        </button>
      </div>
    );
  }

  if (alreadyReviewed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <CheckCircle2 size={44} className="text-slate-400" />
        <h2 className="text-lg font-bold text-slate-700">Already reviewed</h2>
        <p className="text-slate-500 text-sm">You've already left a review for this product.</p>
        <button onClick={() => navigate('/shop')} className="mt-2 px-6 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors">
          Back to Shop
        </button>
      </div>
    );
  }

  if (!canReview || tokenValid === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <div className="text-4xl">🔒</div>
        <h2 className="text-lg font-bold text-slate-700">
          {!consumer && !token ? 'Sign in to leave a review' : 'Purchase required'}
        </h2>
        <p className="text-slate-500 text-sm">
          {!consumer && !token
            ? 'Please log in to leave a review for this product.'
            : 'You can only review products you have purchased and received.'}
        </p>
        {!consumer && !token && (
          <button onClick={() => navigate('/shop/login')} className="mt-2 px-6 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm">
            Log In
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={16} /> Back
      </button>

      {/* Product card */}
      {product && (
        <div className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="w-16 h-16 rounded-xl object-contain bg-white flex-shrink-0" />
            : <div className="w-16 h-16 rounded-xl bg-slate-200 flex-shrink-0" />
          }
          <div className="min-w-0">
            <p className="text-xs text-brand-600 font-medium">{product.category}</p>
            <p className="font-semibold text-slate-900 text-sm leading-5">{product.name}</p>
            {consumerName && <p className="text-xs text-slate-400 mt-0.5">Reviewing as {consumerName}</p>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-5">
        <h2 className="font-bold text-slate-900 text-base">Write your review</h2>

        {/* Stars */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Your Rating</label>
          <StarPicker value={rating} onChange={setRating} />
          {rating > 0 && <p className="text-sm text-amber-600 font-medium">{LABELS[rating]}</p>}
        </div>

        {/* Text */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Your Review <span className="text-slate-400 font-normal normal-case">(optional)</span></label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-brand-300"
            placeholder="What did you think? Quality, taste, packaging, anything…"
          />
        </div>

        {/* Photo upload */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Photos <span className="text-slate-400 font-normal normal-case">(optional, up to 4)</span></label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={addImage} />
          <div className="flex gap-2 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative w-20 h-20">
                <img src={img} alt="" className="w-20 h-20 rounded-xl object-cover border border-slate-200" />
                <button
                  type="button"
                  onClick={() => setImages(imgs => imgs.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white flex items-center justify-center"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-400 hover:bg-slate-50 transition-colors"
              >
                <Camera size={20} />
                <span className="text-[10px]">Add photo</span>
              </button>
            )}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting || rating === 0}
          className="w-full py-3 bg-brand-600 text-white font-semibold rounded-xl text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting…' : 'Submit Review'}
        </button>
      </div>
    </div>
  );
}
