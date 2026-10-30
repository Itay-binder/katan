// Room storage. Supabase in production (table katan_rooms, service role only),
// an in-memory map when Supabase env vars are missing (local dev / tests).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from './engine/types';

interface Row { state: GameState; version: number }

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;
const db = () => (client ||= createClient(url!, key!, { auth: { persistSession: false } }));
export const usingSupabase = !!(url && key);

const g = globalThis as unknown as { __katanRooms?: Map<string, Row> };
const mem = (g.__katanRooms ||= new Map());

export async function loadRoom(id: string): Promise<Row | null> {
  if (!usingSupabase) return mem.get(id) ? structuredClone(mem.get(id)!) : null;
  const { data, error } = await db().from('katan_rooms').select('state, version').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

export async function insertRoom(state: GameState): Promise<void> {
  if (!usingSupabase) { mem.set(state.id, { state: structuredClone(state), version: 0 }); return; }
  const { error } = await db().from('katan_rooms').insert({ id: state.id, state, version: 0 });
  if (error) throw error;
}

/** Saves only if nobody else saved since we loaded. Returns false on a conflict. */
export async function saveRoom(id: string, state: GameState, version: number): Promise<boolean> {
  if (!usingSupabase) {
    const row = mem.get(id);
    if (!row || row.version !== version) return false;
    mem.set(id, { state: structuredClone(state), version: version + 1 });
    return true;
  }
  const { data, error } = await db().from('katan_rooms')
    .update({ state, version: version + 1, updated_at: new Date().toISOString() })
    .eq('id', id).eq('version', version).select('id');
  if (error) throw error;
  return !!data?.length;
}

/** Tells every open screen in the room to refetch. Hands are never sent here, only the version. */
export async function notifyRoom(id: string, version: number): Promise<void> {
  if (!usingSupabase) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `katan-${id}`, event: 'update', payload: { version } }] }),
    });
  } catch { /* clients also refetch on focus */ }
}
