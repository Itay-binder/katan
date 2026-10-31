import { generateBoard, shuffle, type Rng } from './board';
import { EDGES, HEXES, VERTICES } from './geometry';
import {
  canAfford, canBuildCity, canBuildRoad, canBuildSettlement, canPlaceSetupRoad, canPlaceSetupSettlement,
  longestRoadLength, piecesLeft, publicVp, robbableOn, tradeRatios, validRoads, validSetupRoads,
  validSetupSettlements,
} from './queries';
import {
  COLORS, COST, DEV_HE, GameError, RES, RES_HE, emptyRes, resTotal,
  type Action, type Color, type DevType, type GameState, type GameView, type Player, type Res, type ResMap,
} from './types';

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const WIN_VP = 10;
/** House rule: a 7 in the first rounds is rolled again; the robber only wakes up afterwards. */
export const SAFE_ROUNDS = 3;
const LOG_KEEP = 60;

const randId = (rng: Rng, n = 10) => {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[Math.floor(rng() * abc.length)];
  return s;
};

export function newRoomId(rng: Rng = Math.random) { return randId(rng, 8); }

export function createGame(id: string, turnSeconds: number | null, now: number, rng: Rng = Math.random): GameState {
  const devDeck: DevType[] = shuffle([
    ...Array(14).fill('knight'), ...Array(5).fill('vp'),
    ...Array(2).fill('roadBuilding'), ...Array(2).fill('yearOfPlenty'), ...Array(2).fill('monopoly'),
  ], rng);
  return {
    id, createdAt: now, hostId: '', turnSeconds,
    phase: 'lobby', players: [],
    ...generateBoard(rng),
    buildings: {}, roads: {},
    current: 0, turnNo: 0, sub: 'setupSettlement', dice: null,
    setupStep: 0, lastSetupVertex: null,
    devPlayed: false, freeRoads: 0, afterRobber: 'main',
    discards: {}, stealFrom: [], trade: null,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
    devDeck,
    longestRoad: null, largestArmy: null,
    deadline: null, winner: null, log: [],
  };
}

/** Adds a player in the lobby. Returns the new player (with its secret token). */
export function joinGame(s: GameState, name: string, rng: Rng = Math.random): Player {
  if (s.phase !== 'lobby') throw new GameError('המשחק כבר התחיל');
  if (s.players.length >= MAX_PLAYERS) throw new GameError('החדר מלא');
  const clean = name.trim().slice(0, 16);
  if (!clean) throw new GameError('צריך שם');
  const color = COLORS.find(c => !s.players.some(p => p.color === c)) as Color;
  const p: Player = {
    id: randId(rng, 8), name: clean, color, token: randId(rng, 24),
    resources: emptyRes(), dev: [], knights: 0,
  };
  s.players.push(p);
  if (!s.hostId) s.hostId = p.id;
  log(s, `${clean} הצטרף`);
  return p;
}

// ---------- helpers ----------

function log(s: GameState, text: string) {
  s.log.push({ t: Date.now(), text });
  if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
}

const player = (s: GameState, id: string) => {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new GameError('שחקן לא קיים');
  return p;
};
const cur = (s: GameState) => s.players[s.current];
const fmt = (r: Partial<ResMap>) =>
  RES.filter(k => r[k]).map(k => `${r[k]} ${RES_HE[k]}`).join(', ');

function pay(s: GameState, p: Player, cost: Partial<ResMap>) {
  if (!canAfford(p.resources, cost)) throw new GameError('אין מספיק משאבים');
  for (const k of RES) { const n = cost[k] || 0; p.resources[k] -= n; s.bank[k] += n; }
}

function give(s: GameState, p: Player, r: Res, n: number) {
  const take = Math.min(n, s.bank[r]);
  s.bank[r] -= take; p.resources[r] += take;
  return take;
}

function validResMap(m: unknown): m is ResMap {
  if (!m || typeof m !== 'object') return false;
  return RES.every(k => Number.isInteger((m as ResMap)[k]) && (m as ResMap)[k] >= 0);
}

