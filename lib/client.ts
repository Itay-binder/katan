'use client';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Action, GameView } from './engine/types';

const tokenKey = (id: string) => `katan:${id}`;
export function getToken(id: string): string | null {
  try { return localStorage.getItem(tokenKey(id)); } catch { return null; }
}
export function setToken(id: string, t: string) {
  try { localStorage.setItem(tokenKey(id), t); } catch { /* private mode: token lives only in memory */ }
}

async function call<T>(url: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.token ? { 'x-token': init.token } : {}) },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data as T;
}

export const api = {
  create: (turnSeconds: number | null) =>
    call<{ id: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ turnSeconds }) }),
  get: (id: string, token: string | null) =>
    call<{ view: GameView; version: number }>(`/api/rooms/${id}`, { token }),
  join: (id: string, name: string) =>
    call<{ token: string; view: GameView; version: number }>(`/api/rooms/${id}/join`, { method: 'POST', body: JSON.stringify({ name }) }),
  act: (id: string, token: string | null, action: Action) =>
    call<{ view: GameView; version: number }>(`/api/rooms/${id}/action`, { method: 'POST', token, body: JSON.stringify({ action }) }),
};

let sb: SupabaseClient | null = null;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasRealtime = !!(SB_URL && SB_KEY);

export interface EmojiMsg { e: string; name: string; color: string }
export interface ChatMsg { id: number; player_id: string; name: string; color: string; text: string; created_at: string }

// One realtime channel per room. The server pushes 'update' and 'chat'; players push 'emoji' and 'voice'
// (voice call signalling) straight to each other. Components listen through `onRoomEvent`.
const EVENTS = ['update', 'emoji', 'chat', 'voice'] as const;
export type RoomEvent = (typeof EVENTS)[number] | 'presence';
const channels = new Map<string, RealtimeChannel>();
const bus = typeof window !== 'undefined' ? new EventTarget() : null;

export function onRoomEvent<T = unknown>(event: RoomEvent, fn: (payload: T) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent).detail as T);
  bus?.addEventListener(event, h);
  return () => bus?.removeEventListener(event, h);
}

/** Opens the room channel. `onUpdate` runs whenever the server says the game changed. Returns an unsubscribe function. */
export function subscribeRoom(id: string, onUpdate: () => void): () => void {
  const off = onRoomEvent('update', onUpdate);
  if (!hasRealtime) return off;
  sb ||= createClient(SB_URL!, SB_KEY!, { auth: { persistSession: false } });
  let ch = sb.channel(`katan-${id}`);
  for (const ev of EVENTS) ch = ch.on('broadcast', { event: ev }, m => bus?.dispatchEvent(new CustomEvent(ev, { detail: m.payload })));
  // Who has the game open right now (each screen announces its player id).
  ch = ch.on('presence', { event: 'sync' }, () => {
    const ids = Object.values(ch.presenceState()).flat().map(x => (x as { pid?: string }).pid).filter(Boolean);
    bus?.dispatchEvent(new CustomEvent('presence', { detail: [...new Set(ids)] }));
  });
  ch.subscribe(status => { if (status === 'SUBSCRIBED') { joined.add(id); announce(id); } });
  channels.set(id, ch);
  return () => { off(); channels.delete(id); joined.delete(id); sb?.removeChannel(ch); };
}

const joined = new Set<string>();
const presenceAs = new Map<string, string>();
function announce(id: string) {
  const pid = presenceAs.get(id);
  if (pid && joined.has(id)) channels.get(id)?.track({ pid }).catch(() => {});
}
/** Marks this screen as player `pid` being online in the room. */
export function setPresence(id: string, pid: string | null) {
  if (!pid) return;
  presenceAs.set(id, pid);
  announce(id);
}

/** Sends straight to the other players in the room (not to yourself). Nothing is stored. */
export function sendRoomEvent(id: string, event: 'emoji' | 'voice', payload: unknown) {
  channels.get(id)?.send({ type: 'broadcast', event, payload });
}

export const chatApi = {
  list: (id: string) => call<{ messages: ChatMsg[] }>(`/api/rooms/${id}/chat`),
  send: (id: string, token: string | null, text: string) =>
    call<{ message: ChatMsg }>(`/api/rooms/${id}/chat`, { method: 'POST', token, body: JSON.stringify({ text }) }),
};
