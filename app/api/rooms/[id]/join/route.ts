import { joinGame, viewFor } from '@/lib/engine/rules';
import { fail, json, mutateRoom } from '@/lib/room';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { name } = await req.json().catch(() => ({ name: '' }));
    const { state, result: p } = await mutateRoom(id, s => joinGame(s, String(name || '')));
    return json({ token: p.token, view: viewFor(state, p.id, Date.now()) });
  } catch (e) { return fail(e); }
}
