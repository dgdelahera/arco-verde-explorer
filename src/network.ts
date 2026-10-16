import { haversineMeters, lines, SNAP_M, type Position } from './geo.ts'

export const JOIN_M = 20
const CELL_M = 200

export type Leg = { path: Position[]; m: number }
export type Network = {
  nodes: Position[]
  edges: number
  components: number[]
  leg: (a: Position, b: Position) => Leg | null
  route: (points: Position[]) => Position[] | null
}
type Seg = { a: number; b: number; part: number; at: number; len: number; splits: { t: number; n: number }[] }

/**
 * Routable graph over every track part. The official tracks rarely share vertices where they meet, so parts are
 * joined where they cross and wherever a vertex lies within `joinM` of another part (or of a far stretch of its own,
 * which closes loops).
 */
export function buildNetwork(tracks: GeoJSON.Geometry[], joinM = JOIN_M): Network {
  const parts = tracks.flatMap(lines).filter((l) => l.length > 1)
  const nodes: Position[] = []
  const ids = new Map<string, number>()
  const node = (p: Position) => {
    const k = `${p[0]},${p[1]}`
    let i = ids.get(k)
    if (i === undefined) ids.set(k, (i = nodes.push([p[0], p[1]]) - 1))
    return i
  }
  const lat0 = parts[0]?.[0][1] ?? 0
  const ky = (6371008.8 * Math.PI) / 180
  const kx = ky * Math.cos((lat0 * Math.PI) / 180)
  const xy = (p: Position) => [p[0] * kx, p[1] * ky]
  const lerp = (a: number, b: number, t: number): Position => [nodes[a][0] + t * (nodes[b][0] - nodes[a][0]), nodes[a][1] + t * (nodes[b][1] - nodes[a][1])]

  const segs: Seg[] = []
  const occurrences: { n: number; part: number; at: number }[] = []
  for (const [part, line] of parts.entries()) {
    let at = 0
    occurrences.push({ n: node(line[0]), part, at })
    for (let i = 1; i < line.length; i++) {
      const a = node(line[i - 1]), b = node(line[i])
      const len = haversineMeters(line[i - 1], line[i])
      if (a !== b) segs.push({ a, b, part, at, len, splits: [] })
      at += len
      occurrences.push({ n: b, part, at })
    }
  }

  const grid = new Map<string, number[]>()
  const cellsOf = (x0: number, y0: number, x1: number, y1: number) => {
    const keys: string[] = []
    for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
      for (let cy = Math.floor(y0 / CELL_M); cy <= Math.floor(y1 / CELL_M); cy++) keys.push(`${cx},${cy}`)
    return keys
  }
  const segCells = segs.map((s) => {
    const [ax, ay] = xy(nodes[s.a]), [bx, by] = xy(nodes[s.b])
    return cellsOf(Math.min(ax, bx) - joinM, Math.min(ay, by) - joinM, Math.max(ax, bx) + joinM, Math.max(ay, by) + joinM)
  })
  segCells.forEach((keys, i) => { for (const k of keys) { let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i) } })

  for (const [i, s] of segs.entries()) {
    const [ax, ay] = xy(nodes[s.a]), [bx, by] = xy(nodes[s.b])
    const seen = new Set<number>()
    for (const k of segCells[i])
      for (const j of grid.get(k)!) {
        if (j <= i || seen.has(j)) continue
        seen.add(j)
        const o = segs[j]
        if (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b) continue
        const [cx, cy] = xy(nodes[o.a]), [dx, dy] = xy(nodes[o.b])
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
        if (!den) continue
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den
        if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue
        const n = nodes.push(lerp(s.a, s.b, t)) - 1
        s.splits.push({ t, n })
        o.splits.push({ t: u, n })
      }
  }

  const links: [number, number][] = []
  for (const v of occurrences) {
    const [px, py] = xy(nodes[v.n])
    const best = new Map<number, { s: Seg; t: number; d: number }>()
    for (const j of grid.get(cellsOf(px, py, px, py)[0]) ?? []) {
      const s = segs[j]
      if (s.a === v.n || s.b === v.n) continue
      const [ax, ay] = xy(nodes[s.a]), [bx, by] = xy(nodes[s.b])
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2))
      const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py)
      if (d > joinM || (s.part === v.part && Math.abs(s.at + t * s.len - v.at) < 4 * joinM)) continue
      const key = s.part === v.part ? -1 : s.part
      if (d < (best.get(key)?.d ?? Infinity)) best.set(key, { s, t, d })
    }
    for (const { s, t } of best.values()) {
      if (t === 0 || t === 1) { links.push([v.n, t ? s.b : s.a]); continue }
      const n = nodes.push(lerp(s.a, s.b, t)) - 1
      s.splits.push({ t, n })
      links.push([v.n, n])
    }
  }

  const pieces: [number, number][] = []
  for (const s of segs) {
    const chain = [s.a, ...s.splits.sort((p, q) => p.t - q.t).map((p) => p.n), s.b]
    for (let i = 1; i < chain.length; i++) pieces.push([chain[i - 1], chain[i]])
  }
  const adj: number[][] = nodes.map(() => [])
  const w = (a: number, b: number) => haversineMeters(nodes[a], nodes[b])
  for (const [a, b] of [...pieces, ...links]) { const m = w(a, b); adj[a].push(b, m); adj[b].push(a, m) }

  const comp = new Int32Array(nodes.length).fill(-1)
  const components: number[] = []
  for (let i = 0; i < nodes.length; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue
    const stack = [i]
    comp[i] = components.length
    let size = 0
    while (stack.length) {
      const n = stack.pop()!
      size++
      for (let k = 0; k < adj[n].length; k += 2) if (comp[adj[n][k]] < 0) { comp[adj[n][k]] = components.length; stack.push(adj[n][k]) }
    }
    components.push(size)
  }

  const pieceXy = pieces.map(([a, b]) => [...xy(nodes[a]), ...xy(nodes[b])])
  const snap = (p: Position) => {
    const [px, py] = xy(p)
    let best = { i: -1, t: 0, d: SNAP_M }
    for (const [i, [ax, ay, bx, by]] of pieceXy.entries()) {
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0
      const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py)
      if (d <= best.d) best = { i, t, d }
    }
    if (best.i < 0) return null
    return { i: best.i, at: lerp(...pieces[best.i], best.t) }
  }

  function shortest(from: Position, to: Position): Leg | null {
    const s = snap(from), e = snap(to)
    if (!s || !e) return null
    const dist = new Float64Array(nodes.length).fill(Infinity)
    const prev = new Int32Array(nodes.length).fill(-1)
    const heap: [number, number][] = []
    const push = (x: [number, number]) => {
      let i = heap.push(x) - 1
      while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= x[0]) break; heap[i] = heap[p]; i = p }
      heap[i] = x
    }
    const pop = () => {
      const top = heap[0], last = heap.pop()!
      if (heap.length) {
        let i = 0
        for (let c = 1; c < heap.length; i = c, c = 2 * i + 1) {
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++
          if (heap[c][0] >= last[0]) break
          heap[i] = heap[c]
        }
        heap[i] = last
      }
      return top
    }
    for (const n of pieces[s.i]) { const d = haversineMeters(s.at, nodes[n]); if (d < dist[n]) { dist[n] = d; push([d, n]) } }
    const goal = new Map(pieces[e.i].map((n) => [n, haversineMeters(nodes[n], e.at)]))
    let best = s.i === e.i ? haversineMeters(s.at, e.at) : Infinity
    let end = -1
    while (heap.length) {
      const [d, n] = pop()
      if (d >= best) break
      if (d > dist[n]) continue
      const g = goal.get(n)
      if (g !== undefined && d + g < best) { best = d + g; end = n }
      for (let k = 0; k < adj[n].length; k += 2) {
        const m = adj[n][k], dm = d + adj[n][k + 1]
        if (dm < dist[m]) { dist[m] = dm; prev[m] = n; push([dm, m]) }
      }
    }
    if (best === Infinity) return null
    const path: Position[] = [e.at]
    for (let n = end; n >= 0; n = prev[n]) path.push(nodes[n])
    path.push(s.at)
    return { path: path.reverse().filter((q, i, a) => !i || `${q}` !== `${a[i - 1]}`), m: best }
  }

  const cache = new Map<string, Leg | null>()
  const leg = (a: Position, b: Position) => {
    const k = `${a}|${b}`
    if (!cache.has(k)) cache.set(k, shortest(a, b))
    return cache.get(k)!
  }
  const route = (points: Position[]) => {
    if (points.length === 1) return snap(points[0]) ? [points[0]] : null
    const path: Position[] = []
    for (let i = 1; i < points.length; i++) {
      const l = leg(points[i - 1], points[i])
      if (!l) return null
      for (const q of l.path) if (`${q}` !== `${path.at(-1)}`) path.push(q)
    }
    return path
  }
  return { nodes, edges: pieces.length + links.length, components: components.sort((a, b) => b - a), leg, route }
}
