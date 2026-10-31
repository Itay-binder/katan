export type Res = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export const RES: Res[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export type Terrain = Res | 'desert';
export type ResMap = Record<Res, number>;

export const COLORS = ['red', 'blue', 'orange', 'green'] as const;
export type Color = (typeof COLORS)[number];

export type DevType = 'knight' | 'vp' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export interface DevCard { type: DevType; boughtTurn: number }
/** House rule: only a knight has to wait a turn; progress cards can be played the turn they were bought. */
export const devReady = (d: DevCard, turnNo: number) => d.type !== 'knight' || d.boughtTurn < turnNo;

export interface Player {
  id: string;
  name: string;
  color: Color;
  token: string;
  resources: ResMap;
  dev: DevCard[];
  knights: number;
}

export type Sub =
  | 'setupSettlement' | 'setupRoad'
  | 'roll' | 'discard' | 'robber' | 'steal'
  | 'main' | 'roadBuilding';

export interface Trade {
  from: string;
  give: ResMap;
  get: ResMap;
  responses: Record<string, 'accept' | 'reject'>;
}

/** `by`: the player whose move produced the message (null = nobody in particular). */
export interface LogEntry { id: number; t: number; text: string; by?: string | null }

export interface GameState {
  id: string;
  createdAt: number;
  hostId: string;
  turnSeconds: number | null;
  phase: 'lobby' | 'playing' | 'ended';
  players: Player[];
  hexes: { terrain: Terrain; number: number | null }[];
  ports: { edge: number; type: Res | 'any' }[];
  robber: number;
  buildings: Record<string, { owner: string; type: 'settlement' | 'city' }>;
  roads: Record<string, string>;
  current: number;
  turnNo: number;
  sub: Sub;
  dice: [number, number] | null;
  setupStep: number;
  lastSetupVertex: number | null;
  devPlayed: boolean;
  freeRoads: number;
  afterRobber: Sub;
  discards: Record<string, number>;
  stealFrom: string[];
  trade: Trade | null;
  bank: ResMap;
  devDeck: DevType[];
  longestRoad: string | null;
  largestArmy: string | null;
  deadline: number | null;
  winner: string | null;
  log: LogEntry[];
}

export type Action =
  | { type: 'setColor'; color: Color }
  | { type: 'start' }
  | { type: 'placeSettlement'; vertex: number }
  | { type: 'placeRoad'; edge: number }
  | { type: 'roll' }
  | { type: 'discard'; cards: ResMap }
  | { type: 'moveRobber'; hex: number }
  | { type: 'steal'; target: string }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'buyDev' }
  | { type: 'playDev'; card: 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'; res?: Res[] }
  | { type: 'bankTrade'; give: Res; get: Res }
  | { type: 'offerTrade'; give: ResMap; get: ResMap }
  | { type: 'respondTrade'; accept: boolean }
  | { type: 'confirmTrade'; with: string }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' }
  | { type: 'timeout' };

/** Player as seen by another player: hand contents hidden, only counts. */
export interface PublicPlayer {
  id: string;
  name: string;
  color: Color;
  knights: number;
  resCount: number;
  devCount: number;
  resources?: ResMap;
  dev?: DevCard[];
  publicVp: number;
}

export interface GameView extends Omit<GameState, 'players' | 'devDeck'> {
  players: PublicPlayer[];
  devDeckCount: number;
  you: string | null;
  now: number;
}

export class GameError extends Error {}

export const COST: Record<'road' | 'settlement' | 'city' | 'dev', Partial<ResMap>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};

export const PIECES = { road: 15, settlement: 5, city: 4 };

export const RES_HE: Record<Res, string> = {
  brick: 'לבנים', lumber: 'עצים', wool: 'צמר', grain: 'חיטה', ore: 'ברזל',
};

export const DEV_HE: Record<DevType, string> = {
  knight: 'אביר', vp: 'נקודת ניצחון', roadBuilding: 'בניית דרכים',
  yearOfPlenty: 'שנת שפע', monopoly: 'מונופול',
};

export const emptyRes = (): ResMap => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
export const resTotal = (r: ResMap) => RES.reduce((s, k) => s + (r[k] || 0), 0);
