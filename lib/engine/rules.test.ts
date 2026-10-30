import { describe, expect, it } from 'vitest';
import { generateBoard } from './board';
import { COAST, EDGES, HEXES, VERTICES } from './geometry';
import { canBuildRoad, longestRoadLength, validSetupRoads, validSetupSettlements } from './queries';
import { applyAction, createGame, joinGame, viewFor, totalVp } from './rules';
import { GameError, emptyRes, resTotal, type GameState } from './types';

function seeded(seed = 42) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

function setupGame(n = 3, seed = 1): GameState {
  const rng = seeded(seed);
  const s = createGame('room', null, 0, rng);
  for (let i = 0; i < n; i++) joinGame(s, `p${i}`, rng);
  applyAction(s, s.hostId, { type: 'start' }, 0, rng);
  return s;
}

function playSetup(s: GameState) {
  const rng = seeded(7);
  while (s.sub === 'setupSettlement' || s.sub === 'setupRoad') {
    const pid = s.players[s.current].id;
    if (s.sub === 'setupSettlement') {
      const opts = validSetupSettlements(s);
      applyAction(s, pid, { type: 'placeSettlement', vertex: opts[Math.floor(rng() * opts.length)] }, 0, rng);
    } else {
      applyAction(s, pid, { type: 'placeRoad', edge: validSetupRoads(s, s.lastSetupVertex)[0] }, 0, rng);
    }
  }
}

describe('geometry', () => {
  it('has the standard board shape', () => {
    expect(HEXES).toHaveLength(19);
    expect(VERTICES).toHaveLength(54);
    expect(EDGES).toHaveLength(72);
    expect(COAST).toHaveLength(30);
  });
});

describe('board', () => {
  it('never puts 6 and 8 next to each other, and has one desert with the robber', () => {
    for (let i = 0; i < 50; i++) {
      const b = generateBoard(seeded(i + 1));
      const hot = (h: number) => b.hexes[h].number === 6 || b.hexes[h].number === 8;
      for (const h of HEXES) if (hot(h.id)) expect(h.neighbors.some(hot)).toBe(false);
      expect(b.hexes.filter(h => h.terrain === 'desert')).toHaveLength(1);
      expect(b.hexes[b.robber].terrain).toBe('desert');
      expect(b.ports).toHaveLength(9);
      expect(new Set(b.ports.map(p => p.edge)).size).toBe(9);
    }
  });
});

describe('lobby', () => {
  it('limits to 4 players and unique colors', () => {
    const s = createGame('r', null, 0);
    const ps = [0, 1, 2, 3].map(i => joinGame(s, `p${i}`));
    expect(new Set(ps.map(p => p.color)).size).toBe(4);
    expect(() => joinGame(s, 'p5')).toThrow(GameError);
    expect(() => applyAction(s, ps[1].id, { type: 'setColor', color: ps[0].color }, 0)).toThrow(GameError);
    expect(() => applyAction(s, ps[1].id, { type: 'start' }, 0)).toThrow(GameError);
  });
});

describe('setup phase', () => {
  it('runs in snake order and gives resources for the second settlement', () => {
    const s = setupGame(3);
    const order: string[] = [];
    const rng = seeded(3);
    while (s.sub === 'setupSettlement' || s.sub === 'setupRoad') {
      const pid = s.players[s.current].id;
      if (s.sub === 'setupSettlement') {
        order.push(pid);
        const opts = validSetupSettlements(s);
        applyAction(s, pid, { type: 'placeSettlement', vertex: opts[Math.floor(rng() * opts.length)] }, 0, rng);
      } else applyAction(s, pid, { type: 'placeRoad', edge: validSetupRoads(s, s.lastSetupVertex)[0] }, 0, rng);
    }
    const ids = s.players.map(p => p.id);
    expect(order).toEqual([ids[0], ids[1], ids[2], ids[2], ids[1], ids[0]]);
    expect(s.sub).toBe('roll');
    expect(s.current).toBe(0);
    const total = s.players.reduce((a, p) => a + resTotal(p.resources), 0);
    expect(total).toBeGreaterThan(0);
  });

  it('rejects settlements next to each other and roads away from the new settlement', () => {
    const s = setupGame(2);
    const pid = s.players[0].id;
    applyAction(s, pid, { type: 'placeSettlement', vertex: 10 }, 0);
    const far = EDGES.find(e => e.a !== 10 && e.b !== 10)!.id;
    expect(() => applyAction(s, pid, { type: 'placeRoad', edge: far }, 0)).toThrow(GameError);
    applyAction(s, pid, { type: 'placeRoad', edge: VERTICES[10].edges[0] }, 0);
    const p2 = s.players[1].id;
    expect(() => applyAction(s, p2, { type: 'placeSettlement', vertex: VERTICES[10].vertices[0] }, 0)).toThrow(GameError);
  });
});

