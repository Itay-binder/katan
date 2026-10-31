'use client';
import { useEffect, useRef, useState } from 'react';
import Board, { RES_ICON, type PickMode } from './Board';
import { ChatPanel, useChat, useVoice } from './Social';
import {
  affordable, piecesLeft, robbableOn, tradeRatios, validCities, validRoads, validSettlements,
  validSetupRoads, validSetupSettlements,
} from '@/lib/engine/queries';
import { HEXES } from '@/lib/engine/geometry';
import {
  COST, DEV_HE, RES, RES_HE, devReady, emptyRes, resTotal,
  type Action, type DevType, type GameView, type PublicPlayer, type Res, type ResMap,
} from '@/lib/engine/types';

type Act = (a: Action, quiet?: boolean) => Promise<boolean>;
type Sheet = null | 'build' | 'trade' | 'dev' | 'log' | 'end' | 'emoji' | 'chat' | 'voice';
const EMOJIS = ['👍', '😂', '😡', '😱', '🔥', '🖕🏻', '🤝', '😈', '🙏', '🐑', '🧱', '😴'];

const costIcons = (c: Partial<ResMap>) =>
  RES.filter(k => c[k]).map(k => `${RES_ICON[k]}${c[k]! > 1 ? '×' + c[k] : ''}`).join(' ');
const resLine = (r: ResMap) => RES.filter(k => r[k]).map(k => `${r[k]} ${RES_ICON[k]}`).join('  ');

