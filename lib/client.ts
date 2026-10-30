'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
    call<{ token: string; view: GameView }>(`/api/rooms/${id}/join`, { method: 'POST', body: JSON.stringify({ name }) }),
  act: (id: string, token: string | null, action: Action) =>
    call<{ view: GameView }>(`/api/rooms/${id}/action`, { method: 'POST', token, body: JSON.stringify({ action }) }),
};

let sb: SupabaseClient | null = null;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasRealtime = !!(SB_URL && SB_KEY);

/** Calls onUpdate whenever the server says the room changed. Returns an unsubscribe function. */
export function subscribeRoom(id: string, onUpdate: () => void): () => void {
  if (!hasRealtime) return () => {};
  sb ||= createClient(SB_URL!, SB_KEY!, { auth: { persistSession: false } });
  const ch = sb.channel(`katan-${id}`).on('broadcast', { event: 'update' }, onUpdate).subscribe();
  return () => { sb?.removeChannel(ch); };
}