describe('turn flow', () => {
  it('rolling a 7 forces discards then robber', () => {
    const s = setupGame(3);
    playSetup(s);
    const victim = s.players[1];
    victim.resources = { brick: 3, lumber: 3, wool: 3, grain: 0, ore: 0 };
    let i = 0;
    const dice = [0.5, 0.2]; // 4 + 2 = 6? -> pick values to make 7: floor(r*6)+1
    // force a 7: 3 + 4
    const rng = () => [0.4, 0.6][i++ % 2];
    applyAction(s, s.players[0].id, { type: 'roll' }, 0, rng);
    expect(s.dice![0] + s.dice![1]).toBe(7);
    expect(s.sub).toBe('discard');
    expect(s.discards[victim.id]).toBe(4);
    expect(() => applyAction(s, s.players[0].id, { type: 'moveRobber', hex: 0 }, 0)).toThrow(GameError);
    applyAction(s, victim.id, { type: 'discard', cards: { brick: 2, lumber: 2, wool: 0, grain: 0, ore: 0 } }, 0);
    expect(resTotal(victim.resources)).toBe(5);
    expect(s.sub).toBe('robber');
    const target = HEXES.find(h => h.id !== s.robber)!.id;
    applyAction(s, s.players[0].id, { type: 'moveRobber', hex: target }, 0);
    expect(['main', 'steal']).toContain(s.sub);
    void dice;
  });

  it('builds roads only connected to own network and charges resources', () => {
    const s = setupGame(2);
    playSetup(s);
    const me = s.players[0];
    s.sub = 'main';
    me.resources = { ...emptyRes(), brick: 1, lumber: 1 };
    const ok = EDGES.find(e => canBuildRoad(s, me.id, e.id))!.id;
    const bad = EDGES.find(e => !canBuildRoad(s, me.id, e.id) && !s.roads[e.id])!.id;
    expect(() => applyAction(s, me.id, { type: 'buildRoad', edge: bad }, 0)).toThrow(GameError);
    applyAction(s, me.id, { type: 'buildRoad', edge: ok }, 0);
    expect(resTotal(me.resources)).toBe(0);
    expect(() => applyAction(s, me.id, { type: 'buildRoad', edge: ok }, 0)).toThrow(GameError);
  });

  it('dev cards cannot be played the turn they were bought', () => {
    const s = setupGame(2);
    playSetup(s);
    const me = s.players[0];
    s.sub = 'main';
    me.resources = { ...emptyRes(), wool: 1, grain: 1, ore: 1 };
    s.devDeck.push('monopoly');
    applyAction(s, me.id, { type: 'buyDev' }, 0);
    expect(() => applyAction(s, me.id, { type: 'playDev', card: 'monopoly', res: ['ore'] }, 0)).toThrow(GameError);
    me.dev[0].boughtTurn = s.turnNo - 1;
    s.players[1].resources.ore = 3;
    applyAction(s, me.id, { type: 'playDev', card: 'monopoly', res: ['ore'] }, 0);
    expect(me.resources.ore).toBe(3);
    expect(s.players[1].resources.ore).toBe(0);
  });

  it('player trade: offer, accept, confirm', () => {
    const s = setupGame(2);
    playSetup(s);
    const [a, b] = s.players;
    s.sub = 'main';
    a.resources = { ...emptyRes(), brick: 2 };
    b.resources = { ...emptyRes(), ore: 1 };
    applyAction(s, a.id, { type: 'offerTrade', give: { ...emptyRes(), brick: 2 }, get: { ...emptyRes(), ore: 1 } }, 0);
    applyAction(s, b.id, { type: 'respondTrade', accept: true }, 0);
    applyAction(s, a.id, { type: 'confirmTrade', with: b.id }, 0);
    expect(a.resources).toMatchObject({ brick: 0, ore: 1 });
    expect(b.resources).toMatchObject({ brick: 2, ore: 0 });
  });

  it('bank trade at 4:1 without ports', () => {
    const s = setupGame(2);
    playSetup(s);
    const me = s.players[0];
    s.sub = 'main';
    s.ports = [];
    me.resources = { ...emptyRes(), grain: 4 };
    applyAction(s, me.id, { type: 'bankTrade', give: 'grain', get: 'ore' }, 0);
    expect(me.resources).toMatchObject({ grain: 0, ore: 1 });
  });

  it('timeout passes the turn', () => {
    const rng = seeded(5);
    const s = createGame('r', 60, 0, rng);
    joinGame(s, 'a', rng); joinGame(s, 'b', rng);
    applyAction(s, s.hostId, { type: 'start' }, 0, rng);
    expect(s.deadline).toBe(60000);
    expect(() => applyAction(s, s.players[0].id, { type: 'timeout' }, 1000, rng)).toThrow(GameError);
    let now = 0;
    for (let i = 0; i < 4; i++) { now = s.deadline!; applyAction(s, s.players[0].id, { type: 'timeout' }, now, rng); }
    expect(s.sub).toBe('roll');
    const first = s.current;
    now = s.deadline!;
    applyAction(s, s.players[0].id, { type: 'timeout' }, now, rng);
    expect(s.current).not.toBe(first);
    expect(s.sub).toBe('roll');
  });
});