function setDeadline(s: GameState, now: number) {
  s.deadline = s.turnSeconds ? now + s.turnSeconds * 1000 : null;
}

export function totalVp(s: GameState, pid: string) {
  const p = player(s, pid);
  return publicVp(s, pid) + p.dev.filter(d => d.type === 'vp').length;
}

function updateLongestRoad(s: GameState) {
  const lens = Object.fromEntries(s.players.map(p => [p.id, longestRoadLength(s, p.id)]));
  const max = Math.max(...Object.values(lens));
  const prev = s.longestRoad;
  let next: string | null;
  if (max < 5) next = null;
  else if (prev && lens[prev] === max) next = prev;
  else {
    const top = s.players.filter(p => lens[p.id] === max);
    next = top.length === 1 ? top[0].id : null;
  }
  if (next !== prev) {
    s.longestRoad = next;
    if (next) log(s, `${player(s, next).name} לקח את הדרך הארוכה (${max})`);
    else if (prev) log(s, 'הדרך הארוכה חזרה לשולחן');
  }
}

function updateLargestArmy(s: GameState, p: Player) {
  const holder = s.largestArmy ? player(s, s.largestArmy) : null;
  if (p.knights >= 3 && (!holder || (holder.id !== p.id && p.knights > holder.knights))) {
    s.largestArmy = p.id;
    log(s, `${p.name} לקח את הצבא הגדול (${p.knights})`);
  }
}

function checkWin(s: GameState) {
  if (s.phase !== 'playing') return;
  const p = cur(s);
  if (totalVp(s, p.id) >= WIN_VP) {
    s.phase = 'ended'; s.winner = p.id; s.deadline = null; s.trade = null;
    log(s, `${p.name} ניצח עם ${totalVp(s, p.id)} נקודות!`);
  }
}

function distribute(s: GameState, roll: number) {
  // Count demand per resource; if the bank can't cover it and more than one player wants it, nobody gets it.
  const want: Record<Res, Map<string, number>> = { brick: new Map(), lumber: new Map(), wool: new Map(), grain: new Map(), ore: new Map() };
  HEXES.forEach(h => {
    const hx = s.hexes[h.id];
    if (hx.number !== roll || h.id === s.robber || hx.terrain === 'desert') return;
    for (const v of h.vertices) {
      const b = s.buildings[v];
      if (!b) continue;
      const m = want[hx.terrain];
      m.set(b.owner, (m.get(b.owner) || 0) + (b.type === 'city' ? 2 : 1));
    }
  });
  const got: Record<string, Partial<ResMap>> = {};
  for (const r of RES) {
    const m = want[r];
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    if (total > s.bank[r] && m.size > 1) { log(s, `אין מספיק ${RES_HE[r]} בבנק, אף אחד לא מקבל`); continue; }
    for (const [pid, n] of m) {
      const t = give(s, player(s, pid), r, n);
      if (t) (got[pid] ||= {})[r] = t;
    }
  }
  for (const [pid, r] of Object.entries(got)) log(s, `${player(s, pid).name} קיבל ${fmt(r)}`);
}

function startTurn(s: GameState, idx: number, now: number) {
  s.current = idx; s.turnNo++; s.sub = 'roll'; s.dice = null;
  s.devPlayed = false; s.freeRoads = 0; s.trade = null;
  setDeadline(s, now);
}

function afterRobberMoved(s: GameState, rng: Rng) {
  const me = cur(s);
  const victims = robbableOn(s, s.robber, me.id).filter(id => resTotal(player(s, id).resources) > 0);
  if (victims.length === 0) { s.sub = s.afterRobber; return; }
  if (victims.length === 1) { steal(s, victims[0], rng); return; }
  s.stealFrom = victims; s.sub = 'steal';
}

