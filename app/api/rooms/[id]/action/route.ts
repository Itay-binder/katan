import { applyAction, playerByToken, viewFor } from '@/lib/engine/rules';
import { GameError, type Action } from '@/lib/engine/types';
import { fail, json, mutateRoom } from '@/lib/room';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = (await req.json()) as { action: Action };
    const token = req.headers.get('x-token');
    const { state, result: pid } = await mutateRoom(id, s => {
      const me = playerByToken(s, token);
      if (!me) throw new GameError('אתה לא שחקן בחדר הזה');
      applyAction(s, me.id, action, Date.now());
      return me.id;
    });
    return json({ view: viewFor(state, pid, Date.now()) });
  } catch (e) { return fail(e); }
}
