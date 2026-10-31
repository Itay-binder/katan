'use client';
// "Add to home screen": the native install prompt where the browser offers one (Android Chrome),
// step-by-step instructions everywhere else (iPhone never offers a prompt).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop';

function detect(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  return /Android/.test(ua) ? 'android' : 'desktop';
}

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const STEPS: Record<Platform, { title: string; steps: string[] }> = {
  'ios-safari': {
    title: 'אייפון (Safari)',
    steps: ['לחץ על כפתור השיתוף ⬆️ בשורה התחתונה', 'גלול למטה ובחר "הוסף למסך הבית" ➕', 'לחץ "הוסף" בפינה למעלה'],
  },
  'ios-other': {
    title: 'אייפון (Chrome)',
    steps: ['לחץ על כפתור השיתוף ⬆️ ליד שורת הכתובת', 'בחר "הוסף למסך הבית" ➕', 'לחץ "הוסף"'],
  },
  android: {
    title: 'אנדרואיד (Chrome)',
    steps: ['לחץ על שלוש הנקודות ⋮ למעלה', 'בחר "התקנת אפליקציה" או "הוספה למסך הבית"', 'לחץ "התקנה"'],
  },
  desktop: {
    title: 'מחשב',
    steps: ['פתח את הלינק הזה בטלפון', 'שם לחץ שוב על "הוסף למסך הבית" וקבל הוראות לטלפון שלך'],
  },
};

export default function InstallButton() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [installed, setInstalled] = useState(true);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPlatform(detect());
    setInstalled(isInstalled());
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setOpen(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (installed || !platform) return null;

  const click = async () => {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      if (outcome === 'accepted') return;
    }
    setOpen(true);
  };

  const info = STEPS[platform];
  return (
    <>
      <button className="btn light install-btn" onClick={click}>📲 הוסף למסך הבית</button>
      {/* Portal: the home card is animated, which would trap a fixed sheet inside it. */}
      {open && createPortal(
        <div className="sheet-back" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="row" style={{ marginBottom: 6 }}>
              <h3 className="grow" style={{ margin: 0 }}>הוספה למסך הבית</h3>
              <button className="btn light small" onClick={() => setOpen(false)}>סגור</button>
            </div>
            <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>
              ככה Katan נפתח מהמסך הראשי במסך מלא, עם אייקון משלו, כמו אפליקציה.
            </p>
            <p className="field-label">{info.title}</p>
            <ol className="install-steps">
              {info.steps.map(s => <li key={s}>{s}</li>)}
            </ol>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