function steal(s: GameState, targetId: string, rng: Rng) {
  const me = cur(s), t = player(s, targetId);
  const pool = RES.flatMap(k => Array(t.resources[k]).fill(k) as Res[]);
  if (pool.length) {
    const r = pool[Math.floor(rng() * pool.length)];
    t.resources[r]--; me.resources[r]++;
    log(s, `${me.name} גנב קלף מ${t.name}`);
  }
  s.stealFrom = []; s.sub = s.afterRobber;
}

function requireTurn(s: GameState, pid: string, ...subs: GameState['sub'][]) {
  if (s.phase !== 'playing') throw new GameError('המשחק לא פעיל');
  if (cur(s).id !== pid) throw new GameError('זה לא התור שלך');
  if (subs.length && !subs.includes(s.sub)) throw new GameError('אי אפשר לעשות את זה עכשיו');
}

// ---------- main reducer ----------

/** Applies an action in place. Throws GameError when illegal. */
export function applyAction(s: GameState, pid: string, a: Action, now: number, rng: Rng = Math.random): void {
  switch (a.type) {
    case 'setColor': {
      if (s.phase !== 'lobby') throw new GameError('המשחק כבר התחיל');
      if (!COLORS.includes(a.color)) throw new GameError('צבע לא קיים');
      const p = player(s, pid);
      if (s.players.some(o => o.id !== pid && o.color === a.color)) throw new GameError('הצבע תפוס');
      p.color = a.color;
      return;
    }
    case 'start': {
      if (s.phase !== 'lobby') throw new GameError('המשחק כבר התחיל');
      if (pid !== s.hostId) throw new GameError('רק מי שפתח את החדר יכול להתחיל');
      if (s.players.length < MIN_PLAYERS) throw new GameError(`צריך לפחות ${MIN_PLAYERS} שחקנים`);
      s.players = shuffle(s.players, rng);
      s.phase = 'playing'; s.setupStep = 0; s.current = 0; s.sub = 'setupSettlement';
      setDeadline(s, now);
      log(s, `המשחק התחיל. סדר: ${s.players.map(p => p.name).join(', ')}`);
      return;
    }
    case 'placeSettlement': {
      requireTurn(s, pid, 'setupSettlement');
      if (!canPlaceSetupSettlement(s, a.vertex) || !VERTICES[a.vertex]) throw new GameError('אי אפשר לבנות כאן');
      const p = cur(s);
      s.buildings[a.vertex] = { owner: p.id, type: 'settlement' };
      s.lastSetupVertex = a.vertex;
      if (s.setupStep >= s.players.length) {
        const got: Partial<ResMap> = {};
        for (const h of VERTICES[a.vertex].hexes) {
          const t = s.hexes[h].terrain;
          if (t !== 'desert' && give(s, p, t, 1)) got[t] = (got[t] || 0) + 1;
        }
        if (Object.keys(got).length) log(s, `${p.name} קיבל ${fmt(got)}`);
      }
      s.sub = 'setupRoad';
      return;
    }
    case 'placeRoad': {
      requireTurn(s, pid, 'setupRoad');
      if (!EDGES[a.edge] || !canPlaceSetupRoad(s, a.edge, s.lastSetupVertex)) throw new GameError('הדרך חייבת לצאת מהיישוב החדש');
      s.roads[a.edge] = pid;
      s.setupStep++;
      const n = s.players.length;
      if (s.setupStep >= 2 * n) {
        s.turnNo = 0;
        startTurn(s, 0, now);
        log(s, 'שלב הפתיחה הסתיים');
      } else {
        s.current = s.setupStep < n ? s.setupStep : 2 * n - 1 - s.setupStep;
        s.sub = 'setupSettlement';
        setDeadline(s, now);
      }
      return;
    }
    case 'roll': {
      requireTurn(s, pid, 'roll');
      const d: [number, number] = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
      s.dice = d;
      const sum = d[0] + d[1];
      log(s, `${cur(s).name} הטיל ${sum}`);
      if (sum === 7 && s.turnNo <= SAFE_ROUNDS * s.players.length) {
        log(s, `בשלושת הסבבים הראשונים 7 לא נחשב, מטילים שוב`);
        return;
      }
      if (sum === 7) {
        s.discards = {};
        for (const p of s.players) {
          const t = resTotal(p.resources);
          if (t > 7) s.discards[p.id] = Math.floor(t / 2);
        }
        s.afterRobber = 'main';
        s.sub = Object.keys(s.discards).length ? 'discard' : 'robber';
      } else {
        distribute(s, sum);
        s.sub = 'main';
      }
      return;
    }
    case 'discard': {
      if (s.phase !== 'playing' || s.sub !== 'discard') throw new GameError('אין צורך לזרוק עכשיו');
      const need = s.discards[pid];
      if (!need) throw new GameError('אתה לא צריך לזרוק');
      if (!validResMap(a.cards) || resTotal(a.cards) !== need) throw new GameError(`צריך לזרוק בדיוק ${need} קלפים`);
      const p = player(s, pid);
      pay(s, p, a.cards);
      delete s.discards[pid];
      log(s, `${p.name} זרק ${need} קלפים`);
      if (!Object.keys(s.discards).length) s.sub = 'robber';
      return;
    }
    case 'moveRobber': {
      requireTurn(s, pid, 'robber');
      if (!HEXES[a.hex] || a.hex === s.robber) throw new GameError('צריך להזיז את השודד למשבצת אחרת');
      s.robber = a.hex;
      log(s, `${cur(s).name} הזיז את השודד`);
      afterRobberMoved(s, rng);
      return;
    }
    case 'steal': {
      requireTurn(s, pid, 'steal');
      if (!s.stealFrom.includes(a.target)) throw new GameError('אי אפשר לגנוב מהשחקן הזה');
      steal(s, a.target, rng);
      return;
    }
    case 'buildRoad': {
      requireTurn(s, pid, 'main', 'roadBuilding');
      const p = cur(s);
      if (!EDGES[a.edge] || !canBuildRoad(s, pid, a.edge)) throw new GameError('אי אפשר לבנות דרך כאן');
      if (piecesLeft(s, pid).road <= 0) throw new GameError('נגמרו לך הדרכים');
      const free = s.sub === 'roadBuilding';
      if (!free) pay(s, p, COST.road);
      s.roads[a.edge] = pid;
      if (free) {
        s.freeRoads--;
        if (s.freeRoads <= 0 || !validRoads(s, pid).length || piecesLeft(s, pid).road <= 0) s.sub = 'main';
      }
      log(s, `${p.name} בנה דרך`);
      updateLongestRoad(s);
      checkWin(s);
      return;
    }
    case 'buildSettlement': {
      requireTurn(s, pid, 'main');
      const p = cur(s);
      if (!VERTICES[a.vertex] || !canBuildSettlement(s, pid, a.vertex)) throw new GameError('אי אפשר לבנות יישוב כאן');
      if (piecesLeft(s, pid).settlement <= 0) throw new GameError('נגמרו לך היישובים');
      pay(s, p, COST.settlement);
      s.buildings[a.vertex] = { owner: pid, type: 'settlement' };
      log(s, `${p.name} בנה יישוב`);
      updateLongestRoad(s); // a settlement can cut an opponent's road
      checkWin(s);
      return;
    }
    case 'buildCity': {
      requireTurn(s, pid, 'main');
      const p = cur(s);
      if (!VERTICES[a.vertex] || !canBuildCity(s, pid, a.vertex)) throw new GameError('עיר נבנית רק על יישוב שלך');
      if (piecesLeft(s, pid).city <= 0) throw new GameError('נגמרו לך הערים');
      pay(s, p, COST.city);
      s.buildings[a.vertex] = { owner: pid, type: 'city' };
      log(s, `${p.name} בנה עיר`);
      checkWin(s);
      return;
    }
    case 'buyDev': {
      requireTurn(s, pid, 'main');
      if (!s.devDeck.length) throw new GameError('נגמרו קלפי הפיתוח');
      const p = cur(s);
      pay(s, p, COST.dev);
      const card = s.devDeck.pop() as DevType;
      p.dev.push({ type: card, boughtTurn: s.turnNo });
      log(s, `${p.name} קנה קלף פיתוח`);
      checkWin(s);
      return;
    }
    case 'playDev': {
      const allowed = a.card === 'knight' ? (['roll', 'main'] as const) : (['main'] as const);
      requireTurn(s, pid, ...allowed);
      if (s.devPlayed) throw new GameError('כבר שיחקת קלף פיתוח בתור הזה');
      const p = cur(s);
      const idx = p.dev.findIndex(d => d.type === a.card && d.boughtTurn < s.turnNo);
      if (idx < 0) throw new GameError('אין לך קלף כזה שאפשר לשחק עכשיו');
      if (a.card === 'yearOfPlenty') {
        const rs = a.res || [];
        if (rs.length !== 2 || !rs.every(r => RES.includes(r))) throw new GameError('בחר 2 משאבים');
        const need: Partial<ResMap> = {};
        rs.forEach(r => { need[r] = (need[r] || 0) + 1; });
        if (!RES.every(k => s.bank[k] >= (need[k] || 0))) throw new GameError('אין מספיק בבנק');
      }
      if (a.card === 'monopoly' && (!a.res || !RES.includes(a.res[0]))) throw new GameError('בחר משאב');
      p.dev.splice(idx, 1);
      s.devPlayed = true;
      log(s, `${p.name} שיחק ${DEV_HE[a.card]}`);
      if (a.card === 'knight') {
        p.knights++;
        updateLargestArmy(s, p);
        s.afterRobber = s.sub;
        s.sub = 'robber';
      } else if (a.card === 'roadBuilding') {
        s.freeRoads = Math.min(2, piecesLeft(s, pid).road);
        if (s.freeRoads > 0 && validRoads(s, pid).length) s.sub = 'roadBuilding';
      } else if (a.card === 'yearOfPlenty') {
        for (const r of a.res!) give(s, p, r, 1);
      } else if (a.card === 'monopoly') {
        const r = a.res![0];
        let n = 0;
        for (const o of s.players) if (o.id !== p.id) { n += o.resources[r]; o.resources[r] = 0; }
        p.resources[r] += n;
        log(s, `${p.name} לקח ${n} ${RES_HE[r]}`);
      }
      checkWin(s);
      return;
    }
    case 'bankTrade': {
      requireTurn(s, pid, 'main');
      if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) throw new GameError('עסקה לא תקינה');
      const p = cur(s);
      const ratio = tradeRatios(s, pid)[a.give];
      if (s.bank[a.get] < 1) throw new GameError('אין בבנק');
      pay(s, p, { [a.give]: ratio });
      give(s, p, a.get, 1);
      log(s, `${p.name} החליף ${ratio} ${RES_HE[a.give]} ב־1 ${RES_HE[a.get]} עם הבנק`);
      return;
    }
    case 'offerTrade': {
      requireTurn(s, pid, 'main');
      if (!validResMap(a.give) || !validResMap(a.get) || !resTotal(a.give) || !resTotal(a.get)) throw new GameError('עסקה לא תקינה');
      if (RES.some(k => a.give[k] && a.get[k])) throw new GameError('אי אפשר לתת ולבקש אותו משאב');
      if (!canAfford(cur(s).resources, a.give)) throw new GameError('אין לך את מה שאתה מציע');
      s.trade = { from: pid, give: a.give, get: a.get, responses: {} };
      log(s, `${cur(s).name} מציע ${fmt(a.give)} תמורת ${fmt(a.get)}`);
      return;
    }
    case 'respondTrade': {
      if (!s.trade || s.phase !== 'playing') throw new GameError('אין הצעה פתוחה');
      if (pid === s.trade.from) throw new GameError('זו ההצעה שלך');
      if (a.accept && !canAfford(player(s, pid).resources, s.trade.get)) throw new GameError('אין לך את מה שמבקשים');
      s.trade.responses[pid] = a.accept ? 'accept' : 'reject';
      return;
    }
    case 'confirmTrade': {
      requireTurn(s, pid, 'main');
      const t = s.trade;
      if (!t || t.responses[a.with] !== 'accept') throw new GameError('השחקן לא הסכים');
      const me = cur(s), them = player(s, a.with);
      if (!canAfford(me.resources, t.give) || !canAfford(them.resources, t.get)) throw new GameError('למישהו כבר אין את הקלפים');
      for (const k of RES) {
        me.resources[k] += t.get[k] - t.give[k];
        them.resources[k] += t.give[k] - t.get[k];
      }
      s.trade = null;
      log(s, `${me.name} ו${them.name} סגרו עסקה`);
      return;
    }
    case 'cancelTrade': {
      requireTurn(s, pid);
      s.trade = null;
      return;
    }
    case 'endTurn': {
      requireTurn(s, pid, 'main', 'roadBuilding');
      startTurn(s, (s.current + 1) % s.players.length, now);
      return;
    }
    case 'timeout': {
      if (s.phase !== 'playing' || !s.deadline || now < s.deadline) throw new GameError('הזמן עוד לא נגמר');
      resolveTimeout(s, now, rng);
      return;
    }
    default:
      throw new GameError('פעולה לא מוכרת');
  }
}

