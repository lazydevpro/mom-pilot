import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Heart, Home, LoaderCircle, MessageCircle, Monitor, Moon, Pause, Play, RefreshCw, Settings, ShieldCheck, Volume2, X } from 'lucide-react';
import { Brand } from './App';
import { api, post, messages, ApiError, type Command, type Credentials, type Device, type Item, type Playback } from './api';

export default function Tv() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Item | null>(null);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  const [awake, setAwake] = useState(true);
  const [remaining, setRemaining] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const awakeRef = useRef(true);
  const itemsRef = useRef<Item[]>([]);
  const currentRef = useRef<Item | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const commandRef = useRef<Command | null>(null);
  const playGeneration = useRef(0);
  const seen = useRef<Set<string>>(new Set(JSON.parse(localStorage.getItem('mompilot-tv-seen') || '[]')));
  const acknowledgments = useRef<Record<string, {id: string; state: string; reason?: string}>>(JSON.parse(localStorage.getItem('mompilot-tv-acks') || '{}'));

  function updateDevice(value: Device) { deviceRef.current = value; setDevice(value); }
  function remember(command: Command) { seen.current.add(command.id); localStorage.setItem('mompilot-tv-seen', JSON.stringify([...seen.current].slice(-500))); }
  async function ack(command: Command, state: string, reason?: string) {
    acknowledgments.current[command.id] = {id: command.id, state, ...(reason ? {reason} : {})};
    localStorage.setItem('mompilot-tv-acks', JSON.stringify(acknowledgments.current));
    try {
      await post('/tv/ack', acknowledgments.current[command.id], credentialsRef.current!.token);
      delete acknowledgments.current[command.id];
      localStorage.setItem('mompilot-tv-acks', JSON.stringify(acknowledgments.current));
    } catch { /* The polling loop retries; command expiry remains the final bound. */ }
  }
  async function heartbeat() {
    if (!credentialsRef.current) return;
    const video = videoRef.current;
    if (playbackRef.current && video) playbackRef.current = {...playbackRef.current, position: Number.isFinite(video.currentTime) ? video.currentTime : 0, duration: Number.isFinite(video.duration) ? video.duration : 0};
    const {device: next} = await post<{device: Device}>('/tv/heartbeat', {foreground: awakeRef.current, playback: playbackRef.current}, credentialsRef.current.token);
    updateDevice(next);
  }
  function cancelPending(reason: string) { playGeneration.current++; const command = commandRef.current; commandRef.current = null; if (command) void ack(command, 'FAILED', reason); }
  function stopPlayback() { playGeneration.current++; cancelPending('Playback was canceled on the TV before it began.'); videoRef.current?.pause(); currentRef.current = null; videoRef.current?.removeAttribute('src'); videoRef.current?.load(); setCurrent(null); setPlaying(false); playbackRef.current = null; }
  async function playItem(item: Item, command?: Command) {
    const generation = ++playGeneration.current;
    if (commandRef.current) await ack(commandRef.current, 'FAILED', 'Another video was selected before playback began.');
    if (generation !== playGeneration.current) return;
    commandRef.current = command || null;
    currentRef.current = item; setCurrent(item); setSettings(false); setError('');
    playbackRef.current = {itemId: item.id, state: 'IDLE', position: 0, duration: 0};
    const video = videoRef.current!;
    video.src = item.videoUrl;
    video.load();
    try { await video.play(); }
    catch {
      if (generation !== playGeneration.current) return;
      const pending = commandRef.current; commandRef.current = null;
      if (pending) await ack(pending, 'FAILED', 'Browser needs a tap on Play on the TV, or the video could not load.');
      setError('Select Play here to allow sound and start the film.');
    }
  }
  async function execute(command: Command) {
    if (new Date(command.expiresAt).getTime() <= Date.now() || !awakeRef.current || deviceRef.current?.quiet) return;
    if (seen.current.has(command.id)) {
      if (commandRef.current?.id !== command.id && !acknowledgments.current[command.id]) await ack(command, 'FAILED', 'The TV restarted or this command was already handled. Please send a new command.');
      return;
    }
    await post('/tv/ack', {id: command.id, state: 'RECEIVED'}, credentialsRef.current!.token);
    remember(command);
    if (new Date(command.expiresAt).getTime() <= Date.now() || !awakeRef.current || deviceRef.current?.quiet) { await ack(command, 'FAILED', 'The TV is no longer accepting this request.'); return; }
    if (command.type === 'PLAY_CATALOG_ITEM') {
      const item = itemsRef.current.find(i => i.id === command.itemId);
      if (!item) { await ack(command, 'FAILED', 'This video is not in the approved library.'); return; }
      void playItem(item, command);
    } else if (command.type === 'OPEN_YOUTUBE') {
      await ack(command, 'FAILED', 'YouTube launching requires the native Android TV app and an installed compatible YouTube app.');
    } else if (command.type === 'SHOW_MESSAGE') {
      const preset = messages.find(m => m.id === command.messageId);
      if (!preset) { await ack(command, 'FAILED', 'Message not found.'); return; }
      setSettings(false); setMessage(preset.text); await ack(command, 'DISPLAYED');
    } else if (!currentRef.current || !videoRef.current) {
      await ack(command, 'FAILED', 'There is no film playing inside MomPilot.');
    } else if (command.type === 'PAUSE') {
      cancelPending('Playback was paused before this video began.');
      videoRef.current.pause(); await ack(command, 'PAUSED');
    } else if (command.type === 'RESUME') {
      commandRef.current = command;
      try { await videoRef.current.play(); if (!videoRef.current.paused) { await ack(command, 'PLAYING'); commandRef.current = null; } }
      catch { commandRef.current = null; await ack(command, 'FAILED', 'Select Play on the TV to allow playback.'); }
    }
  }
  useEffect(() => {
    let stopped = false; let polling = false;
    (async () => {
      try {
        const {items: catalog} = await api<{items: Item[]}>('/catalog'); itemsRef.current = catalog; setItems(catalog);
        let saved: Credentials | null = null;
        try { saved = JSON.parse(localStorage.getItem('mompilot-tv') || 'null'); } catch { /* Re-register invalid storage. */ }
        if (saved) {
          credentialsRef.current = saved; setCredentials(saved);
          try { const result = await api<{device: Device}>('/tv/commands', {}, saved.token); updateDevice(result.device); }
          catch (error) { if (error instanceof ApiError && error.status === 401) {saved = null; credentialsRef.current = null;setCredentials(null);} else throw error; }
        }
        if (!saved) saved = await post<Credentials>('/tv/register');
        if (stopped) return;
        credentialsRef.current = saved; setCredentials(saved); localStorage.setItem('mompilot-tv', JSON.stringify(saved));
        await heartbeat();
      } catch { setError('Couldn’t connect to the local relay. Start npm run dev, then reload this page.'); }
    })();
    const poll = setInterval(async () => {
      if (!credentialsRef.current || polling || !awakeRef.current) return;
      polling = true;
      try {
        for (const result of Object.values(acknowledgments.current)) {
          try { await post('/tv/ack', result, credentialsRef.current.token); delete acknowledgments.current[result.id]; }
          catch { /* Expired entries are removed when no longer in the queue below. */ }
        }
        const result = await api<{commands: Command[]; device: Device}>('/tv/commands', {}, credentialsRef.current.token);
        if (deviceRef.current?.paired && !result.device.paired) { stopPlayback(); setMessage(null); }
        updateDevice(result.device);
        setError(previous => previous.startsWith('Connection interrupted.') ? '' : previous);
        const pendingIds = new Set(result.commands.map(c => c.id));
        Object.keys(acknowledgments.current).forEach(id => {if (!pendingIds.has(id)) delete acknowledgments.current[id];});
        localStorage.setItem('mompilot-tv-acks', JSON.stringify(acknowledgments.current));
        if (result.device.paired && !result.device.quiet) for (const command of result.commands) await execute(command);
        const currentCommand = commandRef.current;
        if (currentCommand && new Date(currentCommand.expiresAt).getTime() <= Date.now()) {commandRef.current = null; stopPlayback(); setError('The play request expired. Please choose a video again.');}
      } catch { setError('Connection interrupted. Reconnecting to MomPilot…'); }
      finally { polling = false; }
    }, 1200);
    const pulse = setInterval(() => { void heartbeat().catch(() => {}); }, 4000);
    const clock = setInterval(() => { setRemaining(Math.max(0, Math.ceil((new Date(credentialsRef.current?.expiresAt || 0).getTime() - Date.now()) / 1000))); }, 1000);
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Backspace') {event.preventDefault(); if (message) setMessage(null); else if (settings) setSettings(false); else stopPlayback();}
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || document.activeElement?.tagName === 'VIDEO') return;
      const scope = document.querySelector('.tv-overlay') || document.querySelector('.tv-app');
      const targets = [...scope!.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href]')].filter(el => el.offsetParent !== null);
      const active = document.activeElement as HTMLElement;
      if (!targets.includes(active as HTMLButtonElement)) {targets[0]?.focus(); return;}
      const a = active.getBoundingClientRect(); const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
      const direction = event.key.replace('Arrow','');
      const next = targets.filter(el => el !== active).map(el => {const b = el.getBoundingClientRect(); return {el, dx: b.x + b.width/2 - ax, dy: b.y + b.height/2 - ay};}).filter(p => direction === 'Right' ? p.dx > 5 : direction === 'Left' ? p.dx < -5 : direction === 'Down' ? p.dy > 5 : p.dy < -5).sort((a,b) => (['Right','Left'].includes(direction) ? Math.abs(a.dx)+Math.abs(a.dy)*3 - Math.abs(b.dx)-Math.abs(b.dy)*3 : Math.abs(a.dy)+Math.abs(a.dx)*3 - Math.abs(b.dy)-Math.abs(b.dx)*3))[0];
      if (next) {event.preventDefault(); next.el.focus();}
    };
    // Arrow navigation stays native and focusable. Escape is handled by the current render below.
    const arrows = (e: KeyboardEvent) => { if (e.key.startsWith('Arrow')) keys(e); };
    document.addEventListener('keydown', arrows);
    const leave = () => { if (credentialsRef.current) void fetch('/api/tv/heartbeat', {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credentialsRef.current.token}`},body:JSON.stringify({foreground:false}),keepalive:true}); };
    window.addEventListener('pagehide', leave);
    return () => {stopped=true; clearInterval(poll);clearInterval(pulse);clearInterval(clock);document.removeEventListener('keydown',arrows);window.removeEventListener('pagehide',leave);};
  }, []);
  useEffect(() => {const handler=(e: KeyboardEvent)=>{if(e.key==='Escape'||e.key==='Backspace'){e.preventDefault();if(message)setMessage(null);else if(settings)setSettings(false);else stopPlayback();}};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);},[message,settings]);
  useEffect(() => {
    if (!message && !settings) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const background = [...document.querySelector('.tv-app')!.children].filter(element => !element.classList.contains('tv-overlay')) as HTMLElement[];
    background.forEach(element => { element.inert = true; });
    const overlay = document.querySelector<HTMLElement>('.tv-overlay')!;
    overlay.querySelector<HTMLButtonElement>('button')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = [...overlay.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (event.shiftKey && document.activeElement === buttons[0]) {event.preventDefault();buttons.at(-1)?.focus();}
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {event.preventDefault();buttons[0]?.focus();}
    };
    document.addEventListener('keydown', trapFocus);
    return () => {background.forEach(element => {element.inert = false;});document.removeEventListener('keydown', trapFocus);if(previousFocus?.isConnected)previousFocus.focus();};
  },[message,settings]);
  async function refreshCode() {try {const pair = await post<{code:string;expiresAt:string}>('/tv/pairing',{},credentialsRef.current!.token);const next={...credentialsRef.current!,...pair};credentialsRef.current=next;setCredentials(next);localStorage.setItem('mompilot-tv',JSON.stringify(next));setError('');} catch(e){setError((e as Error).message);}}
  async function revoke() {try {const result=await post<{device:Device;code:string;expiresAt:string}>('/tv/revoke',{},credentialsRef.current!.token);updateDevice(result.device);stopPlayback();setMessage(null);commandRef.current=null;const next={...credentialsRef.current!,code:result.code,expiresAt:result.expiresAt};credentialsRef.current=next;setCredentials(next);localStorage.setItem('mompilot-tv',JSON.stringify(next));setSettings(false);}catch(e){setError((e as Error).message);}}
  async function toggleQuiet() {try {const result=await post<{device:Device}>('/tv/settings',{quiet:!device?.quiet},credentialsRef.current!.token);updateDevice(result.device);if(result.device.quiet && commandRef.current)stopPlayback();}catch(e){setError((e as Error).message);}}
  async function sleep() {awakeRef.current=!awakeRef.current;setAwake(awakeRef.current);if(!awakeRef.current){if(commandRef.current)stopPlayback();else videoRef.current?.pause();}try{await heartbeat();}catch(e){setError((e as Error).message);}}
  function playerState(state:string) {setPlaying(state==='PLAYING');if(playbackRef.current)playbackRef.current={...playbackRef.current,state};void heartbeat().catch(()=>{});}

  return <div className={`tv-app ${current ? 'has-video' : ''}`}><header className="tv-header"><Brand light/><div className="tv-top-actions"><span className="tv-demo-label"><Monitor size={15}/>Browser TV demo</span>{device?.paired && <button onClick={()=>setSettings(true)}><Settings size={20}/>Settings</button>}</div></header>
    <video ref={videoRef} className={`tv-video ${current ? 'visible' : ''}`} controls playsInline onPlaying={()=>{const command=commandRef.current;if(!awakeRef.current || (command && (deviceRef.current?.quiet || !deviceRef.current?.paired || new Date(command.expiresAt).getTime()<=Date.now()))){stopPlayback();return;}playerState('PLAYING');setError('');if(command){commandRef.current=null;void ack(command,'PLAYING');}}} onPause={()=>playerState('PAUSED')} onEnded={()=>playerState('ENDED')} onError={()=>{if(!currentRef.current)return;playerState('FAILED');setError('This film couldn’t load. Check the connection or try another favorite.');const command=commandRef.current;if(command){commandRef.current=null;void ack(command,'FAILED','Video could not load on the TV.');}}}/>
    {!awake ? <section className="tv-sleep"><Moon size={64}/><h1>Taking a little break.</h1><p>MomPilot is unavailable to your caregiver.</p><button className="tv-primary" onClick={sleep}><Home size={24}/>Open MomPilot</button></section> : <>
      {!device?.paired ? <section className="tv-pairing"><div><span className="eyebrow">A LITTLE HELP FROM SOMEONE YOU LOVE</span><h1>Your favorites.<br/>A little closer.</h1><p>Ask your family to open MomPilot<br/>and enter this code to connect.</p><div className="tv-pairing-privacy"><ShieldCheck size={28}/><p>They can send videos and messages to this app.<br/>They can’t see your screen. You can disconnect anytime.</p></div></div><div className="tv-code-card"><span>YOUR CONNECTION CODE</span><strong>{credentials?.code ? credentials.code.match(/.{1,3}/g)?.join(' ') : '··· ···'}</strong><p>{remaining > 0 ? `Expires in ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}` : credentials ? 'This code has expired.' : 'Getting your code ready…'}</p><button className="tv-secondary" onClick={refreshCode} disabled={!credentials}><RefreshCw size={19}/>Get a new code</button><small>On the caregiver page, choose Connect a TV.</small></div></section> : current ? <section className="tv-player-caption"><button className="tv-secondary" onClick={stopPlayback}><ArrowLeft size={21}/>Home</button><div><span>NOW ON MOMPILOT</span><h2>{current.title}</h2></div><button className="tv-primary" onClick={()=>{if(playing)videoRef.current?.pause();else void videoRef.current?.play().catch(()=>setError('The video couldn’t start. Try another film.'));}}>{playing ? <Pause/> : <Play/>}{playing ? 'Pause' : 'Play'}</button></section> : <section className="tv-home"><div className="tv-welcome"><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1>A little time for you<span>.</span></h1><p>{device.caregiver?.name || 'Your family'} can send you videos and messages. You’re in control.</p></div><div className="tv-home-actions"><button className="tv-primary" onClick={()=>{const item=items.find(i=>i.id===device.playback?.itemId)||items[0];if(item)void playItem(item);}}><Play size={28}/>Continue</button><button className="tv-secondary" onClick={()=>document.querySelector<HTMLButtonElement>('.tv-film')?.focus()}><Heart size={25}/>Favorites</button><button className="tv-secondary" onClick={()=>setMessage('Your family can pick a film for you. Use the arrows to choose a favorite, or select Continue. Press Back to come home anytime.')}><MessageCircle size={25}/>Help</button></div><div className="tv-films">{items.map(item=><button key={item.id} className="tv-film" onClick={()=>void playItem(item)}><img src={item.thumbnail} alt=""/><span><strong>{item.title}</strong><small>{item.duration} · {item.category}</small></span><Play size={23}/></button>)}</div></section>}
    </>}
    {error && <div className="tv-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={20}/></button></div>}
    <footer className="tv-footer"><span><ShieldCheck size={18}/>{device?.quiet ? 'Quiet time · family requests paused' : device?.paired ? `Connected with ${device.caregiver?.name || 'your family'}` : 'Your TV. Your space. Always.'}</span><button onClick={sleep}><Moon size={17}/>{awake ? 'Simulate app closed' : 'Open MomPilot'}</button><span>Use arrow keys & Enter · Esc returns home</span></footer>
    {message && <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="A message for you"><div className="tv-message-dialog"><Heart size={46}/><span>A LITTLE NOTE FROM {device?.caregiver?.name?.toUpperCase() || 'MOMPILOT'}</span><h2>{message}</h2><button className="tv-primary" onClick={()=>setMessage(null)}><Check size={24}/>Got it, thank you</button></div></div>}
    {settings && <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="TV settings"><div className="tv-settings-dialog"><h2>Your space, your choice.</h2><p>{device?.caregiver?.name} can send videos and messages to this app.</p><button className="tv-secondary" onClick={toggleQuiet}><Moon size={24}/>{device?.quiet ? 'Turn quiet time off' : 'Turn quiet time on'}</button><p className="tv-settings-note">Quiet time pauses incoming videos and messages.</p><button className="tv-secondary" onClick={revoke}><ShieldCheck size={24}/>Disconnect caregiver</button><button className="tv-primary" onClick={()=>setSettings(false)}><Home size={24}/>Back to home</button></div></div>}
  </div>;
}
