'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, hasRealtime, setToken, subscribeRoom } from '@/lib/client';
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

  const accept = useCallback((v: GameView) => {
    skew.current = v.now - Date.now();
    setView(v);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get(id, token.current);
      if (r.version >= lastVersion.current) { lastVersion.current = r.version; accept(r.view); }
    } catch (e) {
      if ((e as Error).message.includes('לא נמצא')) setMissing(true);
    }
  }, [id, accept]);

  useEffect(() => {
    token.current = getToken(id);
    load();
    const unsub = subscribeRoom(id, load);
    // Fallback refresh: realtime normally does the work, so this is slow and only while the tab is visible.
    const every = hasRealtime ? 60_000 : 2_000;
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, every);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { unsub(); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [id, load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const act = useCallback(async (action: Action, quiet = false) => {
    try {
      const r = await api.act(id, token.current, action);
      accept(r.view);
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
        : <Game view={view} act={act} skew={skew.current} />}
      {toast && <div className="toast" role="alert">{toast}</div>}
    </>
  );
}
