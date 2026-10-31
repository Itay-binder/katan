'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, parseRoomCode } from '@/lib/client';
import InstallButton from '@/components/InstallButton';

const TIMERS: { v: number | null; label: string }[] = [
  { v: null, label: 'בלי' }, { v: 60, label: '60 שנ׳' }, { v: 90, label: '90 שנ׳' }, { v: 120, label: '120 שנ׳' },
];

export default function Home() {
  const router = useRouter();
  const [timer, setTimer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function joinRoom(raw = code) {
    const id = parseRoomCode(raw);
    if (!id) { setCodeErr('זה לא נראה כמו קוד חדר. הקוד הוא 8 תווים, או הלינק המלא.'); return; }
    setCodeErr('');
    router.push(`/r/${id}`);
  }
  async function paste() {
    // iPhone shows a small "Paste" bubble that must be tapped; if it is missed or refused,
    // fall back to the field itself, where a normal paste also joins straight away.
    try {
      const t = await navigator.clipboard.readText();
      if (!t) throw new Error('empty');
      setCode(t);
      if (parseRoomCode(t)) joinRoom(t);
      else setCodeErr('בלוח יש משהו שהוא לא קוד חדר.');
    } catch {
      input.current?.focus();
      setCodeErr('לא הצלחתי לקרוא מהלוח. לחץ לחיצה ארוכה בשדה ובחר "הדבק", ותיכנס לחדר אוטומטית.');
    }
  }

  async function create() {
    setBusy(true); setErr('');
    try {
      const { id } = await api.create(timer);
      router.push(`/r/${id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <main className="home">
      <div className="home-inner">
        <div className="hero-hexes" aria-hidden>
          <span className="r-brick" /><span className="r-lumber" /><span className="r-grain" /><span className="r-wool" /><span className="r-ore" />
        </div>
        <h1 className="logo">Katan</h1>
        <p className="tagline">מתיישבים עם החברים, כל אחד מהטלפון שלו</p>
        <div className="card">
          <p className="field-label">טיימר לכל תור</p>
          <div className="seg">
            {TIMERS.map(t => (
              <button key={String(t.v)} className={timer === t.v ? 'on' : ''} onClick={() => setTimer(t.v)}>{t.label}</button>
            ))}
          </div>
          <button className="btn" style={{ width: '100%', fontSize: 20 }} onClick={create} disabled={busy}>
            {busy ? 'פותח חדר…' : 'משחק חדש'}
          </button>
          <p className="err">{err}</p>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 15 }}>
            נפתח חדר עם לינק משלו. שולחים אותו לעד 3 חברים, כל אחד בוחר צבע, ומתחילים.
          </p>
        </div>
        <div className="card join-card">
          <p className="field-label">הצטרף לחדר קיים</p>
          <div className="join-row">
            <input ref={input} value={code} placeholder="קוד חדר או לינק"
              onChange={e => { setCode(e.target.value); setCodeErr(''); }}
              onPaste={e => { const t = e.clipboardData.getData('text'); if (parseRoomCode(t)) { e.preventDefault(); setCode(t); joinRoom(t); } }}
              autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
              onKeyDown={e => { if (e.key === 'Enter') joinRoom(); }} />
            <button className="btn light small" onClick={paste} aria-label="הדבק">📋 הדבק</button>
          </div>
          <button className="btn ok" style={{ width: '100%', marginTop: 10 }} onClick={() => joinRoom()} disabled={!code.trim()}>הצטרף</button>
          {codeErr && <p className="err" style={{ marginBottom: 0 }}>{codeErr}</p>}
        </div>
        <InstallButton />
      </div>
    </main>
  );
}
