export type Item = { id: string; title: string; subtitle?: string; description: string; category: string; duration: string; videoUrl: string; thumbnail: string; attribution: {creator: string; title: string; sourceUrl: string; license: string; licenseUrl: string} };
export type Playback = { itemId: string; state: string; position: number; duration: number };
export type Device = { id: string; name: string; online: boolean; lastSeenAt: string | number | null; caregiver?: {id: string; name: string} | null; paired: boolean; quiet: boolean; playback?: Playback | null };
export type Command = { id: string; deviceId: string; type: string; state: string; itemId?: string; messageId?: string; createdAt: string | number; expiresAt: string | number; reason?: string };
export type Credentials = { deviceId: string; token: string; code: string; expiresAt: string | number };
export const messages = [
  { id: 'found-video', text: 'I found the video for you ❤️', label: 'Found your video', emoji: '♡' },
  { id: 'enjoy', text: 'Sit back and enjoy. Love you!', label: 'A little love', emoji: '☀' },
  { id: 'call-me', text: 'Give me a call when you’re ready.', label: 'Call me when you’re free', emoji: '☎' },
];
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export function commandKey() { if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); return [...crypto.getRandomValues(new Uint8Array(24))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.message || data.error || 'Something went wrong. Please try again.', response.status);
  return data;
}
export const post = <T,>(path: string, data: unknown = {}, token?: string) => api<T>(path, { method: 'POST', body: JSON.stringify(data) }, token);
export function relativeTime(value: string | number | null | undefined): string {
  if (!value) return 'Not connected yet';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
