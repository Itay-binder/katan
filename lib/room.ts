import { NextResponse } from 'next/server';
import { GameError, type GameState } from './engine/types';
import { loadRoom, notifyRoom, saveRoom } from './store';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export const fail = (e: unknown) => {
  if (e instanceof GameError) return json({ error: e.message }, 400);
  console.error(e);
  return json({ error: 'שגיאת שרת, נסה שוב' }, 500);
};

/** Load → change → save with a version check, retrying when two players act at the same moment. */
export async function mutateRoom<T>(id: string, fn: (s: GameState) => T): Promise<{ state: GameState; result: T; version: number }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await loadRoom(id);
    if (!row) throw new GameError('החדר לא נמצא');
    const result = fn(row.state);
    if (await saveRoom(id, row.state, row.version)) {
      await notifyRoom(id, row.version + 1);
      return { state: row.state, result, version: row.version + 1 };
    }
  }
  throw new GameError('יותר מדי פעולות בבת אחת, נסה שוב');
}
