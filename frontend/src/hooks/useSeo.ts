import { useEffect } from 'react';

/**
 * Per-route SEO for the public consumer pages. The SPA serves one static
 * index.html (tuned for the homepage); this hook overrides the title,
 * meta description, and canonical link when a specific public route
 * mounts, then restores the homepage defaults on unmount so a later route
 * never inherits a stale title.
 *
 * Googlebot renders the page before snapshotting, so these client-set tags
 * are picked up for indexing. Social crawlers (WhatsApp/Facebook) don't run
 * JS, so Open Graph stays static in index.html for the most-shared page
 * (the homepage).
 */
const SITE = 'https://sanathanatattva.shop';
const DEFAULT_TITLE = 'Sanathana Tattva — Authentic Cold Pressed Oil | Pure & Natural';
const DEFAULT_DESC = 'Sanathana Tattva offers authentic cold pressed oil — coconut, sesame, groundnut and more — made with traditional wooden churners. 100% pure, chemical-free, delivered to your door.';

function upsertMetaByName(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

interface SeoOptions {
  title: string;
  description?: string;
  /** Path beginning with "/", e.g. "/shop". Becomes the canonical URL. */
  path?: string;
}

export function useSeo({ title, description, path }: SeoOptions) {
  useEffect(() => {
    document.title = title;
    if (description) upsertMetaByName('description', description);
    setCanonical(path ? `${SITE}${path}` : `${SITE}/`);

    return () => {
      document.title = DEFAULT_TITLE;
      upsertMetaByName('description', DEFAULT_DESC);
      setCanonical(`${SITE}/`);
    };
  }, [title, description, path]);
}
