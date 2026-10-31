import { playerByToken } from '@/lib/engine/rules';
import { GameError } from '@/lib/engine/types';
import { fail, json } from '@/lib/room';
import { listPresence, loadRoom, markPresence } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return json({ presence: await listPresence(id), now: Date.now() });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { away } = await req.json().catch(() => ({ away: false }));
    const row = await loadRoom(id);
    if (!row) throw new GameError('החדר לא נמצא');
    const me = playerByToken(row.state, req.headers.get('x-token'));
    if (!me) throw new GameError('לא שחקן בחדר');
    await markPresence(id, me.id, !!away);
    return json({ ok: true });
  } catch (e) { return fail(e); }
}
