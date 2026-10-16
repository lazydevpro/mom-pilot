import { useEffect, useState } from 'react';
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FastForward, Home, Image, LoaderCircle,
  Pause, Power, Rewind, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import type { Details, Key } from './api';

const KEYBOARD: Record<string, Key> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Backspace: 'back', Escape: 'back', ' ': 'playPause', h: 'home',
};

export function Remote({ details, onPress, onGoToTv }: { details: Details | null; onPress: (key: Key | 'wake') => void; onGoToTv: () => void }) {
  const [snapshot, setSnapshot] = useState<{ url?: string; state: 'loading' | 'ready' | 'failed'; message?: string } | null>(null);
  const ready = Boolean(details?.device.adbTarget);

  // Fetched rather than set as an <img> source, so the server's reason can be shown when there's no picture.
  async function takeSnapshot(deviceId: string) {
    setSnapshot((current) => ({ url: current?.url, state: 'loading' }));
    try {
      const response = await fetch(`/api/devices/${deviceId}/snapshot`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSnapshot({ state: 'failed', message: body.message || 'Couldn’t get the screen. Is the TV on and connected?' });
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      setSnapshot((current) => { if (current?.url) URL.revokeObjectURL(current.url); return { url, state: 'ready' }; });
    } catch {
      setSnapshot({ state: 'failed', message: 'Can’t reach the MomPilot server.' });
    }
  }
  useEffect(() => () => { if (snapshot?.url) URL.revokeObjectURL(snapshot.url); }, [snapshot?.url]);

  // Arrow keys, Enter and Backspace work as a remote on a laptop.
  useEffect(() => {
    if (!ready) return;
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = KEYBOARD[event.key];
      if (key) { event.preventDefault(); onPress(key); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ready, onPress]);

  if (!details) {
    return <section className="empty"><p><strong>No TV connected yet.</strong></p><button className="primary" onClick={onGoToTv}>Connect Mom’s TV</button></section>;
  }
  if (!ready) {
    return (
      <section className="empty">
        <p><strong>The remote needs the TV’s address.</strong></p>
        <p>Add the address shown in the Tailscale app on Mom’s TV, for example 100.101.102.103:5555.</p>
        <button className="primary" onClick={onGoToTv}>Add it in TV settings</button>
      </section>
    );
  }

  const button = (key: Key, label: string, icon: React.ReactNode, className = '') => (
    <button className={`remote-key ${className}`} aria-label={label} onClick={() => onPress(key)}>{icon}</button>
  );

  return (
    <section className="remote">
      {details.adb.state !== 'CONNECTED' && <div className="banner warn">{details.adb.message || 'The remote can’t reach the TV right now.'}</div>}

      <div className="dpad" role="group" aria-label="Direction buttons">
        {button('up', 'Up', <ChevronUp size={34} />, 'up')}
        {button('left', 'Left', <ChevronLeft size={34} />, 'left')}
        <button className="remote-key ok" aria-label="OK" onClick={() => onPress('ok')}>OK</button>
        {button('right', 'Right', <ChevronRight size={34} />, 'right')}
        {button('down', 'Down', <ChevronDown size={34} />, 'down')}
      </div>

      <div className="remote-row">
        {button('back', 'Back', <ArrowLeft size={24} />)}
        {button('home', 'Home', <Home size={24} />)}
        {button('playPause', 'Play or pause', <Pause size={24} />)}
      </div>
      <div className="remote-row">
        {button('rewind', 'Rewind', <Rewind size={24} />)}
        {button('fastForward', 'Fast forward', <FastForward size={24} />)}
        <button className="remote-key" aria-label="Wake the TV" onClick={() => onPress('wake')}><Power size={24} /></button>
      </div>
      <div className="remote-row">
        {button('volumeDown', 'Volume down', <Volume1 size={24} />)}
        {button('mute', 'Mute', <VolumeX size={24} />)}
        {button('volumeUp', 'Volume up', <Volume2 size={24} />)}
      </div>

      <button className="secondary full" disabled={snapshot?.state === 'loading'} onClick={() => takeSnapshot(details.device.id)}>
        {snapshot?.state === 'loading' ? <LoaderCircle className="spin" size={18} /> : <Image size={18} />}
        {snapshot?.state === 'loading' ? 'Getting the screen…' : 'See TV screen'}
      </button>
      {snapshot && (
        <figure className="snapshot">
          {snapshot.url && snapshot.state !== 'failed' && <img src={snapshot.url} alt="Mom’s TV screen" />}
          <figcaption className={snapshot.state === 'failed' ? 'bad' : ''}>
            {snapshot.state === 'failed' ? snapshot.message : 'Playing video shows as black; menus and pages are visible.'}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
