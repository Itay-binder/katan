import { applyAction, blockers, playerByToken, viewFor } from '@/lib/engine/rules';
import { awayFor } from '@/lib/engine/presence';
import { listPresence, loadRoom } from '@/lib/store';
import { GameError, type Action } from '@/lib/engine/types';
import { fail, json, mutateRoom } from '@/lib/room';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = (await req.json()) as { action: Action };
    const token = req.headers.get('x-token');
    if (action.type === 'skipTurn') {
      // How long the players we wait for have been out of the game, from the server's own records.
      const row = await loadRoom(id);
      const seen = await listPresence(id);
      const now = Date.now();
      const since = row?.state.lastMoveAt ?? row?.state.log[row.state.log.length - 1]?.t;
      action.awayMs = row ? Math.max(0, ...blockers(row.state).map(pid => awayFor(seen[pid], now, since))) : 0;
    }
    const { state, result: pid, version } = await mutateRoom(id, s => {
      const me = playerByToken(s, token);
      if (!me) throw new GameError('אתה לא שחקן בחדר הזה');
      applyAction(s, me.id, action, Date.now());
      return me.id;
    });
    return json({ view: viewFor(state, pid, Date.now()), version });
  } catch (e) { return fail(e); }
}
