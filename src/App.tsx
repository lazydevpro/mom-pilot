import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Heart, Home, LayoutGrid, Link2, LoaderCircle, MessageCircle, Monitor, MoreHorizontal, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Tv2, Volume2, Wifi, X } from 'lucide-react';
import { api, post, messages, relativeTime, commandKey, type Item, type Device, type Command } from './api';

type Page = 'Home' | 'Favorites' | 'Browse library' | 'Activity';
export function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'light' : ''}`}><span className="brand-icon"><Heart size={23} strokeWidth={2} /><Play size={9} fill="currentColor" /></span><span>Mom<span className="brand-light">Pilot</span><span className="brand-dot">.</span></span></div>; }
function statusLabel(state: string) { return ({ QUEUED: 'Sending', RECEIVED: 'Delivered', PLAYING: 'Playing on TV', DISPLAYED: 'Message shown', PAUSED: 'Paused on TV', LAUNCHED: 'Sent to YouTube · playback unverified', FAILED: 'Couldn’t complete', EXPIRED: 'Delivery timed out' } as Record<string, string>)[state] || state; }

export default function App() {
  const [page, setPage] = useState<Page>('Home');
  const [name, setName] = useState('Varish');
  const [items, setItems] = useState<Item[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState(localStorage.getItem('mompilot-selected-tv') || '');
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('mompilot-favorites') || '["bunny","sintel","dream"]'); } catch { return ['bunny', 'sintel', 'dream']; } });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All videos');
  const [preview, setPreview] = useState<Item | null>(null);
  const [modal, setModal] = useState<'pair' | 'help' | 'family' | 'profile' | null>(null);
  const [pairCode, setPairCode] = useState('');
  const [tvName, setTvName] = useState('Mom’s living room');
  const [pairError, setPairError] = useState('');
  const [busy, setBusy] = useState(false);
  const [messageId, setMessageId] = useState('found-video');
  const [notice, setNotice] = useState<{text: string; error?: boolean} | null>(null);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState(name);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const refreshVersion = useRef(0);
  const selectedDeviceRef = useRef(deviceId);
  const device = devices.find(d => d.id === deviceId) || devices[0];
  const playingItem = items.find(item => item.id === device?.playback?.itemId);
  const selectedMessage = messages.find(m => m.id === messageId)!;
  const currentCommand = commands.find(command => command.id === activeCommand);
  const canSend = !!device?.online && !device.quiet && !loadError;

  async function refresh() {
    const version = ++refreshVersion.current;
    const selectedId = selectedDeviceRef.current;
    try {
      const result = await api<{devices: Device[]}>('/devices');
      if (version !== refreshVersion.current) return;
      setDevices(result.devices);
      const selected = result.devices.find(d => d.id === selectedId) || result.devices[0];
      if (selected) {
        const details = await api<{device: Device; commands: Command[]}>(`/devices/${selected.id}`);
        if (version !== refreshVersion.current) return;
        setCommands(details.commands);
      } else setCommands([]);
      setLoadError('');
    } catch (error) { if (version === refreshVersion.current) setLoadError(error instanceof Error ? error.message : 'Cannot reach the relay.'); }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let session;
        try { session = await api<{caregiver: {name: string}}>('/session'); }
        catch { session = await post<{caregiver: {name: string}}>('/session', {name: 'Varish'}); }
        const catalog = await api<{items: Item[]}>('/catalog');
        if (!cancelled) { setName(session.caregiver.name); setItems(catalog.items); await refresh(); }
      } catch { if (!cancelled) setLoadError('The local relay isn’t connected. Start the app with npm run dev, then retry.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (loading) return; void refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, [loading, deviceId]);
  useEffect(() => { localStorage.setItem('mompilot-favorites', JSON.stringify(saved)); }, [saved]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => { if (modal || preview) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [modal, preview]);

  function closeModal() { setModal(null); setPreview(null); setPairError(''); }
  function favorite(id: string) { setSaved(previous => previous.includes(id) ? previous.filter(s => s !== id) : [...previous, id]); }
  function chooseDevice(id: string) { refreshVersion.current++; selectedDeviceRef.current = id; setDeviceId(id); setCommands([]); localStorage.setItem('mompilot-selected-tv', id); setActiveCommand(null); }
  async function send(type: string, payload: Record<string, string> = {}) {
    if (!device) { setPreview(null); setModal('pair'); return; }
    setBusy(true);
    try {
      const { command } = await post<{command: Command}>(`/devices/${device.id}/commands`, {type, ...payload, idempotencyKey: commandKey()});
      setActiveCommand(command.id); setCommands(previous => [command, ...previous]);
      setPreview(null); setNotice({text: type === 'SHOW_MESSAGE' ? 'Your message is on its way.' : 'Sent to MomPilot. Waiting for the TV…'});
    } catch (error) { setNotice({text: (error as Error).message, error: true}); }
    finally { setBusy(false); }
  }
  async function pair(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setPairError('');
    try {
      const {device: paired} = await post<{device: Device}>('/pair', {code: pairCode, name: tvName});
      setDevices(previous => [...previous, paired]); chooseDevice(paired.id); closeModal(); setPairCode('');
      setNotice({text: `${paired.name} is connected. You’re ready to make their day.`}); await refresh();
    } catch (error) { setPairError((error as Error).message); }
    finally { setBusy(false); }
  }
  const displayedItems = items.filter(item => (page !== 'Favorites' || saved.includes(item.id)) && (page !== 'Home' || saved.includes(item.id)) && `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(query.toLowerCase()) && (category === 'All videos' || item.category === category));

  function cards(list: Item[]) { return <div className="video-grid">{list.map((item, index) => <article className="video-card" key={item.id} style={{animationDelay: `${index * 70}ms`}}>
    <div className="video-art"><button className="art-open" onClick={() => setPreview(item)} aria-label={`Preview ${item.title}`}><img src={item.thumbnail} alt={`Still from ${item.title}`} /><span className="art-play"><Play size={23} fill="currentColor" /></span></button><span className="duration">{item.duration}</span><button className={`favorite-button ${saved.includes(item.id) ? 'saved' : ''}`} onClick={() => favorite(item.id)} aria-label={`${saved.includes(item.id) ? 'Remove' : 'Save'} ${item.title} ${saved.includes(item.id) ? 'from' : 'to'} favorites`}><Heart size={17} fill={saved.includes(item.id) ? 'currentColor' : 'none'} /></button></div>
    <div className="video-info"><span className="eyebrow video-category">{item.category}</span><button className="video-title" onClick={() => setPreview(item)}>{item.title}</button><p>{item.subtitle || 'A Blender open movie'}</p></div>
  </article>)}</div>; }

  function activity(limit?: number) { return commands.length ? <div className="activity-list">{commands.slice(0, limit).map(command => <div className="activity-row" key={command.id}>
    <span className={`activity-icon ${['FAILED', 'EXPIRED'].includes(command.state) ? 'failed' : ''}`}>{command.type === 'SHOW_MESSAGE' ? <MessageCircle size={18}/> : <Play size={18}/>}</span>
    <div><strong>{command.type === 'PLAY_CATALOG_ITEM' ? items.find(i => i.id === command.itemId)?.title || 'Video' : command.type === 'OPEN_YOUTUBE' ? 'Open Big Buck Bunny in YouTube' : command.type === 'SHOW_MESSAGE' ? 'A little reassurance' : command.type === 'PAUSE' ? 'Pause playback' : 'Resume playback'}</strong><span className={['FAILED', 'EXPIRED'].includes(command.state) ? 'error-text' : ''}>{statusLabel(command.state)}{command.reason ? ` · ${command.reason}` : ''}</span></div><time>{relativeTime(command.createdAt)}</time>
  </div>)}</div> : <div className="activity-empty"><span className="soft-icon"><Clock3 size={20}/></span><div><strong>A fresh start together</strong><p>Videos and messages you send will appear here.</p></div></div>; }

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand-link" href="/" aria-label="MomPilot home"><Brand /></a><p className="sidebar-tagline">Care, from wherever you are.</p>
      <div className="nav-label">YOUR SPACE</div><nav aria-label="Main navigation">{([{name: 'Home', icon: Home}, {name: 'Favorites', icon: Heart}, {name: 'Browse library', icon: LayoutGrid}, {name: 'Activity', icon: Clock3}] as const).map(link => <button key={link.name} aria-current={page === link.name ? "page" : undefined} className={`nav-item ${page === link.name ? 'active' : ''}`} onClick={() => {setPage(link.name); setQuery(''); setCategory('All videos');}}><link.icon size={19}/><span>{link.name}</span>{link.name === 'Favorites' && <span className="nav-count">{saved.length}</span>}</button>)}</nav>
      <div className="nav-label family-label">YOUR FAMILY<button className="icon-button" title="Pair another TV" onClick={() => setModal('pair')}><Plus size={16}/></button></div>
      <button className="family-link" onClick={() => setModal('family')}><span className="family-avatar">M<span className={device?.online ? 'online-dot' : 'offline-dot'}/></span><span><strong>Mom’s TV</strong><small>{device ? device.online ? 'MomPilot is open' : 'Currently unavailable' : 'Let’s get connected'}</small></span><ChevronRight size={16}/></button>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="note-heart"><Heart size={21}/></span><strong>Little moments.<br/>Closer connections.</strong><p>You pick the video.<br/>They feel the love.</p></div><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={18}/>Help & how it works<ArrowUpRight size={15}/></button><button className="profile" onClick={() => {setProfileDraft(name); setModal('profile');}}><span className="profile-avatar">{name.charAt(0).toUpperCase()}</span><span><strong>{name}</strong><small>Local demo profile</small></span><MoreHorizontal size={19}/></button></div>
    </aside>
    <div className="main-wrap"><header className="topbar"><div className="breadcrumb">Your space <ChevronRight size={13}/><span>{page}</span></div><div className="topbar-right"><button className="mobile-profile" aria-label="Edit caregiver profile" onClick={() => {setProfileDraft(name); setModal("profile");}}>{name.charAt(0)}</button><span className="demo-badge"><span/>LOCAL DEMO</span><a href="/tv" target="_blank" rel="noreferrer" className="text-button"><Monitor size={16}/>Open TV demo<ArrowUpRight size={14}/></a></div></header>
      <main><div className="page-heading"><div><div className="eyebrow greeting">A LITTLE CLOSER, FROM ANYWHERE</div><h1>{page === 'Home' ? <>Hi {name}, make her day<span>.</span></> : page === 'Favorites' ? <>Her familiar favorites<span>.</span></> : page === 'Browse library' ? <>Find her next favorite<span>.</span></> : <>The little things you’ve sent<span>.</span></>}</h1><p>{page === 'Home' ? 'A favorite film. A thoughtful message. A little moment together.' : page === 'Favorites' ? 'The good ones, saved for another lovely afternoon.' : page === 'Browse library' ? 'A small collection of openly licensed films to try together.' : 'Delivery updates from MomPilot, acknowledged by the TV.'}</p></div><span className="heading-decoration"><Heart size={30} strokeWidth={1.2}/><Sparkles size={17}/></span></div>
      {loadError && <div className="error-banner" role="alert"><Wifi size={19}/><span>{loadError}</span><button onClick={() => location.reload()}>Retry</button></div>}
      {loading ? <div className="loading-state"><LoaderCircle className="spin"/>Getting your space ready…</div> : <>
      {page === 'Home' && <div className="dashboard-columns"><div className="main-column">
        <section className="device-card"><div className="device-card-top"><span className="eyebrow"><Tv2 size={16}/>YOUR SHARED SCREEN</span><button className="icon-button" onClick={() => setModal('family')} aria-label="TV settings"><MoreHorizontal size={21}/></button></div><div className="device-body"><div className="device-details"><div className={`connection-pill ${canSend ? 'available' : ''}`}><span/>{device ? device.online ? device.quiet ? 'Quiet time is on' : 'Online & ready' : 'MomPilot is unavailable' : 'Waiting for your connection'}</div><h2>{device?.name || 'Mom’s living room'}</h2><p>{device ? device.online ? 'A familiar favorite is just a tap away.' : 'Ask Mom to open MomPilot on her TV.' : 'Their favorite place. Your little way to help.'}</p>{device ? <div className="device-actions"><button className="primary small" onClick={() => {setPage('Browse library'); setQuery('');}}><Play size={15} fill="currentColor"/>Pick something to play</button><button className="icon-button bordered" aria-label="Manage TV" onClick={() => setModal('family')}><Settings2 size={17}/></button></div> : <button className="primary small" onClick={() => setModal('pair')}><Link2 size={16}/>Connect a TV</button>}</div><div className="mini-tv" aria-label="MomPilot illustration, not a live screen"><div className="mini-tv-screen"><span className="mini-tv-brand"><Heart size={12}/>MomPilot</span><div className="tv-heart"><Heart size={39} strokeWidth={1.3}/></div><span>A little something<br/>just for you.</span><small>ILLUSTRATION · NOT A LIVE VIEW</small></div><div className="tv-stand"/></div></div><div className="device-card-bottom"><span><ShieldCheck size={14}/>Only connected to MomPilot</span><span>{device ? <>Last seen {relativeTime(device.lastSeenAt).toLowerCase()}</> : 'Simple. Private. Together.'}</span></div></section>
        {device?.playback && playingItem && ['PLAYING','PAUSED'].includes(device.playback.state) && <section className="now-playing"><span className="sound-bars"><i/><i/><i/></span><div><span>{device.playback.state === 'PLAYING' ? 'PLAYING ON TV' : 'PAUSED ON TV'}</span><strong>{playingItem.title}</strong></div><button className="icon-button" disabled={!canSend || busy} onClick={() => send(device.playback?.state === 'PLAYING' ? 'PAUSE' : 'RESUME')} aria-label={device.playback.state === 'PLAYING' ? 'Pause on TV' : 'Resume on TV'}>{device.playback.state === 'PLAYING' ? <Pause size={20}/> : <Play size={20}/>}</button></section>}
        {currentCommand && <div className={`delivery-strip ${['FAILED','EXPIRED'].includes(currentCommand.state) ? 'delivery-error' : ''}`} role="status">{['QUEUED','RECEIVED'].includes(currentCommand.state) ? <LoaderCircle size={16} className="spin"/> : ['FAILED','EXPIRED'].includes(currentCommand.state) ? <CircleHelp size={16}/> : <CheckCheck size={17}/>}<span>{statusLabel(currentCommand.state)}{currentCommand.reason ? ` · ${currentCommand.reason}` : ''}</span><button className="icon-button" aria-label="Dismiss delivery status" onClick={() => setActiveCommand(null)}><X size={14}/></button></div>}
        <section className="favorites-section"><div className="section-heading"><h2>Her happy-place picks <Heart size={17}/></h2><button className="text-button" onClick={() => setPage('Favorites')}>All favorites<ChevronRight size={15}/></button></div>{displayedItems.length ? cards(displayedItems.slice(0,3)) : <div className="empty-state"><Heart/><h3>A home for her favorites</h3><p>Tap a heart in the library to save something for later.</p><button className="secondary" onClick={() => setPage('Browse library')}>Browse library</button></div>}</section>
        <section className="recent-section"><div className="section-heading"><h2>A little lately</h2><button className="text-button" onClick={() => setPage('Activity')}>View activity<ChevronRight size={15}/></button></div>{activity(3)}</section>
      </div><aside className="right-column"><section className="message-card"><span className="message-icon"><MessageCircle size={24}/><Heart size={11} fill="currentColor"/></span><h2>Send a little reassurance.</h2><p>A few words can feel like you’re<br className="desktop-break"/> right there.</p><div className="message-options" role="group" aria-label="Choose a message">{messages.map(message => <button aria-pressed={message.id === messageId} className={message.id === messageId ? 'selected' : ''} key={message.id} onClick={() => setMessageId(message.id)}><span>{message.emoji}</span>{message.label}{message.id === messageId && <Check size={15}/>}</button>)}</div><div className="message-preview"><span>ON THEIR TV</span><p>“{selectedMessage.text}”</p><small>From {name}, with love</small></div><button className="primary full" onClick={() => send('SHOW_MESSAGE', {messageId})} disabled={busy || (!!device && !canSend)}><Send size={16}/>{device ? 'Send to Mom’s TV' : 'Connect a TV to send'}</button><div className="message-hint"><Monitor size={13}/>{device?.quiet ? 'Mom has turned on quiet time.' : 'Shown only while MomPilot is open.'}</div></section><section className="care-note"><span><ShieldCheck size={22}/></span><div><h3>A helping hand.<br/>Their space, always.</h3><p>Mom stays in control. She can dismiss messages or disconnect anytime.</p><button className="text-button" onClick={() => setModal('help')}>How MomPilot works<ChevronRight size={14}/></button></div></section></aside></div>}
      {(page === 'Favorites' || page === 'Browse library') && <section className="library-section"><div className="library-toolbar"><label className="search-field"><Search size={19}/><input aria-label="Search the video library" placeholder="Find a film, a story, a favorite…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16}/></button>}</label><div className="filter-select"><select aria-label="Filter category" value={category} onChange={e => setCategory(e.target.value)}>{['All videos', ...new Set(items.map(i => i.category))].map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={16}/></div></div><div className="library-count">{displayedItems.length} {displayedItems.length === 1 ? 'film' : 'films'}{page === 'Favorites' ? ' saved with love' : ' to watch together'}<span>BLENDER OPEN MOVIES</span></div>{displayedItems.length ? cards(displayedItems) : <div className="empty-state"><Search/><h3>{query ? 'No films found' : 'No favorites here yet'}</h3><p>{query ? 'Try a different title or category.' : 'Save a film from the library using its heart button.'}</p><button className="secondary" onClick={() => {setPage('Browse library'); setQuery(''); setCategory('All videos');}}>Show all films</button></div>}<p className="catalog-note"><ShieldCheck size={16}/>An openly licensed demo collection. Preview each film to see its source and content notes.</p></section>}
      {page === 'Activity' && <section className="activity-panel"><div className="section-heading"><h2>From your phone to their screen</h2><span className="muted">{device?.name || 'No TV connected'}</span></div>{activity()}<div className="activity-footnote"><ShieldCheck size={16}/>Playback updates cover MomPilot only. A YouTube launch does not confirm playback or provide control of its player.</div></section>}
      </>}
      <footer className="page-footer"><span><Heart size={12}/>A little help goes a long way.</span><span>MomPilot · Built for the people you love</span></footer>
    </main></div>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19}/> : <CheckCheck size={19}/>}<span>{notice.text}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16}/></button></div>}
    <dialog aria-label={preview ? `Preview ${preview.title}` : modal === "pair" ? "Connect a TV" : modal === "family" ? "Your family screens" : modal === "profile" ? "Caregiver profile" : "How MomPilot works"} ref={dialogRef} className={`modal ${preview ? 'preview-modal' : ''}`} onCancel={closeModal} onClick={e => {if (e.target === e.currentTarget) closeModal();}}><button className="modal-close icon-button" aria-label="Close dialog" onClick={closeModal}><X size={21}/></button>
      {preview && <><img className="preview-image" src={preview.thumbnail} alt={`Still from ${preview.title}`}/><div className="modal-content"><span className="eyebrow">{preview.category} · {preview.duration}</span><h2>{preview.title}</h2><p>{preview.description}</p><div className="source-credit"><ShieldCheck size={17}/><span>{preview.attribution.creator} · <a href={preview.attribution.licenseUrl} target="_blank" rel="noreferrer">{preview.attribution.license}</a><br/><a href={preview.attribution.sourceUrl} target="_blank" rel="noreferrer">Original film & content details <ArrowUpRight size={12}/></a></span></div><div className="preview-target"><Tv2 size={21}/><div><strong>{device?.name || 'Connect your first TV'}</strong><span>{device ? device.quiet ? 'Quiet time is on' : canSend ? 'Ready for a little movie time' : 'Open MomPilot on the TV to play' : 'Pair with the code shown on MomPilot'}</span></div></div><button className="primary full" disabled={busy || (!!device && !canSend)} onClick={() => send('PLAY_CATALOG_ITEM', {itemId: preview.id})}>{busy ? <LoaderCircle size={18} className="spin"/> : <Play size={18} fill="currentColor"/>}{device ? 'Play on TV' : 'Connect a TV'}</button><small className="modal-note">Plays inside MomPilot. The TV confirms when playback begins.</small>{preview.id === 'bunny' && <div className="youtube-experiment"><span className="eyebrow">YOUTUBE EXPERIMENT</span><p>Try this film in the installed YouTube app. MomPilot remote help pauses when YouTube opens; reopen MomPilot to send more requests.</p><button className="secondary full" disabled={busy || !canSend} onClick={() => send('OPEN_YOUTUBE', {itemId: 'bunny'})}><ArrowUpRight size={18}/>Try opening YouTube on TV</button><small>Native Android TV only. Launching does not confirm playback. Fire TV support is unverified.</small></div>}</div></>}
      {modal === 'pair' && <div className="modal-content"><span className="modal-symbol"><Link2 size={26}/></span><span className="eyebrow">A SIMPLE CONNECTION</span><h2>A little closer in a moment.</h2><p>Open MomPilot on the TV and enter the six-digit code displayed on its screen.</p><a className="demo-open-link" href="/tv" target="_blank" rel="noreferrer"><Monitor size={19}/><span>Trying it out? Open the browser TV demo.</span><ArrowUpRight size={16}/></a><form onSubmit={pair}><label className="field-label" htmlFor="pair-code">Code on the TV</label><input id="pair-code" className="code-input" autoComplete="off" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={pairCode} onChange={e => setPairCode(e.target.value.replace(/\D/g,''))} required/><label className="field-label" htmlFor="tv-name">Give this TV a familiar name</label><input id="tv-name" className="text-input" value={tvName} maxLength={60} onChange={e => setTvName(e.target.value)} required/>{pairError && <p role="alert" className="form-error">{pairError}</p>}<button className="primary full" disabled={busy || pairCode.length !== 6 || !tvName.trim()}>{busy ? <LoaderCircle className="spin" size={18}/> : <Link2 size={18}/>}Connect with care</button></form><small className="modal-note"><ShieldCheck size={14}/>The code expires in 5 minutes. Mom can disconnect anytime.</small></div>}
      {modal === 'family' && <div className="modal-content"><span className="modal-symbol"><Tv2 size={26}/></span><h2>Your family’s screens.</h2><p>Choose a TV to send videos and little notes to.</p>{devices.length ? devices.map(d => <button key={d.id} className={`device-option ${device?.id === d.id ? 'selected' : ''}`} onClick={() => {chooseDevice(d.id); closeModal();}}><Monitor size={24}/><span><strong>{d.name}</strong><small>{d.online ? d.quiet ? 'Quiet time is on' : 'MomPilot is open' : `Unavailable · last seen ${relativeTime(d.lastSeenAt)}`}</small></span>{device?.id === d.id && <Check size={19}/>}</button>) : <div className="empty-state compact"><Monitor/><p>No screens connected yet.</p></div>}<button className="primary full" onClick={() => setModal('pair')}><Plus size={18}/>Connect a TV</button><small className="modal-note">To revoke access or set quiet time, use Settings on the TV.</small></div>}
      {modal === 'help' && <div className="modal-content"><span className="modal-symbol"><Heart size={26}/></span><h2>Care, without the confusion.</h2><p>MomPilot helps you put a video or a small message on a loved one’s TV.</p><ol className="help-steps"><li><span>1</span><div><strong>Connect once.</strong><p>Open the TV demo, then enter its pairing code here.</p></div></li><li><span>2</span><div><strong>Find a familiar favorite.</strong><p>Preview a film and choose Play on TV. Watch for the TV’s acknowledgment.</p></div></li><li><span>3</span><div><strong>Let them settle in.</strong><p>They can pause, go home, turn on quiet time, or disconnect on the TV.</p></div></li></ol><div className="honesty-note"><ShieldCheck size={19}/><p>This local demo controls only MomPilot while it’s open. It cannot wake a TV, view its screen, or control other apps. Browser playback may need a tap on Play. The optional YouTube experiment opens one approved film in the native Android TV app, then remote help pauses. AWS and real Fire TV testing are still to come.</p></div><button className="primary full" onClick={closeModal}>Got it</button></div>}
      {modal === 'profile' && <div className="modal-content"><span className="modal-symbol"><Heart size={26}/></span><h2>A familiar name.</h2><p>Your name appears on the paired TV so Mom knows who is helping.</p><form onSubmit={async e => {e.preventDefault(); setBusy(true); try {const session = await post<{caregiver:{name:string}}>('/session',{name:profileDraft}); setName(session.caregiver.name); closeModal(); await refresh();} catch(error){setPairError((error as Error).message);} finally{setBusy(false);}}}><label className="field-label" htmlFor="profile-name">Your name</label><input id="profile-name" className="text-input" maxLength={60} value={profileDraft} onChange={e=>setProfileDraft(e.target.value)} required/>{pairError && <p className="form-error" role="alert">{pairError}</p>}<button className="primary full" disabled={busy || !profileDraft.trim()}>Save name</button></form><div className="honesty-note"><ShieldCheck size={18}/><p>This is a local demo profile, without a password or identity verification. Do not expose the demo relay to the public internet.</p></div></div>}
    </dialog>
  </div>;
}
