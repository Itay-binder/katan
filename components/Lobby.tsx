'use client';
import { useEffect, useState } from 'react';
import { COLORS, type Action, type Color, type GameView } from '@/lib/engine/types';
import { MAX_PLAYERS, MIN_PLAYERS } from '@/lib/engine/rules';

const COLOR_HE: Record<Color, string> = { red: 'אדום', blue: 'כחול', orange: 'כתום', green: 'ירוק' };

export default function Lobby({ view, act, join }: {
  view: GameView;
  act: (a: Action) => Promise<boolean>;
  join: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');
  useEffect(() => { setLink(window.location.href); }, []);

  const me = view.players.find(p => p.id === view.you);
  const isHost = view.you === view.hostId;
  const full = view.players.length >= MAX_PLAYERS;

  async function doJoin() {
    setBusy(true); setErr('');
    try { await join(name); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`בוא לשחק איתי Katan 🎲\n${link}`)}`;

  return (
    <main className="lobby">
      <h1 className="logo" style={{ fontSize: 44 }}>Katan</h1>

      <div className="card">
        <p className="field-label">הלינק לחדר</p>
        <div className="link-box"><code>{link}</code></div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn light small grow" onClick={copy}>{copied ? 'הועתק ✓' : 'העתק'}</button>
          <a className="btn ok small grow" style={{ textAlign: 'center', textDecoration: 'none' }} href={wa} target="_blank" rel="noreferrer">שלח בווצאפ</a>
        </div>
        <p style={{ margin: '10px 0 0', color: 'var(--ink-soft)', fontSize: 14 }}>
          טיימר לתור: {view.turnSeconds ? `${view.turnSeconds} שניות` : 'בלי טיימר'}
        </p>
      </div>

      {!me && (
        <div className="card">
          {full ? <p style={{ margin: 0, fontWeight: 700 }}>החדר מלא (4 שחקנים).</p> : <>
            <p className="field-label">איך קוראים לך?</p>
            <input className="input" value={name} maxLength={16} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && doJoin()} placeholder="השם שלך" autoFocus />
            <button className="btn" style={{ width: '100%' }} disabled={!name.trim() || busy} onClick={doJoin}>
              {busy ? 'מצטרף…' : 'הצטרף למשחק'}
            </button>
            <p className="err">{err}</p>
          </>}
        </div>
      )}

      {me && (
        <div className="card">
          <p className="field-label">הצבע שלך</p>
          <div className="colors">
            {COLORS.map(c => {
              const taken = view.players.some(p => p.color === c && p.id !== me.id);
              return (
                <button key={c} className={`c-${c} ${me.color === c ? 'on' : ''}`} disabled={taken}
                  aria-label={COLOR_HE[c]} onClick={() => act({ type: 'setColor', color: c })} />
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <p className="field-label">שחקנים ({view.players.length}/{MAX_PLAYERS})</p>
        <ul className="plist">
          {view.players.map(p => (
            <li key={p.id}>
              <span className={`dot c-${p.color}`} style={{ width: 20, height: 20 }} />
              {p.name}
              <span className="tag">{p.id === view.hostId ? 'פתח את החדר' : ''}{p.id === view.you ? ' · זה אתה' : ''}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14 }}>
          {isHost
            ? <button className="btn" style={{ width: '100%', fontSize: 19 }} disabled={view.players.length < MIN_PLAYERS}
                onClick={() => act({ type: 'start' })}>
                {view.players.length < MIN_PLAYERS ? 'מחכים לעוד שחקן…' : 'התחל משחק'}
              </button>
            : <p style={{ margin: 0, textAlign: 'center', color: 'var(--ink-soft)' }}>מחכים שמי שפתח את החדר יתחיל…</p>}
        </div>
      </div>
    </main>
  );
}
