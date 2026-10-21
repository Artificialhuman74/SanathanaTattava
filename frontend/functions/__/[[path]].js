// Cloudflare Pages: Firebase's sign-in helper (/__/auth/*, /__/firebase/*) served from our own
// domain, as the /__/* rule in netlify.toml does on Netlify (the note there says why: the Google
// sign-in window has to finish on a same-origin page). Pages can't proxy from _redirects, so this
// small function forwards the request instead.
export async function onRequest({ request }) {
  const url = new URL(request.url);
  const upstream = `https://sanathanatattva.firebaseapp.com${url.pathname}${url.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const res = await fetch(upstream, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });
  return new Response(res.body, res);
}
