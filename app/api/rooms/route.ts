import { createGame, newRoomId, SPRINT_VP, WIN_VP } from '@/lib/engine/rules';
import { insertRoom } from '@/lib/store';
import { fail, json } from '@/lib/room';

const ALLOWED = [null, 60, 90, 120];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const turnSeconds = ALLOWED.includes(body.turnSeconds) ? body.turnSeconds : null;
    const winVp = body.winVp === SPRINT_VP ? SPRINT_VP : WIN_VP;
    const state = createGame(newRoomId(), turnSeconds, Date.now(), Math.random, winVp);
    await insertRoom(state);
    return json({ id: state.id });
  } catch (e) { return fail(e); }
}
