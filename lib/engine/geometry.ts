// Static board geometry: 19 pointy-top hexes (radius 2), their corners (vertices) and sides (edges).
// Ids are stable for every game, so state only stores what sits on them.

export interface HexGeo { id: number; q: number; r: number; x: number; y: number; vertices: number[]; edges: number[]; neighbors: number[] }
export interface VertexGeo { id: number; x: number; y: number; hexes: number[]; vertices: number[]; edges: number[] }
export interface EdgeGeo { id: number; a: number; b: number; x: number; y: number; hexes: number[] }

const SQ3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function build() {
  const coords: { q: number; r: number }[] = [];
  for (let r = -2; r <= 2; r++)
    for (let q = -2; q <= 2; q++)
      if (Math.abs(q + r) <= 2) coords.push({ q, r });

  const vertices: VertexGeo[] = [];
  const vKey = new Map<string, number>();
  const edges: EdgeGeo[] = [];
  const eKey = new Map<string, number>();

  const hexes: HexGeo[] = coords.map(({ q, r }, id) => {
    const x = SQ3 * (q + r / 2);
    const y = 1.5 * r;
    const vs: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 90);
      const vx = x + Math.cos(ang);
      const vy = y + Math.sin(ang);
      const k = `${Math.round(vx * 1000)},${Math.round(vy * 1000)}`;
      let v = vKey.get(k);
      if (v === undefined) {
        v = vertices.length;
        vKey.set(k, v);
        vertices.push({ id: v, x: vx, y: vy, hexes: [], vertices: [], edges: [] });
      }
      vertices[v].hexes.push(id);
      vs.push(v);
    }
    const es: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = vs[i], b = vs[(i + 1) % 6];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = eKey.get(k);
      if (e === undefined) {
        e = edges.length;
        eKey.set(k, e);
        edges.push({
          id: e, a: Math.min(a, b), b: Math.max(a, b),
          x: (vertices[a].x + vertices[b].x) / 2, y: (vertices[a].y + vertices[b].y) / 2, hexes: [],
        });
        vertices[a].edges.push(e);
        vertices[b].edges.push(e);
        vertices[a].vertices.push(b);
        vertices[b].vertices.push(a);
      }
      edges[e].hexes.push(id);
      es.push(e);
    }
    return { id, q, r, x, y, vertices: vs, edges: es, neighbors: [] };
  });

  for (const h of hexes)
    h.neighbors = DIRS.map(([dq, dr]) => hexes.findIndex(o => o.q === h.q + dq && o.r === h.r + dr)).filter(i => i >= 0);

  // Coastal edges ordered around the island, used for port placement.
  const coast = edges.filter(e => e.hexes.length === 1)
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map(e => e.id);

  return { hexes, vertices, edges, coast };
}

export const GEO = build();
export const HEXES = GEO.hexes;
export const VERTICES = GEO.vertices;
export const EDGES = GEO.edges;
export const COAST = GEO.coast;
