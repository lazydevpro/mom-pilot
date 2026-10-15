export type AppId = 'youtube' | 'netflix' | 'prime';
export type Show = { id: string; title: string; link: string; app: AppId; contentId: string; image: string | null; createdAt: string };
export type Device = {
  id: string; name: string; paired: boolean; caregiver: { id: string; name: string } | null;
  appOnline: boolean; lastSeenAt: string | null; pairedAt: string | null; adbTarget: string | null;
};
export type AdbStatus = { state: string; awake?: boolean | null; app?: string | null; package?: string | null; message?: string };
export type Command = {
  id: string; type: string; app: AppId; showId?: string; title?: string; via: 'adb' | 'tv' | null;
  state: string; reason: string | null; createdAt: string;
};
export type Details = { device: Device; adb: AdbStatus; commands: Command[] };
export type Key = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home' | 'playPause' | 'rewind' | 'fastForward' | 'volumeUp' | 'volumeDown' | 'mute';

export const APP_NAMES: Record<string, string> = { youtube: 'YouTube', netflix: 'Netflix', prime: 'Prime Video', home: 'Home screen' };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: Record<string, unknown>) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  } catch {
    throw new ApiError('Can’t reach the MomPilot server. Check your connection.', 0);
  }
  // A proxy or server error page may not be JSON.
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || 'Something went wrong. Please try again.', response.status, data.error, data);
  return data;
}
export const post = <T,>(path: string, data: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const remove = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export function requestKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** One line describing whether Mom's TV can be controlled right now. */
export function tvStatus(details: Details | null): { text: string; tone: 'good' | 'warn' | 'bad' } {
  if (!details) return { text: 'No TV connected', tone: 'bad' };
  const { adb, device } = details;
  if (adb.state === 'CONNECTED') {
    if (adb.awake === false) return { text: 'TV is asleep', tone: 'warn' };
    return { text: adb.app ? `${APP_NAMES[adb.app] || adb.app} is open` : 'Connected', tone: 'good' };
  }
  if (device.appOnline) return { text: adb.state === 'NOT_SET' ? 'MomPilot app is open' : 'Remote unavailable', tone: 'warn' };
  return { text: 'Can’t reach the TV', tone: 'bad' };
}
