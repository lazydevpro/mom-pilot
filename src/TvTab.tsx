import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Check, CircleAlert, LoaderCircle, Plus, Tv } from 'lucide-react';
import { APP_NAMES, api, patch, post, relativeTime, type ApiError, type Details, type Device, type NearbyTv } from './api';

const ADB_HELP: Record<string, string> = {
  NOT_SET: 'Not set up. Add the TV again from the list.',
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
          <button className="secondary full" onClick={() => setPairing(true)}><Plus size={18} />Add another TV</button>
        </>
      )}
      {pairing && <AddTv canCancel={devices.length > 0} onCancel={() => setPairing(false)} onAdded={(id) => { setPairing(false); onPaired(id); }} />}
      <Profile name={name} onRenamed={onRenamed} />
      <LinkPhone />
    </section>
  );
}

function LinkPhone() {
  const [link, setLink] = useState<{ code: string; qr: string } | null>(null);
  const [error, setError] = useState('');
  return (
    <div className="card">
      <h2>Your phones</h2>
      <p className="hint">
        Android: install the MomPilot app (<a href="/download/mompilot.apk">download</a>), open it and scan this code.
        iPhone: open this page in Safari, choose “Already use MomPilot on another phone?” and enter the code.
      </p>
      {link ? (
        <div className="link-code" aria-live="polite">
          <img className="qr" src={link.qr} alt="Code to scan with the MomPilot app" width={200} height={200} />
          <strong>{link.code.replace(/(d{3})/, '$1 ')}</strong><small>Valid for 10 minutes, once.</small>
        </div>
      ) : (
        <button className="secondary full" onClick={async () => {
          setError('');
          try {
            const [{ code }, { publicUrl }] = await Promise.all([post<{ code: string }>('/session/link'), api<{ publicUrl: string | null }>('/server')]);
            const target = `mompilot://join?server=${encodeURIComponent(publicUrl || location.origin)}&code=${code}`;
            setLink({ code, qr: qrDataUrl(target) });
          } catch (failure) { setError((failure as Error).message); }
        }}>Add another phone</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function qrDataUrl(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 2);
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

/** Adds a TV with no codes: pick it from the Tailscale list (or type its address); the server sets it up over ADB. */
function AddTv({ canCancel, onCancel, onAdded }: { canCancel: boolean; onCancel: () => void; onAdded: (id: string) => void }) {
  const [tvs, setTvs] = useState<NearbyTv[] | null>(null);
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<{ busy: boolean; text: string; bad?: boolean } | null>(null);
  const find = async () => {
    setTvs(null);
    try { setTvs((await api<{ tvs: NearbyTv[] }>('/tvs/nearby')).tvs); } catch { setTvs([]); }
  };
  useEffect(() => { void find(); }, []);

  async function setup(target: string, tvName?: string) {
    setStatus({ busy: true, text: 'Connecting to the TV…' });
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const { device } = await post<{ device: Device }>('/tvs/setup', { address: target, serverUrl: location.origin, ...(tvName ? { name: tvName.slice(0, 60) } : {}) });
        setStatus(null);
        onAdded(device.id);
        return;
      } catch (failure) {
        const error = failure as ApiError;
        if (error.code === 'ADB_UNAUTHORIZED' && Date.now() < deadline) {
          setStatus({ busy: true, text: 'On the TV: tick “Always allow from this computer”, then press Allow.' });
          await new Promise((done) => setTimeout(done, 3000));
          continue;
        }
        setStatus({ busy: false, text: error.message, bad: true });
        return;
      }
    }
  }

  return (
    <div className="card form">
      <h1>Add Mom’s TV</h1>
      <p className="hint">Open MomPilot on the TV, then pick it below. If the TV asks “Allow USB debugging?”, tick “Always allow” and press Allow.</p>
      {status?.busy ? (
        <p className="setup-status"><LoaderCircle className="spin" size={18} />{status.text}</p>
      ) : (
        <>
          <div className="section-head"><h2>On your Tailscale network</h2><button className="text-button" onClick={find}>Look again</button></div>
          {tvs === null ? <LoaderCircle className="spin" size={18} /> : tvs.length === 0 ? <p className="hint">No Android devices found. Is Tailscale on and signed in on the TV?</p> : (
            <ul className="tv-list">
              {tvs.map((tv) => (
                <li key={tv.address}>
                  <button className="tv-option" disabled={!tv.adb || tv.added} onClick={() => setup(tv.address, tv.name)}>
                    <Tv size={22} /><span><strong>{tv.name}</strong><small>{tv.added ? 'Already added' : tv.adb ? 'Ready · tap to add' : 'ADB debugging is off, or not a TV'}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="tv-new-address">Or type its Tailscale address</label>
          <div className="input-row">
            <input id="tv-new-address" value={address} inputMode="url" autoComplete="off" spellCheck={false} placeholder="100.101.102.103" onChange={(event) => setAddress(event.target.value)} />
            <button className="secondary" disabled={!address.trim()} onClick={() => setup(address.trim())}>Add</button>
          </div>
          {status?.bad && <p className="form-error" role="alert">{status.text}</p>}
          {canCancel && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
        </>
      )}
    </div>
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
