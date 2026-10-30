import { playerByToken, viewFor } from '@/lib/engine/rules';
import { loadRoom } from '@/lib/store';
import { fail, json } from '@/lib/room';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = await loadRoom(id);
    if (!row) return json({ error: 'החדר לא נמצא' }, 404);
    const me = playerByToken(row.state, req.headers.get('x-token'));
    return json({ view: viewFor(row.state, me?.id ?? null, Date.now()), version: row.version });
  } catch (e) { return fail(e); }
}