/** When the turn clock runs out: finish whatever is pending with random legal choices and pass the turn. */
function resolveTimeout(s: GameState, now: number, rng: Rng) {
  const who = cur(s);
  log(s, `הזמן של ${who.name} נגמר`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const startStep = s.setupStep;
  const startTurnNo = s.turnNo;
  for (let guard = 0; guard < 20; guard++) {
    if (s.phase !== 'playing') return;
    const pid = cur(s).id;
    switch (s.sub) {
      case 'setupSettlement':
        applyAction(s, pid, { type: 'placeSettlement', vertex: pick(validSetupSettlements(s)) }, now, rng); break;
      case 'setupRoad':
        applyAction(s, pid, { type: 'placeRoad', edge: pick(validSetupRoads(s, s.lastSetupVertex)) }, now, rng); break;
      case 'roll':
        applyAction(s, pid, { type: 'roll' }, now, rng); break;
      case 'discard':
        for (const [id, n] of Object.entries(s.discards)) {
          const p = player(s, id);
          const pool = shuffle(RES.flatMap(k => Array(p.resources[k]).fill(k) as Res[]), rng).slice(0, n);
          const cards = emptyRes();
          pool.forEach(r => cards[r]++);
          applyAction(s, id, { type: 'discard', cards }, now, rng);
        }
        break;
      case 'robber':
        applyAction(s, pid, { type: 'moveRobber', hex: pick(HEXES.filter(h => h.id !== s.robber).map(h => h.id)) }, now, rng); break;
      case 'steal':
        applyAction(s, pid, { type: 'steal', target: pick(s.stealFrom) }, now, rng); break;
      case 'main':
      case 'roadBuilding':
        applyAction(s, pid, { type: 'endTurn' }, now, rng); break;
    }
    const advanced = s.setupStep !== startStep || s.turnNo !== startTurnNo;
    if (advanced && (s.sub === 'setupSettlement' || s.sub === 'roll')) return;
  }
}

/** What a given player is allowed to see. */
export function viewFor(s: GameState, you: string | null, now: number): GameView {
  const { devDeck, players, ...rest } = s;
  return {
    ...structuredClone(rest),
    devDeckCount: devDeck.length,
    you,
    now,
    players: players.map(p => ({
      id: p.id, name: p.name, color: p.color, knights: p.knights,
      resCount: resTotal(p.resources), devCount: p.dev.length,
      publicVp: publicVp(s, p.id) + (s.phase === 'ended' || p.id === you ? p.dev.filter(d => d.type === 'vp').length : 0),
      ...(p.id === you ? { resources: { ...p.resources }, dev: p.dev.map(d => ({ ...d })) } : {}),
    })),
  };
}

export function playerByToken(s: GameState, token: string | null | undefined) {
  if (!token) return null;
  return s.players.find(p => p.token === token) ?? null;
}
