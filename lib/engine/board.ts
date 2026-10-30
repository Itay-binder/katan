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
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const PORT_TYPES: (Res | 'any')[] = ['any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'grain', 'ore'];
// 30 coastal edges, 9 ports: gaps of 3,3,4 repeated (like the printed frame).
const PORT_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4];

export function generateBoard(rng: Rng = Math.random): Pick<GameState, 'hexes' | 'ports' | 'robber'> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const terrains = shuffle(TERRAINS, rng);
    const nums = shuffle(NUMBERS, rng);
    let n = 0;
    const hexes = terrains.map(t => ({ terrain: t, number: t === 'desert' ? null : nums[n++] }));
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
