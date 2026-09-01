import React, { useEffect, useId, useRef, useState } from 'react';

type MediaType = 'image' | 'video';
type Reveal = 'wipe' | 'fade' | 'rise' | 'none';
type Trigger = 'view' | 'mount';

interface MaskedHeadingProps {
  /** The words. Rendered as real text for assistive tech, whatever the fill does. */
  text: string;
  /** Image or video URL. A data URI works too. */
  src: string;
  mediaType?: MediaType;
  /** Poster frame for video — also the fill before the video can play. */
  poster?: string;
  /** How far the fill is zoomed inside the letters. 1 = cover. */
  fillScale?: number;
  /** Pixels of drift the fill takes as the heading crosses the viewport. */
  parallax?: number;
  reveal?: Reveal;
  /**
   * Milliseconds between words. When set, the heading animates in word by word
   * and takes precedence over `reveal` — the two together read as fussy.
   * The fill stays put while the words move through it, which is the point.
   */
  stagger?: number;
  /** 'view' waits until the heading is scrolled into frame; 'mount' plays at once. */
  trigger?: Trigger;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'div';
  className?: string;
  /** Merged last, so callers can adjust the painted fill (filters, blend). */
  style?: React.CSSProperties;
  /**
   * Colour used when the fill cannot be shown — reduced motion on video,
   * a failed load, or a browser without background-clip: text. Text is never
   * left invisible, so this must be a colour that reads on the surface behind.
   */
  fallbackColor?: string;
}

/**
 * A heading whose letters are filled with an image or a video.
 *
 * Two rules this component refuses to break:
 *
 *  1. The text is always real text in the DOM. Screen readers, find-in-page and
 *     copy-paste all work; the fill is presentation only.
 *  2. It never renders invisible. `color: transparent` is applied only once the
 *     fill is confirmed — feature-detected, and for images only after the file
 *     has actually loaded. Anything else and a failed request leaves a heading
 *     that is present, focusable, and completely unreadable.
 *
 * Contrast is the caller's job and it is not optional: a fill has to clear 3:1
 * against what is behind it, and a busy fill is much harder to read than its
 * average colour suggests. Dim the ground or pick a quieter fill.
 */
