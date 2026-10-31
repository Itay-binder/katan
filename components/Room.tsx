'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, hasRealtime, sendEmoji, setToken, subscribeRoom, type EmojiMsg } from '@/lib/client';
import type { Action, GameView } from '@/lib/engine/types';
import Lobby from './Lobby';
import Game from './Game';

export default function Room({ id }: { id: string }) {
  const [view, setView] = useState<GameView | null>(null);
  const [missing, setMissing] = useState(false);
  const [toast, setToast] = useState('');
  const token = useRef<string | null>(null);
  const skew = useRef(0); // server clock minus local clock
  const lastVersion = useRef(-1);
  const [floats, setFloats] = useState<(EmojiMsg & { key: number; x: number })[]>([]);

  const showEmoji = useCallback((m: EmojiMsg) => {
    const f = { ...m, key: Math.random(), x: 10 + Math.random() * 70 };
    setFloats(fs => [...fs.slice(-12), f]);
    setTimeout(() => setFloats(fs => fs.filter(o => o.key !== f.key)), 2600);
  }, []);

  const accept = useCallback((v: GameView) => {
    skew.current = v.now - Date.now();
    setView(v);
  }, []);

  const load = useCallback(async () => {
    try {
      const asked = token.current;
      const r = await api.get(id, asked);
      // Ignore answers that are older than what we have, or were asked before we joined.
      if (asked === token.current && r.version >= lastVersion.current) { lastVersion.current = r.version; accept(r.view); }
    } catch (e) {
      if ((e as Error).message.includes('לא נמצא')) setMissing(true);
    }
  }, [id, accept]);

  useEffect(() => {
    token.current = getToken(id);
    load();
    const unsub = subscribeRoom(id, load, showEmoji);
    // Fallback refresh: realtime normally does the work, so this is slow and only while the tab is visible.
    const every = hasRealtime ? 60_000 : 2_000;
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, every);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { unsub(); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [id, load, showEmoji]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const act = useCallback(async (action: Action, quiet = false) => {
    try {
      const r = await api.act(id, token.current, action);
      if (r.version >= lastVersion.current) { lastVersion.current = r.version; accept(r.view); }
      return true;
    } catch (e) {
      if (!quiet) flash((e as Error).message);
      load();
      return false;
    }
  }, [id, accept, load]);

  const join = useCallback(async (name: string) => {
    const r = await api.join(id, name);
    token.current = r.token;
    setToken(id, r.token);
    lastVersion.current = Math.max(lastVersion.current, r.version);
    accept(r.view);
  }, [id, accept]);

  if (missing) return (
    <main className="home"><div className="card" style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>החדר לא נמצא</h2>
      <a className="btn" href="/">לפתוח משחק חדש</a>
    </div></main>
  );
  if (!view) return <main className="home"><p style={{ color: 'var(--sand)', fontSize: 20 }}>טוען…</p></main>;

  return (
    <>
      {view.phase === 'lobby'
        ? <Lobby view={view} act={act} join={join} />
        : <Game view={view} act={act} skew={skew.current}
            react={e => {
              const me = view.players.find(p => p.id === view.you);
              if (!me) return;
              const m = { e, name: me.name, color: me.color };
              showEmoji(m);
              sendEmoji(id, m);
            }} />}
      {floats.map(f => (
        <div key={f.key} className="floater" style={{ left: `${f.x}%` }}>
          <span className="fe">{f.e}</span>
          <span className={`fn c-${f.color}`}>{f.name}</span>
        </div>
      ))}
      {toast && <div className="toast" role="alert">{toast}</div>}
    </>
  );
}
