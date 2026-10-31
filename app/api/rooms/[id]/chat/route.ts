import { playerByToken } from '@/lib/engine/rules';
import { GameError } from '@/lib/engine/types';
import { fail, json } from '@/lib/room';
import { addChat, listChat, loadRoom } from '@/lib/store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return json({ messages: await listChat(id) });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { text } = await req.json().catch(() => ({ text: '' }));
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) throw new GameError('הודעה ריקה');
    const row = await loadRoom(id);
    if (!row) throw new GameError('החדר לא נמצא');
    const me = playerByToken(row.state, req.headers.get('x-token'));
    if (!me) throw new GameError('רק שחקנים בחדר יכולים לכתוב');
    return json({ message: await addChat(id, { player_id: me.id, name: me.name, color: me.color, text: clean }) });
  } catch (e) { return fail(e); }
}
