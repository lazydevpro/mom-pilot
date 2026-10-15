import { useState } from 'react';
import { ClipboardPaste, LoaderCircle, Play, Plus, Trash2 } from 'lucide-react';
import { APP_NAMES, post, remove, type AppId, type Show } from './api';
import { Sheet } from './Sheet';

export type Draft = { title: string; link: string };

const APPS: AppId[] = ['youtube', 'netflix', 'prime'];

export function Shows({ shows, busyId, hasTv, onPlay, onAdd, onOpenApp, onDeleted, onError }: {
  shows: Show[]; busyId: string | null; hasTv: boolean;
  onPlay: (show: Show) => void; onAdd: () => void; onOpenApp: (app: AppId) => void;
  onDeleted: (id: string) => void; onError: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  async function deleteShow(show: Show) {
    try { await remove(`/shows/${show.id}`); onDeleted(show.id); }
    catch (error) { onError((error as Error).message); }
  }

  return (
    <section>
      <div className="section-head">
        <h1>Mom’s shows</h1>
        {shows.length > 0 && <button className="text-button" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>

      {shows.length === 0 ? (
        <div className="empty">
          <p><strong>Save the shows Mom asks for.</strong></p>
          <p>Paste a YouTube, Netflix or Prime Video link. Next time she calls, one tap puts it on her TV.</p>
          <button className="primary" onClick={onAdd}><Plus size={18} />Add a show</button>
        </div>
      ) : (
        <ul className="show-list">
          {shows.map((show) => (
            <li key={show.id} className="show">
              <button className="show-main" disabled={busyId !== null || editing} onClick={() => onPlay(show)} aria-label={`Put ${show.title} on the TV`}>
                <span className={`thumb ${show.app}`}>
                  {show.image ? <img src={show.image} alt="" loading="lazy" /> : <span>{APP_NAMES[show.app].charAt(0)}</span>}
                </span>
                <span className="show-text">
                  <strong>{show.title}</strong>
                  <small>{APP_NAMES[show.app]}</small>
                </span>
                {!editing && <span className="play-badge">{busyId === show.id ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}</span>}
              </button>
              {editing && <button className="icon danger" aria-label={`Delete ${show.title}`} onClick={() => deleteShow(show)}><Trash2 size={20} /></button>}
            </li>
          ))}
        </ul>
      )}
      {shows.length > 0 && <button className="secondary full" onClick={onAdd}><Plus size={18} />Add a show</button>}

      <h2 className="subhead">Just open an app</h2>
      <div className="app-row">
        {APPS.map((app) => (
          <button key={app} className={`app-button ${app}`} disabled={!hasTv} onClick={() => onOpenApp(app)}>{APP_NAMES[app]}</button>
        ))}
      </div>
    </section>
  );
}

export function AddShow({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: (show: Show) => void }) {
  const [title, setTitle] = useState(initial.title);
  const [link, setLink] = useState(initial.link);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The clipboard API needs HTTPS; over plain HTTP people paste by hand.
  const canPaste = typeof navigator.clipboard?.readText === 'function' && window.isSecureContext;

  return (
    <Sheet title="Add a show" onClose={onClose}>
      <form className="form" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError('');
        try { onSaved((await post<{ show: Show }>('/shows', { title, link })).show); }
        catch (failure) { setError((failure as Error).message); }
        finally { setBusy(false); }
      }}>
        <label htmlFor="show-link">Link</label>
        <div className="input-row">
          <input id="show-link" value={link} inputMode="url" autoComplete="off" placeholder="https://www.netflix.com/title/…" onChange={(event) => setLink(event.target.value)} required />
          {canPaste && (
            <button type="button" className="icon bordered" aria-label="Paste link" onClick={async () => {
              try { setLink((await navigator.clipboard.readText()).trim()); } catch { /* Permission refused: paste by hand. */ }
            }}><ClipboardPaste size={20} /></button>
          )}
        </div>
        <p className="hint">In the YouTube, Netflix or Prime Video app, tap Share → Copy link, then paste it here.</p>
        <label htmlFor="show-title">Name</label>
        <input id="show-title" value={title} maxLength={80} placeholder="What Mom calls it" onChange={(event) => setTitle(event.target.value)} required />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary full" disabled={busy || !title.trim() || !link.trim()}>{busy && <LoaderCircle className="spin" size={18} />}Save show</button>
      </form>
    </Sheet>
  );
}
