import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { distanceToGeometryMeters, lines } from '../src/geo.ts'
import type { PoiCategory, PoiFeature } from '../src/pois.ts'

const ROUTES = fileURLToPath(new URL('../public/data/routes.geojson', import.meta.url))
const OUT = fileURLToPath(new URL('../public/data/pois.geojson', import.meta.url))
const OVERPASS = 'https://overpass-api.de/api/interpreter'
export const MAX_METERS = 300

type Element = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export function categoryOf(t: Record<string, string>): PoiCategory | null {
  if (t.amenity === 'drinking_water' && t.drinking_water !== 'no' && t.access !== 'private') return 'fuente'
  if ((t.tourism === 'picnic_site' || (t.amenity === 'shelter' && t.shelter_type !== 'public_transport')) && t.access !== 'private') return 'descanso'
  if ((t.railway === 'station' || t.railway === 'halt') && !['funicular', 'miniature', 'monorail'].includes(t.station) && t.usage !== 'tourism' && !t['disused:railway']) return 'transporte'
  return null
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Overpass `out center tags` → POI features within maxMeters of any track. */
export function overpassToPois(json: { elements: Element[] }, tracks: GeoJSON.Geometry[], maxMeters = MAX_METERS): PoiFeature[] {
  const pad = maxMeters / 111000
  const boxes = tracks.map((g) => {
    const pts = lines(g).flat()
    return { g, w: Math.min(...pts.map((p) => p[0])) - pad * 1.4, e: Math.max(...pts.map((p) => p[0])) + pad * 1.4, s: Math.min(...pts.map((p) => p[1])) - pad, n: Math.max(...pts.map((p) => p[1])) + pad }
  })
  const out: PoiFeature[] = []
  for (const el of json.elements) {
    const category = el.tags && categoryOf(el.tags)
    const at = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null)
    if (!category || !at) continue
    const p = [at.lon, at.lat]
    const near = boxes.some((b) => p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n && distanceToGeometryMeters(p, b.g) <= maxMeters)
    if (!near) continue
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [round6(at.lon), round6(at.lat)] },
      properties: { id: `${el.type}/${el.id}`, name: el.tags!.name?.trim() || null, category },
    })
  }
  return out.sort((a, b) => a.properties.id.localeCompare(b.properties.id))
}

export const query = ([s, w, n, e]: number[]) =>
  `[out:json][timeout:180][bbox:${s},${w},${n},${e}];(nwr[amenity=drinking_water];nwr[tourism=picnic_site];nwr[amenity=shelter];nwr[railway~"^(station|halt)$"];);out center tags;`

async function overpass(q: string) {
  for (let attempt = 0, wait = 30; ; attempt++, wait *= 2) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': 'arco-verde-explorer data script (https://github.com/dgdelahera/arco-verde-explorer)', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: q }),
    })
    if (res.ok) return res.json()
    if (attempt >= 4 || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass ${res.status} ${res.statusText}`)
    console.log(`Overpass ${res.status}, retrying in ${wait} s`)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
}

async function main() {
  const routes = JSON.parse(await readFile(ROUTES, 'utf8')) as GeoJSON.FeatureCollection
  const tracks = routes.features.map((f) => f.geometry)
  const pts = tracks.flatMap((g) => lines(g).flat())
  const pad = MAX_METERS / 111000
  const bbox = [
    Math.min(...pts.map((p) => p[1])) - pad, Math.min(...pts.map((p) => p[0])) - pad * 1.4,
    Math.max(...pts.map((p) => p[1])) + pad, Math.max(...pts.map((p) => p[0])) + pad * 1.4,
  ].map((n) => n.toFixed(4))
  const json = await overpass(query(bbox.map(Number)))
  const features = overpassToPois(json, tracks)
  const counts = Object.groupBy(features, (f) => f.properties.category)
  console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v!.length}`).join(', '))
  const file = {
    type: 'FeatureCollection',
    metadata: { source: '© OpenStreetMap contributors, ODbL', sourceUrl: 'https://www.openstreetmap.org/copyright', extractedAt: new Date().toISOString().slice(0, 10) },
    features,
  }
  await writeFile(OUT, JSON.stringify(file))
  console.log(`Wrote ${features.length} POIs to ${OUT}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
