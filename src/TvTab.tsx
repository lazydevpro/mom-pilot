import { useEffect, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, Plus } from 'lucide-react';
import { APP_NAMES, patch, post, relativeTime, type Details, type Device } from './api';

const ADB_HELP: Record<string, string> = {
  NOT_SET: 'Not set up. Add the TV’s address below.',
  ADB_UNAUTHORIZED: 'Waiting for Allow on the TV. Tick “Always allow” and press Allow.',
};

export function TvTab({ name, devices, details, selectedId, onSelect, onPaired, onRenamed, onChanged }: {
  name: string; devices: Device[]; details: Details | null; selectedId: string;
  onSelect: (id: string) => void; onPaired: (id: string) => void; onRenamed: (name: string) => void; onChanged: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState(devices.length === 0);
  useEffect(() => { if (devices.length === 0) setPairing(true); }, [devices.length]);

  return (
    <section>
      {details && !pairing && (
        <>
          {devices.length > 1 && (
            <div className="segmented" role="group" aria-label="Choose a TV">
              {devices.map((device) => (
                <button key={device.id} aria-pressed={device.id === (selectedId || details.device.id)} onClick={() => onSelect(device.id)}>{device.name}</button>
              ))}
            </div>
          )}
          <Connection details={details} />
          <TvSettings key={details.device.id} device={details.device} onSaved={onChanged} />
          <Activity details={details} />
          <button className="secondary full" onClick={() => setPairing(true)}><Plus size={18} />Connect another TV</button>
        </>
      )}
      {pairing && <PairTv canCancel={devices.length > 0} onCancel={() => setPairing(false)} onPaired={(id) => { setPairing(false); onPaired(id); }} />}
      <Profile name={name} onRenamed={onRenamed} />
      <LinkPhone />
    </section>
  );
}

function LinkPhone() {
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  return (
    <div className="card">
      <h2>Your phones</h2>
      <p className="hint">
        To use MomPilot on another phone, or as a home-screen app (Safari: Share → Add to Home Screen; Chrome: menu → Add to Home screen),
        open it there, choose “Already use MomPilot on another phone?” and enter a code from here.
      </p>
      {link ? (
        <p className="link-code" aria-live="polite"><strong>{link.code.replace(/(\d{3})/, '$1 ')}</strong><small>Valid for 10 minutes, once.</small></p>
      ) : (
        <button className="secondary full" onClick={async () => {
          setError('');
          try { setLink(await post<{ code: string; expiresAt: string }>('/session/link')); }
          catch (failure) { setError((failure as Error).message); }
        }}>Add another phone</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function Connection({ details }: { details: Details }) {
  const { adb, device } = details;
  const remote = adb.state === 'CONNECTED'
    ? `Connected${adb.awake === false ? ' · TV asleep' : adb.app ? ` · ${APP_NAMES[adb.app] || adb.app} open` : ''}`
    : ADB_HELP[adb.state] || adb.message || 'Can’t reach the TV.';
  return (
    <div className="card">
      <h1>{device.name}</h1>
      <dl className="facts">
        <dt>Remote</dt>
        <dd className={adb.state === 'CONNECTED' ? 'good' : 'bad'}>{adb.state === 'CONNECTED' ? <Check size={16} /> : <CircleAlert size={16} />}{remote}</dd>
        <dt>MomPilot TV app</dt>
        <dd className={device.appOnline ? 'good' : ''}>{device.appOnline ? 'Running' : `Last seen ${relativeTime(device.lastSeenAt)}`}</dd>
      </dl>
    </div>
  );
}

function TvSettings({ device, onSaved }: { device: Device; onSaved: () => Promise<void> }) {
  const [tvName, setTvName] = useState(device.name);
  const [address, setAddress] = useState(device.adbTarget || '');
  const [state, setState] = useState<{ busy?: boolean; error?: string; saved?: boolean }>({});
  const changed = tvName.trim() !== device.name || address.trim() !== (device.adbTarget || '');
  return (
    <form className="card form" onSubmit={async (event) => {
      event.preventDefault(); setState({ busy: true });
      try {
        await patch(`/devices/${device.id}`, { name: tvName, adbTarget: address.trim() || null });
        setState({ saved: true });
        void onSaved();
      } catch (error) { setState({ error: (error as Error).message }); }
    }}>
      <h2>TV settings</h2>
      <label htmlFor="tv-name">Name</label>
      <input id="tv-name" value={tvName} maxLength={60} onChange={(event) => setTvName(event.target.value)} required />
      <label htmlFor="tv-address">Address for the remote</label>
      <input id="tv-address" value={address} inputMode="url" autoComplete="off" spellCheck={false} placeholder="100.101.102.103:5555" onChange={(event) => setAddress(event.target.value)} />
      <p className="hint">The TV’s address from the Tailscale app on the TV, followed by :5555.</p>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="primary full" disabled={state.busy || !changed || !tvName.trim()}>
        {state.busy ? <LoaderCircle className="spin" size={18} /> : state.saved && !changed ? <Check size={18} /> : null}
        {state.saved && !changed ? 'Saved' : 'Save'}
      </button>
    </form>
  );
}

function Activity({ details }: { details: Details }) {
  if (!details.commands.length) return null;
  const label: Record<string, string> = { LAUNCHED: 'Opened', QUEUED: 'Sending…', RECEIVED: 'Opening…', FAILED: 'Didn’t open', EXPIRED: 'Timed out' };
  return (
    <div className="card">
      <h2>Recently</h2>
      <ul className="activity">
        {details.commands.slice(0, 8).map((command) => (
          <li key={command.id}>
            <span>
              <strong>{command.title || APP_NAMES[command.app]}</strong>
              <small className={['FAILED', 'EXPIRED'].includes(command.state) ? 'bad' : ''}>
                {label[command.state] || command.state}{command.reason ? ` · ${command.reason}` : ''}
              </small>
            </span>
            <time>{relativeTime(command.createdAt)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PairTv({ canCancel, onCancel, onPaired }: { canCancel: boolean; onCancel: () => void; onPaired: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [tvName, setTvName] = useState('Mom’s TV');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="card form" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try { onPaired((await post<{ device: Device }>('/pair', { code, name: tvName })).device.id); }
      catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>
      <h1>Connect Mom’s TV</h1>
      <p>Open MomPilot on the TV and enter the six-digit code it shows.</p>
      <label htmlFor="pair-code">Code on the TV</label>
      <input id="pair-code" className="code" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
      <label htmlFor="pair-name">TV name</label>
      <input id="pair-name" value={tvName} maxLength={60} onChange={(event) => setTvName(event.target.value)} required />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary full" disabled={busy || code.length !== 6 || !tvName.trim()}>{busy && <LoaderCircle className="spin" size={18} />}Connect</button>
      {canCancel && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
    </form>
  );
}

function Profile({ name, onRenamed }: { name: string; onRenamed: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  return (
    <form className="card form" onSubmit={async (event) => {
      event.preventDefault(); setError('');
      try { onRenamed((await post<{ caregiver: { name: string } }>('/session', { name: value })).caregiver.name); }
      catch (failure) { setError((failure as Error).message); }
    }}>
      <h2>Your name</h2>
      <p className="hint">Shown on Mom’s TV.</p>
      <div className="input-row">
        <input aria-label="Your name" value={value} maxLength={60} onChange={(event) => setValue(event.target.value)} required />
        <button className="secondary" disabled={!value.trim() || value.trim() === name}>Save</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