export default function MaskedHeading({
  text,
  src,
  mediaType = 'image',
  poster,
  fillScale = 1,
  parallax = 0,
  reveal = 'wipe',
  stagger = 0,
  trigger = 'mount',
  as: Tag = 'h1',
  className = '',
  style,
  fallbackColor = 'currentColor',
}: MaskedHeadingProps) {
  const hostRef = useRef<HTMLElement>(null);
  const [fillReady, setFillReady] = useState(false);
  const [revealed, setRevealed] = useState(trigger === 'mount');
  const [offset, setOffset] = useState(0);
  const reduced = useRef(false);
  const maskId = useId().replace(/:/g, '');
  const words = text.split(' ');
  // Per-word fills are a compromise the animation forces: a transformed child
  // breaks the parent's background-clip. But a narrow word ("1.") then samples
  // a nearly flat slice of the texture and washes out. So the split lasts only
  // as long as the movement does — once every word has landed the fill returns
  // to the parent and reads as one continuous surface.
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // ── confirm the fill before hiding the glyph colour ──
  useEffect(() => {
    const clipOK =
      typeof CSS !== 'undefined' &&
      (CSS.supports('-webkit-background-clip', 'text') || CSS.supports('background-clip', 'text'));
    if (!clipOK) { setFillReady(false); return; }

    if (mediaType === 'image') {
      let alive = true;
      const img = new Image();
      img.onload = () => { if (alive) setFillReady(true); };
      img.onerror = () => { if (alive) setFillReady(false); };
      img.src = src;
      return () => { alive = false; };
    }
    // Video fills paint through the same background-clip path via the poster
    // until the element is playing; without a poster there is nothing to show
    // until the first frame, so hold the solid colour until then.
    setFillReady(Boolean(poster));
  }, [src, poster, mediaType]);

  useEffect(() => {
    if (!revealed || stagger <= 0 || reduced.current) return;
    const total = (words.length - 1) * stagger + 800;
    const id = setTimeout(() => setLanded(true), total);
    return () => clearTimeout(id);
  }, [revealed, stagger, words.length]);

  // ── trigger ──
  useEffect(() => {
    if (trigger !== 'view') return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setRevealed(true); return; }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { setRevealed(true); io.disconnect(); } },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [trigger]);

  // ── parallax: drift the fill as the heading crosses the viewport ──
  useEffect(() => {
    if (!parallax || reduced.current) return;
    const el = hostRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        // -1 when the heading sits at the bottom of the viewport, +1 at the top.
        const progress = 1 - 2 * ((r.top + r.height / 2) / window.innerHeight);
        setOffset(progress * parallax);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [parallax]);

  const staggered = stagger > 0 && !reduced.current && !landed;
  const animate = revealed && !reduced.current && reveal !== 'none';
  const clip =
    !staggered && reveal === 'wipe' ? (animate ? 'inset(0 -0.12em 0 0)' : 'inset(0 100% 0 0)') : undefined;

  const fillStyle: React.CSSProperties = fillReady
    ? {
        backgroundImage: `url("${mediaType === 'video' ? poster ?? src : src}")`,
        backgroundSize: `${Math.max(100, fillScale * 100)}% auto`,
        backgroundPosition: `center calc(50% + ${offset}px)`,
        backgroundRepeat: 'no-repeat',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }
    : { color: fallbackColor };

  const motionStyle: React.CSSProperties =
    reduced.current || reveal === 'none' || staggered
      ? {}
      : {
          clipPath: clip,
          opacity: reveal === 'fade' ? (revealed ? 1 : 0) : 1,
          transform: reveal === 'rise' ? `translateY(${revealed ? 0 : 14}px)` : undefined,
          transition:
            'clip-path 900ms cubic-bezier(0.16, 1, 0.3, 1), opacity 700ms ease, transform 800ms cubic-bezier(0.16, 1, 0.3, 1)',
        };

  // ── video fill ──
  // CSS backgrounds cannot reference a video element, so background-clip has
  // no way to do this. The video is laid over the text and punched out by an
  // SVG mask built from the same string, with the font copied off the rendered
  // heading so the mask lines up exactly. Under reduced motion, or if masking
  // is unsupported, this whole branch is skipped and the poster fill (or the
  // solid colour) above stands in.
  const [font, setFont] = useState<{ size: string; weight: string; family: string; height: number } | null>(null);
  useEffect(() => {
    if (mediaType !== 'video') return;
    const el = hostRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setFont({
      size: cs.fontSize,
      weight: cs.fontWeight,
      family: cs.fontFamily,
      height: el.getBoundingClientRect().height,
    });
  }, [mediaType, text]);

  const maskOK =
    typeof CSS !== 'undefined' &&
    (CSS.supports('-webkit-mask-image', 'url(#a)') || CSS.supports('mask-image', 'url(#a)'));
  const useVideoMask = mediaType === 'video' && maskOK && !reduced.current && Boolean(font);

  return (
    <Tag
      ref={hostRef as React.Ref<never>}
      className={`relative ${className}`}
      style={{
        ...(useVideoMask ? { color: 'transparent' } : staggered ? {} : fillStyle),
        ...motionStyle,
        ...style,
      }}
    >
      {staggered
        ? words.map((word, i) => (
            <span
              key={`${word}-${i}`}
              // inline-block so transform applies; the trailing space is kept
              // outside the span so words still wrap and copy normally.
              className="inline-block will-change-transform"
              style={{
                // Each word carries its own fill. With the fill on the parent
                // instead, a transformed or filtered child is composited
                // separately and the parent's background-clip: text no longer
                // clips to those glyphs — the heading renders blank. The
                // texture is abstract, so per-word origins are invisible.
                ...fillStyle,
                // Word gaps come from margin, not a non-breaking space. NBSP
                // preserves the gap but also forbids the line break, so a long
                // heading runs straight off the side of its container.
                marginRight: i < words.length - 1 ? '0.26em' : undefined,
                opacity: revealed ? 1 : 0,
                transform: revealed ? 'none' : 'translateY(0.42em) scale(0.94)',
                filter: revealed ? 'blur(0)' : 'blur(6px)',
                transition: `opacity 620ms cubic-bezier(0.16, 1, 0.3, 1) ${i * stagger}ms,
                             transform 760ms cubic-bezier(0.16, 1, 0.3, 1) ${i * stagger}ms,
                             filter 620ms cubic-bezier(0.16, 1, 0.3, 1) ${i * stagger}ms`,
              }}
            >
              {word}
            </span>
          ))
        : text}

      {useVideoMask && font && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden"
            style={{
              WebkitMaskImage: `url(#${maskId})`,
              maskImage: `url(#${maskId})`,
            }}
          >
            <video
              src={src}
              poster={poster}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
              style={{ transform: `scale(${Math.max(1, fillScale)}) translateY(${offset}px)` }}
            />
          </span>
          <svg width="0" height="0" aria-hidden="true" className="absolute">
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse">
                <text
                  x="50%"
                  y={font.height * 0.74}
                  textAnchor="middle"
                  fill="#fff"
                  style={{ fontSize: font.size, fontWeight: font.weight, fontFamily: font.family }}
                >
                  {text}
                </text>
              </mask>
            </defs>
          </svg>
        </>
      )}
    </Tag>
  );
}
