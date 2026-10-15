import { useEffect, useRef, useState } from 'react';
import { Gamepad2, Heart, ListVideo, LoaderCircle, Play, Tv, X } from 'lucide-react';
import {
  APP_NAMES, ApiError, api, post, requestKey, tvStatus,
  type AppId, type Command, type Details, type Device, type Key, type Show,
} from './api';
import { Shows, AddShow, type Draft } from './Shows';
import { Remote } from './Remote';
import { TvTab } from './TvTab';

type Tab = 'shows' | 'remote' | 'tv';
type Toast = { text: string; tone: 'good' | 'bad'; action?: { label: string; run: () => void } };

const storage = {
  get: (key: string) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private mode: not remembered. */ } },
};

/** Reads a link shared to the installed app (Android share sheet → MomPilot). */
function sharedDraft(): Draft | null {
  if (location.pathname !== '/share') return null;
  const params = new URLSearchParams(location.search);
  const text = params.get('text') || '';
  const link = params.get('url') || /https?:\/\/\S+/.exec(text)?.[0] || '';
  history.replaceState(null, '', '/');
  return { title: params.get('title') || '', link };
}

const LAUNCH_HINTS: Record<AppId, string> = {
  youtube: '',
  netflix: ' If Netflix asks who’s watching, press OK on the remote.',
  prime: ' Press OK on the remote to start it.',
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [offline, setOffline] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState(() => storage.get('mompilot-tv'));
  const [details, setDetails] = useState<Details | null>(null);
  const [tab, setTab] = useState<Tab>('shows');
  const [toast, setToast] = useState<Toast | null>(null);
  const [draft, setDraft] = useState<Draft | null>(sharedDraft);
  const [busyShow, setBusyShow] = useState<string | null>(null);
  const refreshVersion = useRef(0);
  const selectedRef = useRef(deviceId);
  const keyQueue = useRef(Promise.resolve());
  const device = details?.device ?? null;

  function notify(text: string, tone: Toast['tone'] = 'good', action?: Toast['action']) { setToast({ text, tone, action }); }

  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const { devices: list } = await api<{ devices: Device[] }>('/devices');
      if (version !== refreshVersion.current) return;
      setDevices(list);
      const selected = list.find((entry) => entry.id === selectedRef.current) || list[0];
      const next = selected ? await api<Details>(`/devices/${selected.id}`) : null;
      if (version !== refreshVersion.current) return;
      setDetails(next);
      setOffline('');
    } catch (error) {
      if (version !== refreshVersion.current) return;
      if (error instanceof ApiError && error.status === 401) setNeedsName(true);
      else setOffline(error instanceof Error ? error.message : 'Can’t reach the MomPilot server.');
    }
  }

  async function loadShows(quiet = false) {
    try { setShows((await api<{ shows: Show[] }>('/shows')).shows); }
    catch (error) { if (!quiet) notify((error as Error).message, 'bad'); }
  }

  useEffect(() => {
    (async () => {
      try {
        setName((await api<{ caregiver: { name: string } }>('/session')).caregiver.name);
        await Promise.all([refresh(), loadShows()]);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setNeedsName(true);
        else setOffline((error as Error).message);
      } finally { setBooting(false); }
    })();
  }, []);

  useEffect(() => {
    if (booting || needsName) return;
    let ticks = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
      // Shows can change on your other phone; pick that up now and then.
      if (ticks++ % 10 === 0) void loadShows(true);
    };
    const timer = setInterval(tick, 3000);
    const onVisible = () => { ticks = 0; tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [booting, needsName]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'bad' ? 8000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  function chooseDevice(id: string) {
    selectedRef.current = id;
    setDeviceId(id);
    storage.set('mompilot-tv', id);
    void refresh();
  }

  async function signedIn(path: string, body: unknown) {
    const { caregiver } = await post<{ caregiver: { name: string } }>(path, body);
    setName(caregiver.name);
    setNeedsName(false);
    await Promise.all([refresh(), loadShows()]);
  }

  async function open(body: { type: 'OPEN_SHOW'; showId: string } | { type: 'OPEN_APP'; app: AppId }, label: string, app: AppId) {
    if (!device) { setTab('tv'); notify('Connect Mom’s TV first.', 'bad'); return; }
    try {
      const { command } = await post<{ command: Command }>(`/devices/${device.id}/commands`, { ...body, idempotencyKey: requestKey() });
      const where = command.via === 'adb' ? `Opening ${label} on ${device.name}.` : `Sent ${label} to the MomPilot app on ${device.name}.`;
      notify(where + (body.type === 'OPEN_SHOW' ? LAUNCH_HINTS[app] : ''), 'good', { label: 'Remote', run: () => setTab('remote') });
    } catch (error) {
      const failed = (error as ApiError).body?.command as Command | undefined;
      notify(failed?.reason || (error as Error).message, 'bad');
    } finally { void refresh(); }
  }

  async function play(show: Show) {
    setBusyShow(show.id);
    try { await open({ type: 'OPEN_SHOW', showId: show.id }, show.title, show.app); }
    finally { setBusyShow(null); }
  }

  // Keys are sent one after another so fast taps arrive in order.
  function press(key: Key | 'wake') {
    if (!device) return;
    navigator.vibrate?.(12);
    const target = device.id;
    keyQueue.current = keyQueue.current.then(async () => {
      try { await post(`/devices/${target}/commands`, key === 'wake' ? { type: 'WAKE' } : { type: 'KEY', key }); }
      catch (error) { notify((error as Error).message, 'bad'); }
    });
  }

  if (booting) return <main className="center-screen"><LoaderCircle className="spin" /></main>;
  if (needsName) return <Welcome onStart={(newName) => signedIn('/session', { name: newName })} onJoin={(code) => signedIn('/session/join', { code })} />;

  const status = tvStatus(details);
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="brand-mark"><Heart size={16} fill="currentColor" /><Play size={8} fill="currentColor" /></span>MomPilot</div>
        <button className={`status-pill ${status.tone}`} onClick={() => setTab('tv')}>
          <span className="dot" />{status.text}
        </button>
      </header>
      {offline && <div className="banner bad" role="alert">{offline}</div>}

      <main className="content">
        {tab === 'shows' && (
          <Shows
            shows={shows} busyId={busyShow} hasTv={Boolean(device)}
            onPlay={play} onAdd={() => setDraft({ title: '', link: '' })}
            onOpenApp={(app) => open({ type: 'OPEN_APP', app }, APP_NAMES[app], app)}
            onDeleted={(id) => setShows((list) => list.filter((show) => show.id !== id))}
            onError={(text) => notify(text, 'bad')}
          />
        )}
        {tab === 'remote' && <Remote details={details} onPress={press} onGoToTv={() => setTab('tv')} />}
        {tab === 'tv' && (
          <TvTab
            name={name} devices={devices} details={details} selectedId={deviceId}
            onSelect={chooseDevice} onRenamed={setName} onChanged={refresh}
            onPaired={(id) => { chooseDevice(id); notify('Mom’s TV is connected.'); }}
          />
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === 'bad' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          {toast.action && <button className="toast-action" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}
          <button className="icon" aria-label="Dismiss" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        <TabButton label="Shows" icon={<ListVideo size={22} />} active={tab === 'shows'} onClick={() => setTab('shows')} />
        <TabButton label="Remote" icon={<Gamepad2 size={22} />} active={tab === 'remote'} onClick={() => setTab('remote')} />
        <TabButton label="TV" icon={<Tv size={22} />} active={tab === 'tv'} onClick={() => setTab('tv')} />
      </nav>

      {draft && (
        <AddShow
          initial={draft} onClose={() => setDraft(null)}
          onSaved={(show) => { setShows((list) => [...list, show]); setDraft(null); notify(`Saved ${show.title}.`); }}
        />
      )}
    </div>
  );
}

function TabButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return <button className={`tab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Welcome({ onStart, onJoin }: { onStart: (name: string) => Promise<void>; onJoin: (code: string) => Promise<void> }) {
  const [joining, setJoining] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = joining ? /^\d{6}$/.test(value) : Boolean(value.trim());
  return (
    <main className="center-screen welcome">
      <span className="brand-mark large"><Heart size={34} fill="currentColor" /><Play size={14} fill="currentColor" /></span>
      <h1>MomPilot</h1>
      <p>Put Mom’s shows on her TV from wherever you are.</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError('');
        try { await (joining ? onJoin(value) : onStart(value)); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
      }}>
        {joining ? (
          <>
            <label htmlFor="link-code">Code from your other phone</label>
            <input id="link-code" className="code" value={value} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
              onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))} required />
            <p className="hint">On the phone you already use: TV tab → Add another phone.</p>
          </>
        ) : (
          <>
            <label htmlFor="your-name">Your name, as Mom will see it</label>
            <input id="your-name" value={value} maxLength={60} autoComplete="given-name" onChange={(event) => setValue(event.target.value)} required />
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !valid}>{busy ? <LoaderCircle className="spin" size={18} /> : null}{joining ? 'Link this phone' : 'Get started'}</button>
        <button type="button" className="text-button" onClick={() => { setJoining(!joining); setValue(''); setError(''); }}>
          {joining ? 'I’m new to MomPilot' : 'Already use MomPilot on another phone?'}
        </button>
      </form>
    </main>
  );
}
