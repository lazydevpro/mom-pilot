import test from 'node:test';
import assert from 'node:assert/strict';
import { LinkError, launchFor, mostMentionedGti, parseLink, resolveLink } from '../server/shows.mjs';

const GTI = 'amzn1.dv.gti.4eb5d9a6-1f60-4b63-8b10-0123456789ab';

test('YouTube links in their common shapes resolve to the video ID', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com/watch?v=aqz-KE-bpKQ&t=42s',
    'https://m.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://youtu.be/aqz-KE-bpKQ?si=abc',
    'https://www.youtube.com/shorts/aqz-KE-bpKQ',
    'https://www.youtube.com/live/aqz-KE-bpKQ',
    '  https://www.youtube.com/watch?v=aqz-KE-bpKQ  ',
  ]) assert.deepEqual(parseLink(link), { app: 'youtube', contentId: 'aqz-KE-bpKQ' }, link);
});

test('Netflix title and watch links resolve to the title number, with or without a country', () => {
  for (const link of [
    'https://www.netflix.com/title/80057281',
    'https://www.netflix.com/in/title/80057281?s=a&trkid=1',
    'https://www.netflix.com/in-en/title/80057281',
    'https://netflix.com/watch/80057281',
  ]) assert.deepEqual(parseLink(link), { app: 'netflix', contentId: '80057281' }, link);
});

test('Prime Video links prefer the gti and accept detail IDs', () => {
  assert.deepEqual(parseLink(`https://app.primevideo.com/detail?gti=${GTI}&ref_=x`), { app: 'prime', contentId: GTI });
  assert.deepEqual(parseLink('https://www.primevideo.com/detail/0KRGHGZCHKS920ZQGY5LBRF7MA/ref=atv'), { app: 'prime', contentId: '0KRGHGZCHKS920ZQGY5LBRF7MA' });
  assert.deepEqual(parseLink('https://www.primevideo.com/-/hi/detail/0KRGHGZCHKS920ZQGY5LBRF7MA'), { app: 'prime', contentId: '0KRGHGZCHKS920ZQGY5LBRF7MA' });
  assert.deepEqual(parseLink('https://www.amazon.in/gp/video/detail/B0B8TQ5H8C/ref=atv'), { app: 'prime', contentId: 'B0B8TQ5H8C' });
});

test('anything else is rejected', () => {
  for (const link of [
    'not a link', 'javascript:alert(1)', 'ftp://youtube.com/watch?v=aqz-KE-bpKQ',
    'https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=short',
    "https://www.youtube.com/watch?v=aqz-KE-bpK'", 'https://www.netflix.com/browse',
    'https://www.netflix.com/title/8005; reboot', 'https://www.primevideo.com/detail/lowercase-id',
    'https://app.primevideo.com/detail?gti=amzn1.dv.gti.not-a-uuid',
  ]) assert.throws(() => parseLink(link), LinkError, link);
});

test('Amazon short links are followed to the full link', async () => {
  const hops = [];
  const fetchImpl = async (url) => {
    hops.push(url.href);
    return { headers: new Headers({ location: `https://app.primevideo.com/detail?gti=${GTI}` }) };
  };
  assert.deepEqual(await resolveLink('https://amzn.in/d/abc123', fetchImpl), { app: 'prime', contentId: GTI });
  assert.deepEqual(hops, ['https://amzn.in/d/abc123']);
  assert.deepEqual(await resolveLink('https://youtu.be/aqz-KE-bpKQ', () => assert.fail('no fetch for full links')), { app: 'youtube', contentId: 'aqz-KE-bpKQ' });
  await assert.rejects(resolveLink('https://amzn.in/d/abc123', async () => ({ headers: new Headers() })), LinkError);
});

test('launch intents match the Fire OS commands in the plan', () => {
  assert.deepEqual(launchFor({ app: 'youtube', contentId: 'aqz-KE-bpKQ' }), {
    action: 'android.intent.action.VIEW', data: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', package: 'com.amazon.firetv.youtube',
  });
  const netflix = launchFor({ app: 'netflix', contentId: '80057281' });
  assert.deepEqual([netflix.component, netflix.data, netflix.flags, netflix.extras, netflix.forceStop],
    ['com.netflix.ninja/.MainActivity', 'netflix://title/80057281', 0x10000020, { amzn_deeplink_data: '80057281' }, 'com.netflix.ninja']);
  assert.deepEqual(launchFor({ app: 'prime', contentId: GTI }), {
    action: 'android.intent.action.VIEW', data: `amzn://avod/watch?gti=${GTI}`, package: 'com.amazon.firebat',
  });
  // Web title IDs don't open in the Fire TV app (error 5004), so they must be looked up first.
  assert.throws(() => launchFor({ app: 'prime', contentId: 'B0B8TQ5H8C' }), LinkError);
});

test('Prime Video web title IDs are looked up to the gti the TV app needs', async () => {
  const OTHER = 'amzn1.dv.gti.11111111-2222-3333-4444-555555555555';
  const page = `<title>Prime Video: Khalifa</title> ${GTI} ${GTI} ${OTHER} ${GTI} related ${OTHER}`;
  assert.equal(mostMentionedGti(page), GTI);
  assert.equal(mostMentionedGti('<html>no ids</html>'), null);
  const requested = [];
  const fetchImpl = async (url) => { requested.push(String(url)); return { ok: true, text: async () => page }; };
  assert.deepEqual(await resolveLink('https://www.primevideo.com/detail/0GYXUMEVVOI5XBNYFQICTRGF05?ref_=atv_dp_share_cu_r', fetchImpl), { app: 'prime', contentId: GTI });
  assert.deepEqual(requested, ['https://www.primevideo.com/detail/0GYXUMEVVOI5XBNYFQICTRGF05']);
  // Links that already carry a gti need no lookup.
  assert.deepEqual(await resolveLink(`https://app.primevideo.com/detail?gti=${GTI}`, () => assert.fail('no lookup')), { app: 'prime', contentId: GTI });
  await assert.rejects(resolveLink('https://www.primevideo.com/detail/0GYXUMEVVOI5XBNYFQICTRGF05', async () => ({ ok: false })), LinkError);
  await assert.rejects(resolveLink('https://www.primevideo.com/detail/0GYXUMEVVOI5XBNYFQICTRGF05', async () => { throw new Error('offline'); }), LinkError);
});