describe('scoring', () => {
  it('longest road needs 5 and is cut by an opponent settlement', () => {
    const s = setupGame(2);
    const [a, b] = s.players;
    s.phase = 'playing'; s.sub = 'main';
    // walk a simple path of 5 edges
    const path: number[] = [];
    let v = VERTICES.find(x => x.edges.length === 3)!.id;
    const seen = new Set([v]);
    while (path.length < 5) {
      const e = VERTICES[v].edges.find(e => !path.includes(e) && !seen.has(EDGES[e].a === v ? EDGES[e].b : EDGES[e].a))!;
      path.push(e);
      v = EDGES[e].a === v ? EDGES[e].b : EDGES[e].a;
      seen.add(v);
    }
    path.forEach(e => (s.roads[e] = a.id));
    expect(longestRoadLength(s, a.id)).toBe(5);
    const mid = [...seen][2];
    s.buildings[mid] = { owner: b.id, type: 'settlement' };
    expect(longestRoadLength(s, a.id)).toBeLessThan(5);
  });

  it('wins at 10 points', () => {
    const s = setupGame(2);
    playSetup(s);
    const me = s.players[0];
    s.sub = 'main';
    me.dev.push(...Array(8).fill({ type: 'vp', boughtTurn: 0 }));
    me.resources = { ...emptyRes(), wool: 1, grain: 1, ore: 1 };
    s.devDeck.push('knight');
    expect(totalVp(s, me.id)).toBe(10);
    applyAction(s, me.id, { type: 'buyDev' }, 0);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe(me.id);
  });
});

describe('view', () => {
  it('hides other hands and tokens', () => {
    const s = setupGame(3);
    playSetup(s);
    const v = viewFor(s, s.players[0].id, 0);
    expect(v.players[0].resources).toBeDefined();
    expect(v.players[1].resources).toBeUndefined();
    expect(v.players[1].dev).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain(s.players[1].token);
    expect(JSON.stringify(v)).not.toContain(s.players[0].token);
    expect((v as unknown as { devDeck?: unknown }).devDeck).toBeUndefined();
  });
});
