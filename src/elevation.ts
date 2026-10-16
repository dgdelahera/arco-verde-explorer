import { haversineMeters, type Position } from './geo.ts'

export const DEM_URL = 'https://servicios.idee.es/wcs-inspire/mdt'
export const SAMPLE_M = 50
export const SMOOTH_WINDOW = 5
const TILE_DEG = 0.05
const PAD_DEG = 0.0005
const MAX_PROFILE_POINTS = 300

export type Sample = { d: number; p: Position; part: number }
export type Profile = { gainM: number; lossM: number; minM: number; maxM: number; profile: [number, number][] }
export type ElevationMeta = {
  source: string; sourceUrl: string; serviceUrl: string; attribution: string; licence: string; licenceUrl: string
  resolutionM: number; sampleSpacingM: number; smoothing: string; retrievedAt: string
}
export type ElevationData = { metadata: ElevationMeta; routes: Record<string, Profile> }

/** Points every `step` meters along the lines, plus each line's last vertex; distance keeps counting across parts. */
export function sampleLines(parts: Position[][], step = SAMPLE_M): Sample[] {
  const out: Sample[] = []
  let total = 0
  for (const [part, line] of parts.entries()) {
    if (line.length < 2) continue
    let next = total
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i]
      const len = haversineMeters(a, b)
      while (next <= total + len) {
        const t = len === 0 ? 0 : (next - total) / len
        out.push({ d: next, p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], part })
        next += step
      }
      total += len
    }
    if (out.at(-1)!.d < total) out.push({ d: total, p: line.at(-1)!, part })
  }
  return out
}

export type Grid = { ncols: number; nrows: number; xll: number; yll: number; cell: number; nodata: number | null; z: Float32Array }

/** Esri ASCII grid, optionally wrapped in the WCS multipart response. */
export function parseAsc(text: string): Grid {
  const start = text.indexOf('ncols')
  if (start < 0) throw new Error('Respuesta sin rejilla ASCII')
  const end = text.indexOf('\n--', start)
  const tokens = text.slice(start, end < 0 ? undefined : end).trim().split(/\s+/)
  const head: Record<string, number> = {}
  let i = 0
  while (/^[a-z_]+$/i.test(tokens[i])) { head[tokens[i].toLowerCase()] = Number(tokens[i + 1]); i += 2 }
  const { ncols, nrows, cellsize } = head
  const xll = head.xllcorner ?? head.xllcenter - cellsize / 2
  const yll = head.yllcorner ?? head.yllcenter - cellsize / 2
  const z = Float32Array.from(tokens.slice(i), Number)
  if (![ncols, nrows, cellsize, xll, yll].every(Number.isFinite) || z.length !== ncols * nrows) throw new Error('Rejilla ASCII incompleta')
  return { ncols, nrows, xll, yll, cell: cellsize, nodata: head.nodata_value ?? null, z }
}

/** Bilinear interpolation between cell centres; null outside the grid or on nodata. */
export function gridAt(g: Grid, lon: number, lat: number): number | null {
  const x = (lon - g.xll) / g.cell - 0.5
  const y = g.nrows - (lat - g.yll) / g.cell - 0.5
  if (x < 0 || y < 0 || x > g.ncols - 1 || y > g.nrows - 1) return null
  const c = Math.min(Math.floor(x), g.ncols - 2), r = Math.min(Math.floor(y), g.nrows - 2)
  const fx = x - c, fy = y - r
  const v = [g.z[r * g.ncols + c], g.z[r * g.ncols + c + 1], g.z[(r + 1) * g.ncols + c], g.z[(r + 1) * g.ncols + c + 1]]
  if (v.some((n) => !Number.isFinite(n) || n === g.nodata || n < -1000)) return null
  return (v[0] * (1 - fx) + v[1] * fx) * (1 - fy) + (v[2] * (1 - fx) + v[3] * fx) * fy
}

export const tileKey = ([lon, lat]: Position) => `${Math.floor(lon / TILE_DEG)},${Math.floor(lat / TILE_DEG)}`

export function tileUrl(key: string): string {
  const [x, y] = key.split(',').map(Number)
  const f = (n: number) => n.toFixed(4)
  return `${DEM_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&CoverageId=Elevacion4258_25&format=application/asc`
    + `&subset=Lat(${f(y * TILE_DEG - PAD_DEG)},${f((y + 1) * TILE_DEG + PAD_DEG)})&subset=Long(${f(x * TILE_DEG - PAD_DEG)},${f((x + 1) * TILE_DEG + PAD_DEG)})`
}

/** Elevation of each point from MDT25 tiles, fetched one at a time and kept in `cache`. Throws if a point has no data. */
export async function lookupElevations(points: Position[], fetchText: (url: string) => Promise<string>, cache: Map<string, Grid>): Promise<number[]> {
  const out: number[] = []
  for (const p of points) {
    const key = tileKey(p)
    if (!cache.has(key)) cache.set(key, parseAsc(await fetchText(tileUrl(key))))
    const z = gridAt(cache.get(key)!, p[0], p[1])
    if (z === null) throw new Error(`Sin datos de elevación en ${p[1]},${p[0]}`)
    out.push(z)
  }
  return out
}

/** Centred moving average; the window shrinks at the ends. */
export function smooth(values: number[], window = SMOOTH_WINDOW): number[] {
  const h = Math.floor(window / 2)
  return values.map((_, i) => {
    const s = values.slice(Math.max(0, i - h), i + h + 1)
    return s.reduce((a, b) => a + b, 0) / s.length
  })
}

export function gainLoss(values: number[]): { gain: number; loss: number } {
  let gain = 0, loss = 0
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  return { gain, loss }
}

/** Smooths and sums gain/loss per part, so the jump between disjoint parts of a track is not counted. */
export function buildProfile(samples: Sample[], elevations: number[], maxPoints = MAX_PROFILE_POINTS): Profile {
  const z: number[] = []
  let gain = 0, loss = 0
  for (const part of new Set(samples.map((s) => s.part))) {
    const zs = smooth(elevations.filter((_, i) => samples[i].part === part))
    const gl = gainLoss(zs)
    gain += gl.gain
    loss += gl.loss
    z.push(...zs)
  }
  const stride = Math.max(1, Math.ceil(z.length / maxPoints))
  const profile: [number, number][] = []
  for (let i = 0; i < z.length; i += stride) profile.push([Math.round(samples[i].d / 10) / 100, Math.round(z[i])])
  if ((z.length - 1) % stride) profile.push([Math.round(samples.at(-1)!.d / 10) / 100, Math.round(z.at(-1)!)])
  return { gainM: Math.round(gain), lossM: Math.round(loss), minM: Math.round(Math.min(...z)), maxM: Math.round(Math.max(...z)), profile }
}

const isProfile = (p: Profile) =>
  p && [p.gainM, p.lossM, p.minM, p.maxM].every(Number.isFinite) && Array.isArray(p.profile) && p.profile.length >= 2
  && p.profile.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))

export function parseElevation(json: unknown): ElevationData | null {
  const f = json as Partial<ElevationData> | null
  if (!f?.metadata || typeof f.metadata.source !== 'string' || !f.routes || typeof f.routes !== 'object') return null
  return { metadata: f.metadata, routes: Object.fromEntries(Object.entries(f.routes).filter(([, p]) => isProfile(p))) }
}
