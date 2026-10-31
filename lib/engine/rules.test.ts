import { describe, expect, it } from 'vitest';
import { TOKEN_ORDER, generateBoard, spiralOrder } from './board';
import { awayFor } from './presence';
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
  while (s.sub === 'setupSettlement' || s.sub === 'setupRoad' || s.sub === 'setupPickStart') {
    const pid = s.players[s.current].id;
    if (s.sub === 'setupSettlement') {
      const opts = validSetupSettlements(s);
      applyAction(s, pid, { type: 'placeSettlement', vertex: opts[Math.floor(rng() * opts.length)] }, 0, rng);
    } else if (s.sub === 'setupPickStart') {
      applyAction(s, pid, { type: 'pickStart', vertex: s.lastSetupVertex! }, 0, rng);
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
      const touch = (e: number) => new Set([...VERTICES[EDGES[e].a].hexes, ...VERTICES[EDGES[e].b].hexes]).size;
      for (const p of b.ports) if (p.type !== 'any') expect(touch(p.edge)).toBe(2);
      const generic = b.ports.filter(p => p.type === 'any').map(p => touch(p.edge)).sort();
      expect(generic).toEqual([1, 1, 1, 2]);
      expect(new Set(b.ports.filter(p => p.type !== 'any').map(p => p.type)).size).toBe(5);
    }
  });

  it('lays tokens A..R along a counter-clockwise spiral from an outer corner', () => {
    for (let i = 0; i < 50; i++) {
      const b = generateBoard(seeded(i + 100));
      const starts = [0, 2, 7, 11, 16, 18];
      const match = starts.some(c => {
        const seq = spiralOrder(c).map(id => b.hexes[id].number).filter(n => n !== null);
        return seq.join() === TOKEN_ORDER.join();
      });
      expect(match).toBe(true);
    }
    // Every step of the spiral moves to a neighbouring hex.
    for (const c of [0, 2, 7, 11, 16, 18]) {
      const order = spiralOrder(c);
      expect(new Set(order).size).toBe(19);
      for (let k = 1; k < 19; k++) expect(HEXES[order[k - 1]].neighbors).toContain(order[k]);
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
    while (s.sub === 'setupSettlement' || s.sub === 'setupRoad' || s.sub === 'setupPickStart') {
      const pid = s.players[s.current].id;
      if (s.sub === 'setupPickStart') { applyAction(s, pid, { type: 'pickStart', vertex: s.lastSetupVertex! }, 0); continue; }
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

  it('lets the last player choose which of their two settlements pays the starting cards', () => {
    const s = setupGame(2);
    const [a, b] = s.players.map(p => p.id);
    applyAction(s, a, { type: 'placeSettlement', vertex: 0 }, 0);
    applyAction(s, a, { type: 'placeRoad', edge: VERTICES[0].edges[0] }, 0);
    // b is last: first settlement on a corner touching 3 tiles, second on a far one
    const rich = VERTICES.find(v => v.hexes.length === 3 && validSetupSettlements(s).includes(v.id) && v.hexes.every(h => s.hexes[h].terrain !== 'desert'))!.id;
    applyAction(s, b, { type: 'placeSettlement', vertex: rich }, 0);
    applyAction(s, b, { type: 'placeRoad', edge: VERTICES[rich].edges[0] }, 0);
    const second = validSetupSettlements(s).find(v => VERTICES[v].hexes.length === 1)!;
    applyAction(s, b, { type: 'placeSettlement', vertex: second }, 0);
    expect(s.sub).toBe('setupPickStart');
    expect(resTotal(s.players[1].resources)).toBe(0);
    expect(() => applyAction(s, b, { type: 'pickStart', vertex: 0 }, 0)).toThrow(GameError); // not theirs
    applyAction(s, b, { type: 'pickStart', vertex: rich }, 0);
    expect(resTotal(s.players[1].resources)).toBe(3);
    expect(s.sub).toBe('setupRoad');
    // the road still has to leave the settlement just placed
    expect(() => applyAction(s, b, { type: 'placeRoad', edge: VERTICES[rich].edges[1] }, 0)).toThrow(GameError);
    applyAction(s, b, { type: 'placeRoad', edge: VERTICES[second].edges[0] }, 0);
    expect(s.current).toBe(0);
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
  it('a 7 in the first three rounds is rolled again, the robber stays put', () => {
    const s = setupGame(3);
    playSetup(s);
    const robber = s.robber;
    let i = 0;
    const seven = () => [0.4, 0.6][i++ % 2];
    applyAction(s, s.players[0].id, { type: 'roll' }, 0, seven);
    expect(s.dice![0] + s.dice![1]).toBe(7);
    expect(s.sub).toBe('roll');
    expect(s.current).toBe(0);
    expect(s.robber).toBe(robber);
    s.turnNo = 9; // last turn of round three
    applyAction(s, s.players[0].id, { type: 'roll' }, 0, seven);
    expect(s.sub).toBe('roll');
    s.turnNo = 10; // round four: the 7 counts
    applyAction(s, s.players[0].id, { type: 'roll' }, 0, seven);
    expect(['robber', 'discard']).toContain(s.sub);
  });

  it('tags each message with the player who made the move, and names the robber tile', () => {
    const s = setupGame(3);
    playSetup(s);
    s.turnNo = 10;
    let i = 0;
    const me = s.players[0].id;
    applyAction(s, me, { type: 'roll' }, 0, () => [0.4, 0.6][i++ % 2]);
    const last = s.log[s.log.length - 1];
    expect(last.by).toBe(me);
    expect(s.log.every((l, k) => k === 0 || l.id > s.log[k - 1].id)).toBe(true);
    for (const id of Object.keys(s.discards)) {
      const p = s.players.find(x => x.id === id)!;
      const cards = emptyRes(); let need = s.discards[id];
      for (const k of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) { const n = Math.min(need, p.resources[k]); cards[k] = n; need -= n; }
      applyAction(s, id, { type: 'discard', cards }, 0);
    }
    const hex = HEXES.find(h => h.id !== s.robber && s.hexes[h.id].terrain !== 'desert')!.id;
    applyAction(s, me, { type: 'moveRobber', hex }, 0);
    const msg = s.log.find(l => l.text.includes('שם את השודד'))!;
    expect(msg.text).toContain(String(s.hexes[hex].number));
    expect(msg.by).toBe(me);
  });

  it('robber: thief picks a face-down card, only thief and victim see it until shown', () => {
    const s = setupGame(3);
    playSetup(s);
    s.turnNo = 10;
    const [me, vic, other] = s.players;
    me.resources = emptyRes(); vic.resources = { ...emptyRes(), ore: 2 }; other.resources = emptyRes();
    const hex = HEXES.find(h => h.id !== s.robber && h.vertices.some(v => s.buildings[v]?.owner === vic.id)
      && !h.vertices.some(v => s.buildings[v]?.owner === other.id))!.id;
    s.sub = 'robber'; s.afterRobber = 'main';
    applyAction(s, me.id, { type: 'moveRobber', hex }, 0);
    expect(s.sub).toBe('steal'); // one victim still gets the card picker
    expect(() => applyAction(s, me.id, { type: 'showStolen' }, 0)).toThrow(GameError);
    applyAction(s, me.id, { type: 'steal', target: vic.id, pick: 1 }, 0);
    expect(me.resources.ore).toBe(1);
    expect(s.sub).toBe('main');
    expect(viewFor(s, me.id, 0).stolen!.res).toBe('ore');
    expect(viewFor(s, vic.id, 0).stolen!.res).toBe('ore');
    expect(viewFor(s, other.id, 0).stolen!.res).toBeNull();
    applyAction(s, me.id, { type: 'showStolen' }, 0);
    expect(viewFor(s, other.id, 0).stolen!.res).toBe('ore');
    expect(s.log[s.log.length - 1].text).toContain('ברזל');
  });

  it('only a player who has been out of the game for a minute can be skipped', () => {
    const s = setupGame(3);
    playSetup(s);
    s.turnNo = 10; s.sub = 'main';
    const [stuck, other] = s.players;
    // still in the game (thinking), however long: no skip
    expect(() => applyAction(s, other.id, { type: 'skipTurn', awayMs: 0 }, 0)).toThrow(GameError);
    expect(() => applyAction(s, other.id, { type: 'skipTurn', awayMs: 59_000 }, 0)).toThrow(GameError);
    expect(() => applyAction(s, stuck.id, { type: 'skipTurn', awayMs: 90_000 }, 0)).toThrow(GameError);
    applyAction(s, other.id, { type: 'skipTurn', awayMs: 61_000 }, 5);
    expect(s.current).toBe(1);
    expect(s.sub).toBe('roll');
  });

  it('counts a player as away after switching apps, or when the heartbeat stops', () => {
    expect(awayFor({ seenAt: 1000, awaySince: null }, 30_000)).toBe(0);
    expect(awayFor({ seenAt: 1000, awaySince: 1000 }, 61_000)).toBe(60_000);
    expect(awayFor({ seenAt: 1000, awaySince: null }, 100_000)).toBe(99_000);
    expect(awayFor(undefined, 100_000)).toBe(0);
  });

  it('rolling a 7 forces discards then robber', () => {
    const s = setupGame(3);
    playSetup(s);
    s.turnNo = 10; // past the protected opening rounds
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

  it('a knight waits a turn, progress cards can be played right away, one dev card per turn', () => {
    const s = setupGame(2);
    playSetup(s);
    const me = s.players[0];
    s.sub = 'main';
    me.resources = { ...emptyRes(), wool: 2, grain: 2, ore: 2 };
    s.devDeck.push('knight', 'monopoly'); // monopoly is drawn first
    applyAction(s, me.id, { type: 'buyDev' }, 0);
    applyAction(s, me.id, { type: 'buyDev' }, 0);
    expect(() => applyAction(s, me.id, { type: 'playDev', card: 'knight' }, 0)).toThrow(GameError);
    s.players[1].resources.ore = 3;
    applyAction(s, me.id, { type: 'playDev', card: 'monopoly', res: ['ore'] }, 0);
    expect(me.resources.ore).toBe(3);
    expect(s.players[1].resources.ore).toBe(0);
    me.dev[0].boughtTurn = s.turnNo - 1; // the knight, as if bought last turn
    expect(() => applyAction(s, me.id, { type: 'playDev', card: 'knight' }, 0)).toThrow(GameError); // already played one
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
