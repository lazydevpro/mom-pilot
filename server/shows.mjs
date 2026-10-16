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

/**
 * Turns a link into `{app, contentId}`, following Amazon short links (amzn.in/d/…) first.
 * Prime Video share links carry a web title ID, but the Fire TV app only opens a title by its
 * gti, so that is looked up from the title's public page.
 */
export async function resolveLink(value, fetchImpl = fetch) {
  let current = String(value).trim();
  for (let hop = 0; hop < 5; hop++) {
    let url;
    try { url = new URL(current); } catch { reject(); }
    if (!SHORT_LINK_HOSTS.has(host(url))) {
      const parsed = parseLink(current);
      if (parsed.app === 'prime' && !PRIME_GTI.test(parsed.contentId)) return { app: 'prime', contentId: await primeGti(parsed.contentId, fetchImpl) };
      return parsed;
    }
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const next = response.headers.get('location');
    if (!next) reject();
    current = new URL(next, url).href;
  }
  return reject();
}

/** The title's own gti is the one its page mentions most; related titles appear only a few times each. */
export function mostMentionedGti(html) {
  const counts = new Map();
  for (const [gti] of html.matchAll(/amzn1\.dv\.gti\.[0-9a-f-]{36}/g)) counts.set(gti, (counts.get(gti) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function primeGti(id, fetchImpl) {
  let html = '';
  try {
    const response = await fetchImpl(`https://www.primevideo.com/detail/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept-Language': 'en-IN,en;q=0.9' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) html = await response.text();
  } catch { /* Reported below. */ }
  const gti = mostMentionedGti(html);
  if (!gti) throw new LinkError('Couldn’t look up this Prime Video title. Check the link and try again.');
  return gti;
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
    // Verified on Fire OS 7.7.1.7: starts (or resumes) playback straight away.
    // https://app.primevideo.com/detail?gti=… only opens the title's page.
    if (!PRIME_GTI.test(contentId)) throw new LinkError('Save this Prime Video show again so it can be looked up.');
    return { action: 'android.intent.action.VIEW', data: `amzn://avod/watch?gti=${contentId}`, package: APPS.prime.package };
  }
  throw new LinkError('Unsupported app.');
}
