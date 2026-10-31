import { COAST, HEXES } from './geometry';
import type { GameState, Res, Terrain } from './types';

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TERRAINS: Terrain[] = [
  ...Array(3).fill('brick'), ...Array(4).fill('lumber'), ...Array(4).fill('wool'),
  ...Array(4).fill('grain'), ...Array(3).fill('ore'), 'desert',
];
// Number tokens A..R as printed on the back of the official tokens.
export const TOKEN_ORDER = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

const ring = (h: { q: number; r: number }) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));
// Screen angle measured counter-clockwise (y grows downward on screen).
const ccwAngle = (h: { x: number; y: number }) => (Math.atan2(-h.y, h.x) * 180 / Math.PI + 360) % 360;
const CORNERS = HEXES.filter(h => ring(h) === 2 && (h.q === 0 || h.r === 0 || h.q + h.r === 0));

/** Hex ids in the official spiral: from an outer corner, counter-clockwise around the rim, then inward. */
export function spiralOrder(corner: number): number[] {
  const start = ccwAngle(HEXES[corner]);
  const around = (rg: number) => HEXES.filter(h => ring(h) === rg)
    .map(h => ({ id: h.id, a: (ccwAngle(h) - start + 360 + 0.001) % 360 }))
    .sort((p, q) => p.a - q.a).map(p => p.id);
  return [...around(2), ...around(1), ...around(0)];
}
const PORT_TYPES: (Res | 'any')[] = ['any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'grain', 'ore'];
// 30 coastal edges, 9 ports: gaps of 3,3,4 repeated (like the printed frame).
const PORT_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

export function generateBoard(rng: Rng = Math.random): Pick<GameState, 'hexes' | 'ports' | 'robber'> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const terrains = shuffle(TERRAINS, rng);
    const hexes = terrains.map(t => ({ terrain: t, number: null as number | null }));
    // Tokens go A..R along the spiral from a random corner, skipping the desert.
    let n = 0;
    for (const id of spiralOrder(CORNERS[Math.floor(rng() * CORNERS.length)].id))
      if (hexes[id].terrain !== 'desert') hexes[id].number = TOKEN_ORDER[n++];
    // 6 and 8 must never touch.
    const hot = (i: number) => hexes[i].number === 6 || hexes[i].number === 8;
    const ok = HEXES.every(h => !hot(h.id) || h.neighbors.every(nb => !hot(nb)));
    if (!ok) continue;
    const types = shuffle(PORT_TYPES, rng);
    const offset = Math.floor(rng() * COAST.length);
    const ports: GameState['ports'] = [];
    let pos = offset;
    for (let i = 0; i < 9; i++) {
      ports.push({ edge: COAST[pos % COAST.length], type: types[i] });
      pos += PORT_GAPS[i];
    }
    return { hexes, ports, robber: hexes.findIndex(h => h.terrain === 'desert') };
  }
  throw new Error('board generation failed');
}
