/** Streaming apps on Fire OS and how to open a title in each. Commands come from docs/PLAN.md §2.4. */
export const APPS = {
  youtube: { name: 'YouTube', package: 'com.amazon.firetv.youtube' },
  netflix: { name: 'Netflix', package: 'com.netflix.ninja' },
  prime: { name: 'Prime Video', package: 'com.amazon.firebat' },
};

const SHORT_LINK_HOSTS = new Set(['amzn.in', 'amzn.to', 'a.co', 'amzn.eu']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const PRIME_GTI = /^amzn1\.dv\.gti\.[0-9a-f-]{36}$/;
const PRIME_ID = /^[A-Z0-9]{10,40}$/;

export class LinkError extends Error {}
const reject = () => { throw new LinkError('Paste a YouTube, Netflix or Prime Video link.'); };

function host(url) { return url.hostname.toLowerCase().replace(/^(www|m)\./, ''); }

/** Turns a pasted or shared link into `{app, contentId}`; throws LinkError for anything else. */
export function parseLink(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { reject(); }
  if (!['https:', 'http:'].includes(url.protocol)) reject();
  const name = host(url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (name === 'youtube.com' || name === 'youtu.be' || name === 'music.youtube.com') {
    const id = name === 'youtu.be' ? segments[0]
      : ['shorts', 'live', 'embed'].includes(segments[0]) ? segments[1]
      : url.searchParams.get('v');
    if (id && YOUTUBE_ID.test(id)) return { app: 'youtube', contentId: id };
  }
  if (name === 'netflix.com') {
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:title|watch)\/(\d{4,12})\/?$/i.exec(url.pathname);
    if (match) return { app: 'netflix', contentId: match[1] };
  }
  if (name.endsWith('primevideo.com') || /^amazon\.(in|com|co\.uk|de|ca|com\.au)$/.test(name)) {
    const gti = url.searchParams.get('gti');
    if (gti && PRIME_GTI.test(gti)) return { app: 'prime', contentId: gti };
    const index = segments.findIndex((segment) => segment === 'detail' || segment === 'dp');
    const id = index >= 0 ? segments[index + 1] : null;
    if (id && PRIME_ID.test(id)) return { app: 'prime', contentId: id };
  }
  return reject();
}

/** Follows redirects for Amazon short links (amzn.in/d/…) before parsing; other links are parsed directly. */
export async function resolveLink(value, fetchImpl = fetch) {
  let current = String(value).trim();
  for (let hop = 0; hop < 5; hop++) {
    let url;
    try { url = new URL(current); } catch { reject(); }
    if (!SHORT_LINK_HOSTS.has(host(url))) return parseLink(current);
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const next = response.headers.get('location');
    if (!next) reject();
    current = new URL(next, url).href;
  }
  return reject();
}

/** Picture for a saved show, where one is freely available. */
export function showImage({ app, contentId }) {
  return app === 'youtube' ? `https://i.ytimg.com/vi/${contentId}/hqdefault.jpg` : null;
}

/** The Android intent that opens a title. Shared by the ADB bridge and the TV app. */
export function launchFor({ app, contentId }) {
  if (app === 'youtube') {
    return { action: 'android.intent.action.VIEW', data: `https://www.youtube.com/watch?v=${contentId}`, package: APPS.youtube.package };
  }
  if (app === 'netflix') {
    return {
      component: 'com.netflix.ninja/.MainActivity', action: 'android.intent.action.VIEW',
      data: `netflix://title/${contentId}`, flags: 0x10000020, extras: { amzn_deeplink_data: contentId },
      // Netflix ignores deep links while it is already running.
      forceStop: APPS.netflix.package,
    };
  }
  if (app === 'prime') {
    const data = contentId.startsWith('amzn1.dv.gti.')
      ? `https://app.primevideo.com/detail?gti=${contentId}`
      : `https://app.primevideo.com/detail/${contentId}`;
    return { component: 'com.amazon.firebat/com.amazon.firebatcore.deeplink.DeepLinkRoutingActivity', action: 'android.intent.action.VIEW', data };
  }
  throw new LinkError('Unsupported app.');
}
