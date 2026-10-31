'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EDGES, HEXES, VERTICES } from '@/lib/engine/geometry';
import type { GameView, Res } from '@/lib/engine/types';

export type PickMode =
  | { kind: 'vertex'; ids: number[]; onPick: (id: number) => void }
  | { kind: 'edge'; ids: number[]; onPick: (id: number) => void }
  | { kind: 'hex'; ids: number[]; onPick: (id: number) => void }
  | null;

export const PLAYER_FILL: Record<string, string> = {
  red: '#d64545', blue: '#2f6fd6', orange: '#f08c1a', green: '#2e9e5b',
};
const TERRAIN_FILL: Record<string, string> = {
  brick: '#c4622d', lumber: '#2f7a3b', wool: '#8fcf5a', grain: '#e8c14a', ore: '#8a8f99', desert: '#e3cf9c',
};
export const RES_ICON: Record<Res | 'desert', string> = {
  brick: '🧱', lumber: '🌲', wool: '🐑', grain: '🌾', ore: '⛰️', desert: '🏜️',
};

const S = 60; // svg px per hex unit
const TILE_W = Math.sqrt(3) * S; // pointy-top hex width
const pts = (vs: number[]) => vs.map(v => `${VERTICES[v].x * S},${VERTICES[v].y * S}`).join(' ');

// Fixed board frame (with room for ports outside the coast)
const PAD = 0.98 * S;
const minX = Math.min(...VERTICES.map(v => v.x)) * S - PAD;
const maxX = Math.max(...VERTICES.map(v => v.x)) * S + PAD;
const minY = Math.min(...VERTICES.map(v => v.y)) * S - PAD;
const maxY = Math.max(...VERTICES.map(v => v.y)) * S + PAD;
const BW = maxX - minX, BH = maxY - minY;

