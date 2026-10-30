import { createGame, newRoomId } from '@/lib/engine/rules';
import { insertRoom } from '@/lib/store';
import { fail, json } from '@/lib/room';

const ALLOWED = [null, 60, 90, 120];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const turnSeconds = ALLOWED.includes(body.turnSeconds) ? body.turnSeconds : null;
    const state = createGame(newRoomId(), turnSeconds, Date.now());
    await insertRoom(state);
    return json({ id: state.id });
  } catch (e) { return fail(e); }
}
