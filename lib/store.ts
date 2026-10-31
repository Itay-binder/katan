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

async function broadcast(id: string, event: string, payload: unknown): Promise<void> {
  if (!usingSupabase) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `katan-${id}`, event, payload }] }),
    });
  } catch { /* clients also refetch on focus */ }
}

/** Tells every open screen in the room to refetch. Hands are never sent here, only the version. */
export const notifyRoom = (id: string, version: number) => broadcast(id, 'update', { version });

export interface ChatMsg { id: number; player_id: string; name: string; color: string; text: string; created_at: string }
const memChat = ((g as unknown as { __katanChat?: Map<string, ChatMsg[]> }).__katanChat ||= new Map());

export async function listChat(roomId: string): Promise<ChatMsg[]> {
  if (!usingSupabase) return memChat.get(roomId) ?? [];
  const { data, error } = await db().from('katan_chat')
    .select('id, player_id, name, color, text, created_at').eq('room_id', roomId).order('id', { ascending: false }).limit(100);
  if (error) throw error;
  return (data as ChatMsg[]).reverse();
}

/** Saves a chat line and pushes it to everyone in the room. */
export async function addChat(roomId: string, m: Omit<ChatMsg, 'id' | 'created_at'>): Promise<ChatMsg> {
  let saved: ChatMsg;
  if (!usingSupabase) {
    const list = memChat.get(roomId) ?? [];
    saved = { ...m, id: list.length + 1, created_at: new Date().toISOString() };
    memChat.set(roomId, [...list, saved].slice(-100));
  } else {
    const { data, error } = await db().from('katan_chat').insert({ room_id: roomId, ...m })
      .select('id, player_id, name, color, text, created_at').single();
    if (error) throw error;
    saved = data as ChatMsg;
  }
  await broadcast(roomId, 'chat', saved);
  return saved;
}