export default function Board({ view, mode }: { view: GameView; mode: PickMode }) {
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);

  // The robber drops in when it moves; players it blocks see their tile flash red.
  const [drop, setDrop] = useState<{ hex: number; mine: boolean; key: number } | null>(null);
  const lastRobber = useRef(view.robber);
  useEffect(() => {
    if (view.robber === lastRobber.current) return;
    lastRobber.current = view.robber;
    const mine = !!view.you && HEXES[view.robber].vertices.some(v => view.buildings[v]?.owner === view.you);
    if (mine) try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
    const key = Date.now();
    setDrop({ hex: view.robber, mine, key });
    // Not cleared on re-render: the board updates often and must not cut the animation short.
    setTimeout(() => setDrop(d => (d?.key === key ? null : d)), 2600);
  }, [view.robber, view.you, view.buildings]);

  const colorOf = useMemo(() => Object.fromEntries(view.players.map(p => [p.id, PLAYER_FILL[p.color]])), [view.players]);

  const vbW = BW / t.k, vbH = BH / t.k;
  const vbX = minX + (BW - vbW) / 2 - t.x, vbY = minY + (BH - vbH) / 2 - t.y;

  const clampT = (n: { k: number; x: number; y: number }) => {
    const k = Math.min(3.2, Math.max(1, n.k));
    const lim = (v: number, span: number) => Math.max(-span, Math.min(span, v));
    return { k, x: lim(n.x, (BW - BW / k) / 2 + 20), y: lim(n.y, (BH - BH / k) / 2 + 20) };
  };
  const unitsPerPx = () => {
    const el = wrap.current;
    if (!el) return 1;
    return Math.max(vbW / el.clientWidth, vbH / el.clientHeight);
  };

  function onDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = 0;
  }
  function onMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const ps = [...pointers.current.values()];
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      const u = unitsPerPx();
      setT(o => clampT({ ...o, x: o.x + dx * u, y: o.y + dy * u }));
    } else if (pointers.current.size === 2) {
      const other = ps.find(p => p !== prev)!;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      moved.current += 20;
      if (d0 > 0) setT(o => clampT({ ...o, k: o.k * (d1 / d0) }));
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function onUp(e: React.PointerEvent) { pointers.current.delete(e.pointerId); }
  function onWheel(e: React.WheelEvent) {
    setT(o => clampT({ ...o, k: o.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12) }));
  }
  const pick = (fn: () => void) => () => { if (moved.current < 10) fn(); };

  const targets = new Set(mode?.ids ?? []);

  return (
    <div
      className="board-wrap" ref={wrap}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
      onWheel={onWheel}
    >
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".35" />
          </filter>
        </defs>

        {/* island base */}
        {HEXES.map(h => (
          <polygon key={`b${h.id}`} points={pts(h.vertices)} fill="#e9d9a6" stroke="#e9d9a6" strokeWidth={14} strokeLinejoin="round" />
        ))}

        {/* ports */}
        {view.ports.map((p, i) => {
          const e = EDGES[p.edge];
          const len = Math.hypot(e.x, e.y) || 1;
          const px = (e.x + (e.x / len) * 0.62) * S, py = (e.y + (e.y / len) * 0.62) * S;
          return (
            <g key={`p${i}`}>
              {[e.a, e.b].map(v => (
                <line key={v} x1={px} y1={py} x2={VERTICES[v].x * S} y2={VERTICES[v].y * S} stroke="#7a5a2e" strokeWidth={5} strokeLinecap="round" />
              ))}
              <circle cx={px} cy={py} r={17} fill="#fbf4e2" stroke="#7a5a2e" strokeWidth={2} />
              {p.type === 'any'
                ? <text x={px} y={py + 5} textAnchor="middle" fontSize={13} fontWeight={800} fill="#2a1d10">3:1</text>
                : <>
                    <text x={px} y={py - 1} textAnchor="middle" fontSize={13}>{RES_ICON[p.type]}</text>
                    <text x={px} y={py + 12} textAnchor="middle" fontSize={10} fontWeight={800} fill="#2a1d10">2:1</text>
                  </>}
            </g>
          );
        })}

        {/* tiles */}
        {HEXES.map(h => {
          const hx = view.hexes[h.id];
          const cx = h.x * S, cy = h.y * S;
          const hot = hx.number === 6 || hx.number === 8;
          const pips = hx.number ? 6 - Math.abs(7 - hx.number) : 0;
          return (
            <g key={`h${h.id}`}>
              {/* painted tile: the colour shows while the picture loads */}
              <clipPath id={`hc${h.id}`}><polygon points={pts(h.vertices)} /></clipPath>
              <polygon points={pts(h.vertices)} fill={TERRAIN_FILL[hx.terrain]} />
              <image href={`/tiles/${hx.terrain}.webp`} x={cx - TILE_W / 2} y={cy - S} width={TILE_W} height={2 * S}
                preserveAspectRatio="xMidYMid slice" clipPath={`url(#hc${h.id})`} />
              <polygon points={pts(h.vertices)} fill="none" stroke="#e2bd52" strokeWidth={2.5} strokeLinejoin="round" />
              {hx.number && (
                <g filter="url(#sh)">
                  <circle cx={cx} cy={cy + 6} r={17} fill="#fbf4e2" stroke="#c9a347" strokeWidth={1.5} />
                  <text x={cx} y={cy + 11} textAnchor="middle" fontSize={hot ? 18 : 16} fontWeight={800}
                    fill={hot ? '#c0392b' : '#2a1d10'} fontFamily="Secular One, sans-serif">{hx.number}</text>
                  {Array.from({ length: pips }).map((_, i) => (
                    <circle key={i} cx={cx + (i - (pips - 1) / 2) * 4} cy={cy + 17} r={1.4} fill={hot ? '#c0392b' : '#2a1d10'} />
                  ))}
                </g>
              )}
            </g>
          );
        })}

        {/* roads */}
        {Object.entries(view.roads).map(([eid, owner]) => {
          const e = EDGES[+eid], a = VERTICES[e.a], b = VERTICES[e.b];
          const sx = a.x + (b.x - a.x) * 0.14, sy = a.y + (b.y - a.y) * 0.14;
          const ex = a.x + (b.x - a.x) * 0.86, ey = a.y + (b.y - a.y) * 0.86;
          return (
            <g key={`r${eid}`}>
              <line x1={sx * S} y1={sy * S} x2={ex * S} y2={ey * S} stroke="#2a1d10" strokeWidth={11} strokeLinecap="round" />
              <line x1={sx * S} y1={sy * S} x2={ex * S} y2={ey * S} stroke={colorOf[owner]} strokeWidth={7} strokeLinecap="round" />
            </g>
          );
        })}

        {/* buildings */}
        {Object.entries(view.buildings).map(([vid, b]) => {
          const v = VERTICES[+vid];
          const x = v.x * S, y = v.y * S;
          const d = b.type === 'city'
            ? `M${x - 14},${y + 10} L${x - 14},${y - 4} L${x - 6},${y - 12} L${x + 2},${y - 4} L${x + 2},${y - 2} L${x + 14},${y - 2} L${x + 14},${y + 10} Z`
            : `M${x - 9},${y + 8} L${x - 9},${y - 3} L${x},${y - 11} L${x + 9},${y - 3} L${x + 9},${y + 8} Z`;
          // Drawn 35% larger around the corner they stand on, so they read clearly over the painted tiles.
          return <path key={`v${vid}`} d={d} fill={colorOf[b.owner]} stroke="#2a1d10" strokeWidth={1.8} strokeLinejoin="round" filter="url(#sh)"
            transform={`translate(${x} ${y}) scale(1.35) translate(${-x} ${-y})`} />;
        })}

        {/* robber */}
        {(() => {
          const h = HEXES[view.robber];
          const x = h.x * S + 27, y = h.y * S + 2;
          const dropping = drop?.hex === view.robber;
          return (
            <g key={dropping ? drop!.key : 'still'} filter="url(#sh)" className={dropping ? 'robber-drop' : ''}>
              <ellipse cx={x} cy={y + 17} rx={13} ry={5} fill="#1d1d1d" />
              <path d={`M${x - 12},${y + 17} Q${x - 13},${y - 3} ${x},${y - 6} Q${x + 13},${y - 3} ${x + 12},${y + 17} Z`}
                fill="#2b2b2b" stroke="#f3e2b8" strokeWidth={1.2} />
              <circle cx={x} cy={y - 13} r={9} fill="#2b2b2b" stroke="#f3e2b8" strokeWidth={1.2} />
            </g>
          );
        })()}

        {drop && (
          <g key={`hit${drop.key}`} pointerEvents="none">
            <polygon points={pts(HEXES[drop.hex].vertices)} className={drop.mine ? 'robber-hit mine' : 'robber-hit'} />
            <circle cx={HEXES[drop.hex].x * S + 27} cy={HEXES[drop.hex].y * S + 19} r={14} className="robber-dust" />
          </g>
        )}

        {/* pick targets */}
        {mode?.kind === 'hex' && HEXES.filter(h => targets.has(h.id)).map(h => (
          <polygon key={`th${h.id}`} points={pts(h.vertices)} fill="rgba(224,165,38,.18)" stroke="#e0a526" strokeWidth={4}
            style={{ cursor: 'pointer' }} onClick={pick(() => mode.onPick(h.id))}>
            <animate attributeName="stroke-opacity" values="1;.3;1" dur="1.2s" repeatCount="indefinite" />
          </polygon>
        ))}
        {mode?.kind === 'edge' && EDGES.filter(e => targets.has(e.id)).map(e => {
          const a = VERTICES[e.a], b = VERTICES[e.b];
          return (
            <g key={`te${e.id}`} style={{ cursor: 'pointer' }} onClick={pick(() => mode.onPick(e.id))}>
              <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="transparent" strokeWidth={26} />
              <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="#ffd34d" strokeWidth={8} strokeLinecap="round" strokeDasharray="6 6">
                <animate attributeName="stroke-opacity" values="1;.35;1" dur="1.2s" repeatCount="indefinite" />
              </line>
            </g>
          );
        })}
        {mode?.kind === 'vertex' && VERTICES.filter(v => targets.has(v.id)).map(v => (
          <g key={`tv${v.id}`} style={{ cursor: 'pointer' }} onClick={pick(() => mode.onPick(v.id))}>
            <circle cx={v.x * S} cy={v.y * S} r={18} fill="transparent" />
            <circle cx={v.x * S} cy={v.y * S} r={9} fill="#ffd34d" stroke="#2a1d10" strokeWidth={2}>
              <animate attributeName="r" values="7;11;7" dur="1.2s" repeatCount="indefinite" />
            </circle>
          </g>
        ))}
      </svg>
      <div className="zoom-ctl">
        <button onClick={() => setT(o => clampT({ ...o, k: o.k * 1.3 }))} aria-label="הגדל">+</button>
        <button onClick={() => setT(o => clampT({ ...o, k: o.k / 1.3 }))} aria-label="הקטן">−</button>
        <button onClick={() => setT({ k: 1, x: 0, y: 0 })} aria-label="איפוס" style={{ fontSize: 15 }}>⤢</button>
      </div>
    </div>
  );
}