export default function Game({ view, act, skew, react, roomId, token }: {
  view: GameView; act: Act; skew: number; react: (e: string) => void; roomId: string; token: string | null;
}) {
  const me = view.players.find(p => p.id === view.you) ?? null;
  const curP = view.players[view.current];
  const myTurn = view.phase === 'playing' && !!me && curP?.id === me.id;
  const [build, setBuild] = useState<null | 'road' | 'settlement' | 'city'>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [robberAt, setRobberAt] = useState<number | null>(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setReveal(false), 1800);
    return () => clearTimeout(t);
  }, [reveal]);

  // New cards fly from the board into the hand.
  const [flyers, setFlyers] = useState<{ key: number; res: Res; sx: number; sy: number; ex: number; ey: number; delay: number }[]>([]);
  const prevHand = useRef<ResMap | null>(me?.resources ?? null);
  useEffect(() => {
    const cur = me?.resources;
    const prev = prevHand.current;
    prevHand.current = cur ?? null;
    if (!cur || !prev) return;
    const board = document.querySelector('.board-wrap')?.getBoundingClientRect();
    if (!board) return;
    const out: typeof flyers = [];
    for (const k of RES) {
      const gain = cur[k] - prev[k];
      const slot = document.querySelector(`.bottom .hand .r-${k}`)?.getBoundingClientRect();
      if (gain <= 0 || !slot) continue;
      for (let i = 0; i < Math.min(gain, 5); i++) {
        out.push({
          key: Math.random(), res: k, delay: out.length * 110,
          sx: board.left + board.width / 2 + (Math.random() - .5) * board.width * .45,
          sy: board.top + board.height / 2 + (Math.random() - .5) * board.height * .3,
          ex: slot.left + slot.width / 2, ey: slot.top + slot.height / 2,
        });
      }
    }
    if (!out.length) return;
    setFlyers(f => [...f, ...out]);
    const done = new Set(out.map(o => o.key));
    setTimeout(() => setFlyers(f => f.filter(o => !done.has(o.key))), 1000 + out.length * 110);
  }, [me?.resources]);
  const [now, setNow] = useState(() => Date.now() + skew);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() + skew), 500);
    return () => clearInterval(iv);
  }, [skew]);

  useEffect(() => { if (!myTurn || view.sub !== 'main') setBuild(null); }, [myTurn, view.sub]);
  useEffect(() => { if (!myTurn && (sheet === 'build' || sheet === 'trade')) setSheet(null); }, [myTurn, sheet]);

  // Floating banners for what the other players just did.
  const [news, setNews] = useState<{ id: string; text: string; chat?: boolean }[]>([]);
  const pushNews = (items: { id: string; text: string; chat?: boolean }[]) => {
    if (!items.length) return;
    setNews(n => [...n, ...items].slice(-3));
    for (const it of items) setTimeout(() => setNews(n => n.filter(o => o.id !== it.id)), 4500);
  };
  const seenLog = useRef(view.log[view.log.length - 1]?.id ?? 0);
  useEffect(() => {
    const fresh = view.log.filter(l => (l.id ?? 0) > seenLog.current && l.by !== me?.id);
    seenLog.current = view.log[view.log.length - 1]?.id ?? seenLog.current;
    pushNews(fresh.map(l => ({ id: `l${l.id}`, text: l.text })));
  }, [view.log, me?.id]);

  // Chat and voice call.
  const [unread, setUnread] = useState(0);
  const chatOpen = useRef(false);
  chatOpen.current = sheet === 'chat';
  const chat = useChat(roomId, me?.id ?? null, m => {
    if (chatOpen.current) return;
    setUnread(u => u + 1);
    pushNews([{ id: `c${m.id}`, text: `💬 ${m.name}: ${m.text}`, chat: true }]);
  });
  const voice = useVoice(roomId, me?.id ?? null);
  const vs = voice.state;

  // Big "your turn" banner each time the turn comes to you.
  const [yourTurn, setYourTurn] = useState(false);
  const wasMine = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !wasMine.current) {
      setYourTurn(true);
      try { navigator.vibrate?.(200); } catch { /* not supported */ }
      const t = setTimeout(() => setYourTurn(false), 2200);
      wasMine.current = myTurn;
      return () => clearTimeout(t);
    }
    wasMine.current = myTurn;
  }, [myTurn]);

  // Turn clock ran out: any seated player nudges the server (the current player first, others a bit later).
  const sentFor = useRef<number | null>(null);
  useEffect(() => {
    if (view.phase !== 'playing' || !view.deadline || !me) return;
    if (now >= view.deadline + (myTurn ? 600 : 2500) && sentFor.current !== view.deadline) {
      sentFor.current = view.deadline;
      act({ type: 'timeout' }, true);
    }
  }, [now, view.deadline, view.phase, me, myTurn, act]);

  // ---------- what can be tapped on the board ----------
  let mode: PickMode = null;
  if (myTurn && me) {
    if (view.sub === 'setupSettlement')
      mode = { kind: 'vertex', ids: validSetupSettlements(view), onPick: v => act({ type: 'placeSettlement', vertex: v }) };
    else if (view.sub === 'setupPickStart')
      mode = { kind: 'vertex', ids: Object.keys(view.buildings).map(Number).filter(v => view.buildings[v].owner === me.id), onPick: v => act({ type: 'pickStart', vertex: v }) };
    else if (view.sub === 'setupRoad')
      mode = { kind: 'edge', ids: validSetupRoads(view, view.lastSetupVertex), onPick: e => act({ type: 'placeRoad', edge: e }) };
    else if (view.sub === 'robber')
      mode = { kind: 'hex', ids: HEXES.filter(h => h.id !== view.robber).map(h => h.id), onPick: h => setRobberAt(h) };
    else if (view.sub === 'roadBuilding')
      mode = { kind: 'edge', ids: validRoads(view, me.id), onPick: e => act({ type: 'buildRoad', edge: e }) };
    else if (view.sub === 'main' && build) {
      const done = () => setBuild(null);
      if (build === 'road') mode = { kind: 'edge', ids: validRoads(view, me.id), onPick: e => act({ type: 'buildRoad', edge: e }).then(done) };
      if (build === 'settlement') mode = { kind: 'vertex', ids: validSettlements(view, me.id), onPick: v => act({ type: 'buildSettlement', vertex: v }).then(done) };
      if (build === 'city') mode = { kind: 'vertex', ids: validCities(view, me.id), onPick: v => act({ type: 'buildCity', vertex: v }).then(done) };
    }
  }

  const myDiscard = me ? view.discards[me.id] : 0;
  const secsLeft = view.deadline ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null;

  return (
    <div className="game">
      <div className="topbar">
        {view.players.map((p, i) => (
          <PlayerChip key={p.id} p={p} view={view} turn={i === view.current}
            inCall={vs.members.includes(p.id)} talking={vs.speaking.includes(p.id)} />
        ))}
      </div>

      <div className="statusbar">
        {view.dice && <div className="dice"><span className="die">{view.dice[0]}</span><span className="die">{view.dice[1]}</span></div>}
        <span className="msg">{statusText(view, me, myTurn, build)}</span>
        {secsLeft !== null && view.phase === 'playing' && <span className={`timer ${secsLeft <= 10 ? 'low' : ''}`}>{secsLeft}</span>}
        <button className="btn ghost small" onClick={() => setSheet('log')} aria-label="יומן">📜</button>
      </div>

      <div className="board-area">
        <Board view={view} mode={mode} />
        {me && (
          <div className="side-tools">
            <button className={`tool ${vs.joined ? 'on' : ''}`} onClick={() => (vs.joined ? setSheet('voice') : voice.join())} aria-label="שיחה">
              {vs.joining ? '…' : vs.joined ? (vs.muted ? '🔇' : '🎙️') : '📞'}
              {!vs.joined && vs.members.length > 0 && <span className="badge green">{vs.members.length}</span>}
            </button>
            <button className="tool" onClick={() => { setSheet('chat'); setUnread(0); }} aria-label="צ׳אט">
              💬{unread > 0 && <span className="badge">{unread}</span>}
            </button>
            <button className="tool" onClick={() => setSheet('emoji')} aria-label="אימוג׳י">😀</button>
          </div>
        )}
      </div>

      {me && (
        <div className="bottom">
          <Hand r={me.resources!} />
          <div className="actions">
            <button className="btn" disabled={!(myTurn && view.sub === 'roll')} onClick={() => act({ type: 'roll' })}>
              <span className="i">🎲</span>הטל
            </button>
            <button className="btn light" disabled={!(myTurn && view.sub === 'main')}
              onClick={() => (build ? setBuild(null) : setSheet('build'))}>
              <span className="i">{build ? '✖' : '🔨'}</span>{build ? 'בטל' : 'בנה'}
            </button>
            <button className="btn light" disabled={!(myTurn && view.sub === 'main')} onClick={() => setSheet('trade')}>
              <span className="i">🤝</span>מסחר
            </button>
            <button className="btn light" onClick={() => setSheet('dev')}>
              <span className="i">🃏</span>פיתוח{me.dev?.length ? ` (${me.dev.length})` : ''}
            </button>
            <button className="btn light" disabled={!(myTurn && (view.sub === 'main' || view.sub === 'roadBuilding'))}
              onClick={() => setSheet('end')}>
              <span className="i">⏭</span>סיים
            </button>
          </div>
        </div>
      )}

      {view.trade && view.phase === 'playing' && me && <TradeBanner view={view} meId={me.id} act={act} />}

      {sheet === 'build' && me && <BuildSheet view={view} meId={me.id} close={() => setSheet(null)}
        pick={b => { setBuild(b); setSheet(null); }} buyDev={() => act({ type: 'buyDev' }).then(ok => ok && setSheet(null))} />}
      {sheet === 'trade' && me && <TradeSheet view={view} meId={me.id} act={act} close={() => setSheet(null)} />}
      {sheet === 'dev' && me && <DevSheet view={view} meId={me.id} myTurn={myTurn} act={act} close={() => setSheet(null)} />}
      {sheet === 'log' && <LogSheet view={view} close={() => setSheet(null)} />}
      {sheet === 'end' && myTurn && (
        <SheetFrame title="לסיים את התור?" close={() => setSheet(null)}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" onClick={() => { setSheet(null); act({ type: 'endTurn' }); }}>כן, סיים תור</button>
            <button className="btn light grow" onClick={() => setSheet(null)}>עוד לא</button>
          </div>
        </SheetFrame>
      )}
      {robberAt !== null && myTurn && view.sub === 'robber' && (() => {
        const hx = view.hexes[robberAt];
        const where = hx.terrain === 'desert' ? 'המדבר' : `${RES_ICON[hx.terrain]} ${RES_HE[hx.terrain]} ${hx.number}`;
        const blocked = robbableOn(view, robberAt, '').map(id => view.players.find(p => p.id === id)!);
        return (
          <SheetFrame title={`לשים את השודד על ${where}?`} close={() => setRobberAt(null)}>
            <p style={{ marginTop: 0 }}>
              {blocked.length ? <>חוסם את: {blocked.map(p => <b key={p.id} className={`t-${p.color}`}>{p.name}{p.id === me?.id ? ' (אתה)' : ''} </b>)}</> : 'אין כאן אף אחד לחסום'}
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn grow" onClick={() => { const h = robberAt; setRobberAt(null); act({ type: 'moveRobber', hex: h }); }}>כן, שים כאן</button>
              <button className="btn light grow" onClick={() => setRobberAt(null)}>בחר משבצת אחרת</button>
            </div>
          </SheetFrame>
        );
      })()}
      {sheet === 'chat' && (
        <ChatPanel roomId={roomId} token={token} meId={me?.id ?? null} messages={chat.messages} add={chat.add}
          close={() => { setSheet(null); setUnread(0); }} />
      )}
      {sheet === 'voice' && vs.joined && (
        <SheetFrame title="שיחה קולית" close={() => setSheet(null)}>
          <ul className="plist" style={{ marginTop: 0 }}>
            {view.players.filter(p => vs.members.includes(p.id)).map(p => (
              <li key={p.id}>
                <span className={`dot c-${p.color}`} />{p.name}{p.id === me?.id ? ' (אתה)' : ''}
                <span className="tag">
                  {vs.failed.includes(p.id) ? 'לא מצליח להתחבר' : vs.speaking.includes(p.id) ? 'מדבר…' : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn light grow" onClick={voice.toggleMute}>{vs.muted ? '🎙️ בטל השתקה' : '🔇 השתק אותי'}</button>
            <button className="btn danger grow" onClick={() => { voice.leave(); setSheet(null); }}>📵 צא מהשיחה</button>
          </div>
        </SheetFrame>
      )}
      {vs.error && <div className="toast" role="alert">{vs.error}</div>}
      {sheet === 'emoji' && (
        <SheetFrame title="שלח לכולם" close={() => setSheet(null)}>
          <div className="emojis">
            {EMOJIS.map(e => <button key={e} onClick={() => { react(e); setSheet(null); }}>{e}</button>)}
          </div>
        </SheetFrame>
      )}

      {myDiscard > 0 && view.sub === 'discard' && me && <DiscardSheet need={myDiscard} hand={me.resources!} act={act} />}
      {myTurn && view.sub === 'steal' && <StealSheet view={view} act={act} onStolen={() => setReveal(true)} />}
      {reveal && view.stolen?.by === me?.id && view.stolen?.res && (
        <div className="steal-reveal" onClick={() => setReveal(false)}>
          <div className={`big-card r-${view.stolen.res}`}>
            <div className="ico">{RES_ICON[view.stolen.res]}</div>
            <div>{RES_HE[view.stolen.res]}</div>
          </div>
          <p>גנבת {RES_HE[view.stolen.res]} מ{view.players.find(p => p.id === view.stolen!.from)?.name}</p>
          {!view.stolen.shown && (
            <button className="btn light small" onClick={e => { e.stopPropagation(); act({ type: 'showStolen' }); setReveal(false); }}>
              הצג לכולם
            </button>
          )}
        </div>
      )}
      {flyers.map(f => (
        <div key={f.key} className={`flycard r-${f.res}`} style={{
          left: f.sx, top: f.sy, animationDelay: `${f.delay}ms`,
          ['--dx' as string]: `${f.ex - f.sx}px`, ['--dy' as string]: `${f.ey - f.sy}px`,
        }}>{RES_ICON[f.res]}</div>
      ))}
      {view.phase === 'ended' && <WinOverlay view={view} />}
      {news.length > 0 && (
        <div className="news">
          {news.map(n => <div key={n.id} className={`news-item ${n.chat ? 'chat' : ''}`} onClick={() => setNews(x => x.filter(o => o.id !== n.id))}>{n.text}</div>)}
        </div>
      )}
      {yourTurn && view.phase === 'playing' && me && (
        <div className="yourturn" onClick={() => setYourTurn(false)}>
          <div className={`yt c-${me.color}`}>התור שלך!</div>
        </div>
      )}
    </div>
  );
}

function statusText(v: GameView, me: PublicPlayer | null, myTurn: boolean, build: string | null) {
  const cur = v.players[v.current];
  if (v.phase === 'ended') return `${v.players.find(p => p.id === v.winner)?.name} ניצח!`;
  if (me && v.sub === 'discard' && v.discards[me.id]) return `יצא 7: צריך לזרוק ${v.discards[me.id]} קלפים`;
  if (myTurn) {
    switch (v.sub) {
      case 'setupSettlement': return 'בחר מקום ליישוב (הנקודות הצהובות)';
      case 'setupPickStart': return 'בחר מאיזה יישוב לקבל את משאבי הפתיחה';
      case 'setupRoad': return 'בחר דרך שיוצאת מהיישוב';
      case 'roll': return v.dice && v.dice[0] + v.dice[1] === 7 ? 'יצא 7 בסבבים הראשונים: הטל שוב' : 'התור שלך: הטל קוביות';
      case 'discard': return 'מחכים שכולם יזרקו קלפים…';
      case 'robber': return 'הזז את השודד: בחר משבצת';
      case 'steal': return 'בחר ממי לגנוב';
      case 'roadBuilding': return `בנה עוד ${v.freeRoads} דרכים בחינם`;
      case 'main':
        if (build === 'road') return 'בחר איפה לבנות דרך';
        if (build === 'settlement') return 'בחר איפה לבנות יישוב';
        if (build === 'city') return 'בחר יישוב להפוך לעיר';
        return 'התור שלך: בנה, סחור או סיים תור';
    }
  }
  const n = cur?.name ?? '';
  switch (v.sub) {
    case 'setupSettlement': return `${n} בוחר מקום ליישוב`;
    case 'setupPickStart': return `${n} בוחר מאיזה יישוב לקבל משאבים`;
    case 'setupRoad': return `${n} בוחר דרך`;
    case 'roll': return v.dice && v.dice[0] + v.dice[1] === 7 ? `יצא 7, ${n} מטיל שוב` : `${n} מטיל קוביות`;
    case 'discard': return 'מחכים שכולם יזרקו קלפים…';
    case 'robber': return `${n} מזיז את השודד`;
    case 'steal': return `${n} בוחר ממי לגנוב`;
    default: return `התור של ${n}`;
  }
}

function PlayerChip({ p, view, turn, inCall, talking }: { p: PublicPlayer; view: GameView; turn: boolean; inCall: boolean; talking: boolean }) {
  return (
    <div className={`pchip ${turn ? 'turn' : ''} ${talking ? 'talking' : ''}`}>
      <span className={`dot c-${p.color}`} />
      <span>{p.name}{p.id === view.you ? ' (אתה)' : ''}{inCall ? ' 🎧' : ''}</span>
      <span className="vp">{p.publicVp}</span>
      <span className="meta">
        🂠{p.resCount} · 🃏{p.devCount}{p.knights ? ` · ⚔️${p.knights}` : ''}
        {view.longestRoad === p.id ? ' · 🛣️' : ''}{view.largestArmy === p.id ? ' · 🛡️' : ''}
      </span>
    </div>
  );
}

function Hand({ r }: { r: ResMap }) {
  return (
    <div className="hand">
      {RES.map(k => (
        <div key={k} className={`rc r-${k} ${r[k] ? '' : 'zero'}`} title={RES_HE[k]}>
          <div className="ico">{RES_ICON[k]}</div>
          <div className="n">{r[k]}</div>
        </div>
      ))}
    </div>
  );
}

function SheetFrame({ title, close, children }: { title: string; close?: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-back" onClick={close}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 className="grow" style={{ margin: 0 }}>{title}</h3>
          {close && <button className="btn light small" onClick={close}>סגור</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stepper({ value, onChange, max }: { value: ResMap; onChange: (r: ResMap) => void; max?: ResMap }) {
  const set = (k: Res, d: number) => {
    const n = Math.max(0, Math.min(max ? max[k] : 19, value[k] + d));
    onChange({ ...value, [k]: n });
  };
  return (
    <div className="stepper">
      {RES.map(k => (
        <div className="cell" key={k}>
          <div className={`rc r-${k}`}><div className="ico">{RES_ICON[k]}</div><div className="n">{value[k]}</div></div>
          <div className="pm">
            <button onClick={() => set(k, -1)} aria-label={`פחות ${RES_HE[k]}`}>−</button>
            <button onClick={() => set(k, 1)} aria-label={`עוד ${RES_HE[k]}`}>+</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BuildSheet({ view, meId, close, pick, buyDev }: {
  view: GameView; meId: string; close: () => void;
  pick: (b: 'road' | 'settlement' | 'city') => void; buyDev: () => void;
}) {
  const me = view.players.find(p => p.id === meId)!;
  const can = affordable(me.resources);
  const left = piecesLeft(view, meId);
  const items = [
    { key: 'road' as const, label: 'דרך', cost: COST.road, ok: can.road && left.road > 0 && validRoads(view, meId).length > 0, left: left.road },
    { key: 'settlement' as const, label: 'יישוב', cost: COST.settlement, ok: can.settlement && left.settlement > 0 && validSettlements(view, meId).length > 0, left: left.settlement },
    { key: 'city' as const, label: 'עיר', cost: COST.city, ok: can.city && left.city > 0 && validCities(view, meId).length > 0, left: left.city },
  ];
  return (
    <SheetFrame title="בנייה" close={close}>
      <div className="list">
        {items.map(it => (
          <div className="opt" key={it.key}>
            <div className="grow">
              <div style={{ fontWeight: 800, fontSize: 18 }}>{it.label}</div>
              <div className="cost">{costIcons(it.cost)} · נשארו {it.left}</div>
            </div>
            <button className="btn small" disabled={!it.ok} onClick={() => pick(it.key)}>בחר מקום</button>
          </div>
        ))}
        <div className="opt">
          <div className="grow">
            <div style={{ fontWeight: 800, fontSize: 18 }}>קלף פיתוח</div>
            <div className="cost">{costIcons(COST.dev)} · בחפיסה {view.devDeckCount}</div>
          </div>
          <button className="btn small" disabled={!can.dev || !view.devDeckCount} onClick={buyDev}>קנה</button>
        </div>
      </div>
    </SheetFrame>
  );
}

function TradeSheet({ view, meId, act, close }: { view: GameView; meId: string; act: Act; close: () => void }) {
  const me = view.players.find(p => p.id === meId)!;
  const hand = me.resources!;
  const [tab, setTab] = useState<'bank' | 'players'>('players');
  const ratios = tradeRatios(view, meId);
  const [give, setGive] = useState<Res | null>(null);
  const [get, setGet] = useState<Res | null>(null);
  const [offerGive, setOfferGive] = useState<ResMap>(emptyRes());
  const [offerGet, setOfferGet] = useState<ResMap>(emptyRes());

  return (
    <SheetFrame title="מסחר" close={close}>
      <p className="field-label">הקלפים שלך</p>
      <Hand r={hand} />
      <div className="tabs">
        <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>עם שחקנים</button>
        <button className={tab === 'bank' ? 'on' : ''} onClick={() => setTab('bank')}>עם הבנק</button>
      </div>
      {tab === 'bank' ? (
        <>
          <p className="field-label">אני נותן</p>
          <div className="hand">
            {RES.map(k => (
              <button key={k} className={`rc r-${k}`} disabled={hand[k] < ratios[k]}
                style={{ border: give === k ? '3px solid var(--ink)' : '3px solid transparent', opacity: hand[k] < ratios[k] ? .35 : 1 }}
                onClick={() => setGive(k)}>
                <div className="ico">{RES_ICON[k]}</div><div className="n">{ratios[k]}:1</div>
              </button>
            ))}
          </div>
          <p className="field-label">ומקבל</p>
          <div className="hand">
            {RES.map(k => (
              <button key={k} className={`rc r-${k}`} disabled={k === give || view.bank[k] < 1}
                style={{ border: get === k ? '3px solid var(--ink)' : '3px solid transparent', opacity: k === give ? .35 : 1 }}
                onClick={() => setGet(k)}>
                <div className="ico">{RES_ICON[k]}</div><div className="n">1</div>
              </button>
            ))}
          </div>
          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={!give || !get || give === get}
            onClick={() => act({ type: 'bankTrade', give: give!, get: get! }).then(ok => ok && setGet(null))}>
            {give && get ? `החלף ${ratios[give]} ${RES_HE[give]} ב־1 ${RES_HE[get]}` : 'בחר מה נותנים ומה מקבלים'}
          </button>
        </>
      ) : (
        <>
          <p className="field-label">אני נותן</p>
          <Stepper value={offerGive} onChange={setOfferGive} max={hand} />
          <p className="field-label">ואני רוצה</p>
          <Stepper value={offerGet} onChange={setOfferGet} />
          <button className="btn" style={{ width: '100%' }} disabled={!resTotal(offerGive) || !resTotal(offerGet)}
            onClick={() => act({ type: 'offerTrade', give: offerGive, get: offerGet }).then(ok => ok && close())}>
            שלח הצעה לכולם
          </button>
        </>
      )}
    </SheetFrame>
  );
}

function TradeBanner({ view, meId, act }: { view: GameView; meId: string; act: Act }) {
  const t = view.trade!;
  const from = view.players.find(p => p.id === t.from)!;
  const mine = t.from === meId;
  const myResp = t.responses[meId];
  return (
    <div className="banner">
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        {mine ? 'ההצעה שלך' : `${from.name} מציע עסקה`}
      </div>
      <div style={{ fontSize: 16, marginBottom: 8 }}>
        {mine ? 'אתה נותן' : 'הוא נותן'}: <b>{resLine(t.give)}</b><br />
        {mine ? 'אתה מקבל' : 'ורוצה'}: <b>{resLine(t.get)}</b>
      </div>
      {mine ? (
        <div className="list">
          {view.players.filter(p => p.id !== meId).map(p => (
            <div className="row" key={p.id}>
              <span className={`dot c-${p.color}`} />
              <span className="grow">{p.name}</span>
              {t.responses[p.id] === 'accept'
                ? <button className="btn ok small" onClick={() => act({ type: 'confirmTrade', with: p.id })}>סגור עסקה</button>
                : <span style={{ color: 'var(--ink-soft)' }}>{t.responses[p.id] === 'reject' ? 'סירב' : 'חושב…'}</span>}
            </div>
          ))}
          <button className="btn light small" onClick={() => act({ type: 'cancelTrade' })}>בטל הצעה</button>
        </div>
      ) : myResp ? (
        <div style={{ color: 'var(--ink-soft)' }}>{myResp === 'accept' ? 'הסכמת. מחכים לאישור שלו.' : 'סירבת.'}</div>
      ) : (
        <div className="row">
          <button className="btn ok small grow" onClick={() => act({ type: 'respondTrade', accept: true })}>מסכים</button>
          <button className="btn danger small grow" onClick={() => act({ type: 'respondTrade', accept: false })}>לא</button>
        </div>
      )}
    </div>
  );
}

function DevSheet({ view, meId, myTurn, act, close }: { view: GameView; meId: string; myTurn: boolean; act: Act; close: () => void }) {
  const me = view.players.find(p => p.id === meId)!;
  const cards = me.dev ?? [];
  const [picking, setPicking] = useState<null | 'yearOfPlenty' | 'monopoly'>(null);
  const [chosen, setChosen] = useState<Res[]>([]);
  const types: DevType[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp'];
  const DESC: Record<DevType, string> = {
    knight: 'מזיזים את השודד וגונבים קלף. 3 אבירים ומעלה = צבא גדול.',
    roadBuilding: 'בונים 2 דרכים בחינם.',
    yearOfPlenty: 'לוקחים 2 משאבים לבחירתך מהבנק.',
    monopoly: 'בוחרים משאב, וכל השחקנים נותנים לך את כל מה שיש להם ממנו.',
    vp: 'נקודה נסתרת. נספרת אוטומטית.',
  };
  const canPlay = (t: DevType) => {
    if (t === 'vp' || !myTurn || view.devPlayed) return false;
    if (!cards.some(c => c.type === t && devReady(c, view.turnNo))) return false;
    return t === 'knight' ? view.sub === 'roll' || view.sub === 'main' : view.sub === 'main';
  };
  const play = (t: DevType) => {
    if (t === 'yearOfPlenty' || t === 'monopoly') { setPicking(t); setChosen([]); return; }
    act({ type: 'playDev', card: t as 'knight' | 'roadBuilding' }).then(ok => ok && close());
  };
  const need = picking === 'yearOfPlenty' ? 2 : 1;

  if (picking) return (
    <SheetFrame title={DEV_HE[picking]} close={() => setPicking(null)}>
      <p style={{ marginTop: 0 }}>{picking === 'yearOfPlenty' ? 'בחר 2 משאבים (אפשר אותו פעמיים)' : 'בחר משאב אחד'}</p>
      <div className="hand">
        {RES.map(k => (
          <button key={k} className={`rc r-${k}`} style={{ border: '3px solid transparent' }}
            onClick={() => setChosen(c => (c.length >= need ? [k] : [...c, k]))}>
            <div className="ico">{RES_ICON[k]}</div><div className="n">{chosen.filter(c => c === k).length || ''}</div>
          </button>
        ))}
      </div>
      <button className="btn" style={{ width: '100%', marginTop: 10 }} disabled={chosen.length !== need}
        onClick={() => act({ type: 'playDev', card: picking, res: chosen }).then(ok => ok && close())}>
        שחק
      </button>
    </SheetFrame>
  );

  return (
    <SheetFrame title="קלפי פיתוח" close={close}>
      {!cards.length && <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>אין לך קלפי פיתוח. קונים אותם דרך "בנה".</p>}
      <div className="list">
        {types.filter(t => cards.some(c => c.type === t)).map(t => {
          const n = cards.filter(c => c.type === t).length;
          const fresh = cards.filter(c => c.type === t && !devReady(c, view.turnNo)).length;
          return (
            <div className="opt" key={t}>
              <div className="grow">
                <div style={{ fontWeight: 800, fontSize: 18 }}>{DEV_HE[t]} ×{n}</div>
                <div className="cost">{DESC[t]}{fresh && t !== 'vp' ? ` (${fresh} נקנו עכשיו, אפשר לשחק מהתור הבא)` : ''}</div>
              </div>
              {t !== 'vp' && <button className="btn small" disabled={!canPlay(t)} onClick={() => play(t)}>שחק</button>}
            </div>
          );
        })}
      </div>
      {view.devPlayed && myTurn && <p style={{ color: 'var(--ink-soft)', marginBottom: 0 }}>כבר שיחקת קלף פיתוח בתור הזה.</p>}
    </SheetFrame>
  );
}

function DiscardSheet({ need, hand, act }: { need: number; hand: ResMap; act: Act }) {
  const [sel, setSel] = useState<ResMap>(emptyRes());
  return (
    <SheetFrame title={`יצא 7: זרוק ${need} קלפים`}>
      <p style={{ marginTop: 0 }}>יש לך יותר מ־7 קלפים, אז חצי הולכים לבנק. בחרת {resTotal(sel)} מתוך {need}.</p>
      <Stepper value={sel} onChange={setSel} max={hand} />
      <button className="btn" style={{ width: '100%' }} disabled={resTotal(sel) !== need}
        onClick={() => act({ type: 'discard', cards: sel })}>זרוק</button>
    </SheetFrame>
  );
}

function StealSheet({ view, act, onStolen }: { view: GameView; act: Act; onStolen: () => void }) {
  const [target, setTarget] = useState<string | null>(view.stealFrom.length === 1 ? view.stealFrom[0] : null);
  const [busy, setBusy] = useState(false);
  const victim = view.players.find(p => p.id === target);
  if (victim) return (
    <SheetFrame title={`בחר קלף מ${victim.name}`}>
      <div className="steal-fan">
        {Array.from({ length: victim.resCount }, (_, i) => (
          <button key={i} className="card-back" disabled={busy} style={{ animationDelay: `${i * 40}ms` }}
            onClick={() => { setBusy(true); act({ type: 'steal', target: victim.id, pick: i }).then(ok => { if (ok) onStolen(); else setBusy(false); }); }}>
            🏝️
          </button>
        ))}
      </div>
      {view.stealFrom.length > 1 && <button className="btn light small" style={{ marginTop: 10 }} onClick={() => setTarget(null)}>שחקן אחר</button>}
    </SheetFrame>
  );
  return (
    <SheetFrame title="ממי לגנוב?">
      <div className="list">
        {view.stealFrom.map(id => {
          const p = view.players.find(x => x.id === id)!;
          return (
            <button key={id} className="opt" style={{ cursor: 'pointer', font: 'inherit' }} onClick={() => setTarget(id)}>
              <span className={`dot c-${p.color}`} />
              <span className="grow" style={{ textAlign: 'right', fontWeight: 800 }}>{p.name}</span>
              <span className="cost">⭐ {p.publicVp} נקודות · {p.resCount} קלפים</span>
            </button>
          );
        })}
      </div>
    </SheetFrame>
  );
}

function LogSheet({ view, close }: { view: GameView; close: () => void }) {
  return (
    <SheetFrame title="מה קרה" close={close}>
      <div className="log">
        {[...view.log].reverse().map((l, i) => <div key={i}>{l.text}</div>)}
      </div>
    </SheetFrame>
  );
}

function scoreParts(view: GameView, p: PublicPlayer) {
  const own = Object.values(view.buildings).filter(b => b.owner === p.id);
  const vpCards = p.dev?.filter(d => d.type === 'vp').length ?? 0;
  return [
    { label: 'יישובים', n: own.filter(b => b.type === 'settlement').length, pts: 1 },
    { label: 'ערים', n: own.filter(b => b.type === 'city').length, pts: 2 },
    { label: 'הדרך הארוכה', n: view.longestRoad === p.id ? 1 : 0, pts: 2 },
    { label: 'הצבא הגדול', n: view.largestArmy === p.id ? 1 : 0, pts: 2 },
    { label: 'קלפי נקודת ניצחון', n: vpCards, pts: 1 },
  ].filter(x => x.n > 0);
}

function WinOverlay({ view }: { view: GameView }) {
  const [hidden, setHidden] = useState(false);
  const w = view.players.find(p => p.id === view.winner);
  const ranked = [...view.players].sort((a, b) => b.publicVp - a.publicVp);
  if (hidden) return (
    <button className="btn win-back" onClick={() => setHidden(false)}>🏆 חזרה לתוצאות</button>
  );
  return (
    <div className="overlay">
      <div className="card win-card">
        <div style={{ fontSize: 52, textAlign: 'center' }}>🏆</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 30, textAlign: 'center' }}>{w?.name} ניצח!</h2>
        <div className="win-list">
          {ranked.map(p => (
            <div key={p.id} className={`win-row ${p.id === view.winner ? 'won' : ''}`}>
              <div className="row">
                <span className={`dot c-${p.color}`} />
                <b className="grow">{p.name}</b>
                <span className="win-vp">{p.publicVp}</span>
              </div>
              <div className="win-parts">
                {scoreParts(view, p).map(x => (
                  <span key={x.label}>{x.label}{x.pts === 2 && x.label.startsWith('ה') ? '' : ` ×${x.n}`} = {x.n * x.pts}</span>
                ))}
              </div>
              {p.dev && p.dev.length > 0 && (
                <div className="win-dev">קלפי פיתוח שנשארו: {p.dev.map(d => DEV_HE[d.type]).join(', ')}</div>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn light grow" onClick={() => setHidden(true)}>צפה בלוח</button>
          <a className="btn grow" href="/" style={{ textDecoration: 'none', textAlign: 'center' }}>משחק חדש</a>
        </div>
      </div>
    </div>
  );
}
