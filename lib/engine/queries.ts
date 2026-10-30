// Read-only helpers. They work on both the full server state and the filtered client view.
import { EDGES, HEXES, VERTICES } from './geometry';
import { COST, PIECES, RES, type GameState, type Res, type ResMap } from './types';

type Board = Pick<GameState, 'buildings' | 'roads' | 'ports' | 'hexes' | 'robber'>;

export const ownerAt = (s: Board, v: number) => s.buildings[v]?.owner ?? null;

export function piecesLeft(s: Board, pid: string) {
  let roads = 0, settlements = 0, cities = 0;
  for (const o of Object.values(s.roads)) if (o === pid) roads++;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) b.type === 'city' ? cities++ : settlements++;
  return { road: PIECES.road - roads, settlement: PIECES.settlement - settlements, city: PIECES.city - cities };
}

/** Distance rule: vertex empty and none of its neighbours built on. */
export const vertexFree = (s: Board, v: number) =>
  !s.buildings[v] && VERTICES[v].vertices.every(n => !s.buildings[n]);

export function canPlaceSetupSettlement(s: Board, v: number) {
  return vertexFree(s, v);
}

export function canPlaceSetupRoad(s: Board, e: number, fromVertex: number | null) {
  if (s.roads[e] || fromVertex === null) return false;
  return EDGES[e].a === fromVertex || EDGES[e].b === fromVertex;
}

export function canBuildRoad(s: Board, pid: string, e: number) {
  if (s.roads[e]) return false;
  const { a, b } = EDGES[e];
  return [a, b].some(v => {
    const o = ownerAt(s, v);
    if (o === pid) return true;
    if (o) return false; // opponent building blocks the connection
    return VERTICES[v].edges.some(oe => oe !== e && s.roads[oe] === pid);
  });
}

export function canBuildSettlement(s: Board, pid: string, v: number) {
  return vertexFree(s, v) && VERTICES[v].edges.some(e => s.roads[e] === pid);
}

export const canBuildCity = (s: Board, pid: string, v: number) =>
  s.buildings[v]?.owner === pid && s.buildings[v].type === 'settlement';

export const validRoads = (s: Board, pid: string) => EDGES.filter(e => canBuildRoad(s, pid, e.id)).map(e => e.id);
export const validSettlements = (s: Board, pid: string) => VERTICES.filter(v => canBuildSettlement(s, pid, v.id)).map(v => v.id);
export const validCities = (s: Board, pid: string) => VERTICES.filter(v => canBuildCity(s, pid, v.id)).map(v => v.id);
export const validSetupSettlements = (s: Board) => VERTICES.filter(v => vertexFree(s, v.id)).map(v => v.id);
export const validSetupRoads = (s: Board, from: number | null) => EDGES.filter(e => canPlaceSetupRoad(s, e.id, from)).map(e => e.id);

export function canAfford(r: ResMap | undefined, cost: Partial<ResMap>) {
  if (!r) return false;
  return RES.every(k => (r[k] || 0) >= (cost[k] || 0));
}

export function affordable(r: ResMap | undefined) {
  return {
    road: canAfford(r, COST.road),
    settlement: canAfford(r, COST.settlement),
    city: canAfford(r, COST.city),
    dev: canAfford(r, COST.dev),
  };
}

/** Best bank ratio per resource for a player (4, or 3/2 with ports). */
export function tradeRatios(s: Board, pid: string): Record<Res, number> {
  const out = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 } as Record<Res, number>;
  for (const p of s.ports) {
    const { a, b } = EDGES[p.edge];
    if (ownerAt(s, a) !== pid && ownerAt(s, b) !== pid) continue;
    if (p.type === 'any') { for (const k of RES) out[k] = Math.min(out[k], 3); }
    else out[p.type] = 2;
  }
  return out;
}

/** Players that can be robbed on a hex (have a building on it), excluding `self`. */
export function robbableOn(s: Board, hex: number, self: string): string[] {
  const set = new Set<string>();
  for (const v of HEXES[hex].vertices) {
    const o = ownerAt(s, v);
    if (o && o !== self) set.add(o);
  }
  return [...set];
}

export function longestRoadLength(s: Board, pid: string): number {
  const mine = EDGES.filter(e => s.roads[e.id] === pid);
  if (!mine.length) return 0;
  const blocked = (v: number) => { const o = ownerAt(s, v); return !!o && o !== pid; };
  const used = new Set<number>();
  let best = 0;
  const dfs = (v: number, len: number) => {
    best = Math.max(best, len);
    for (const e of VERTICES[v].edges) {
      if (s.roads[e] !== pid || used.has(e)) continue;
      const nxt = EDGES[e].a === v ? EDGES[e].b : EDGES[e].a;
      used.add(e);
      if (blocked(nxt)) best = Math.max(best, len + 1);
      else dfs(nxt, len + 1);
      used.delete(e);
    }
  };
  for (const e of mine) { dfs(e.a, 0); dfs(e.b, 0); }
  return best;
}

export function publicVp(s: Pick<GameState, 'buildings' | 'longestRoad' | 'largestArmy'>, pid: string) {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) vp += b.type === 'city' ? 2 : 1;
  if (s.longestRoad === pid) vp += 2;
  if (s.largestArmy === pid) vp += 2;
  return vp;
}
