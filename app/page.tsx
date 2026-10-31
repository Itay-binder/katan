'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import InstallButton from '@/components/InstallButton';

const TIMERS: { v: number | null; label: string }[] = [
  { v: null, label: 'בלי' }, { v: 60, label: '60 שנ׳' }, { v: 90, label: '90 שנ׳' }, { v: 120, label: '120 שנ׳' },
];

export default function Home() {
  const router = useRouter();
  const [timer, setTimer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
        <InstallButton />
      </div>
    </main>
  );
}
