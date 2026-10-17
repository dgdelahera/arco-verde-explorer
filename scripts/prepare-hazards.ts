import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { haversineMeters, lines, nearestOnGeometry, type Position } from '../src/geo.ts'
import type { HazardFeature } from '../src/hazards.ts'
import { overpass } from './prepare-pois.ts'

const ROUTES = fileURLToPath(new URL('../public/data/routes.geojson', import.meta.url))
const OUT = fileURLToPath(new URL('../public/data/hazards.geojson', import.meta.url))
export const MAX_METERS = 300

type Props = { id: string; notice?: string | null; warnings: string | null; description: string | null }
type Route = GeoJSON.Feature<GeoJSON.MultiLineString, Props>
type Element = { lat?: number; lon?: number; geometry?: { lat: number; lon: number }[] }
type Spec = { id: string; routes: string[]; title: string; text: string; from: string; to?: string }

/**
 * Places named by the official warnings. `text` must appear verbatim in the first route's notice, PRECAUCIONES or DESCRIPCIÓN;
 * `from` (and `to` for a stretch) are Overpass statements for the OpenStreetMap feature the text names, snapped onto that route.
 */
export const HAZARDS: Spec[] = [
  {
    id: 'puente-marmota', routes: ['RL11', 'RL12'], title: 'Tramo no ciclable junto al Puente de la Marmota',
    text: 'Atención, el tramo en la proximidad del Puente de la Marmota no es ciclable. En caso de realizar la ruta en bicicleta, será necesario transitar a pie llevando la bicicleta de la mano.',
    from: 'way(32491896)',
  },
  {
    id: 'cruce-m618', routes: ['RL20', 'RC13'], title: 'Cruce de la M-618 sin paso de peatones',
    text: 'La primera discontinuidad se localiza en el municipio de Torrelodones, en el cruce de la carretera M-618 a la altura de la Avenida de Los Robles. En este punto no existe paso de peatones ni señalización específica para facilitar el cruce, por lo que se recomienda extremar las precauciones y prestar especial atención al tráfico rodado.',
    from: 'way[ref="M-618"](40.578,-3.93,40.59,-3.91)',
  },
  {
    id: 'desvio-a4', routes: ['RL20'], title: 'Desvío provisional junto a la A-4',
    text: 'La segunda discontinuidad se encuentra en el entorno de la autopista A-4, donde actualmente no existe un paso que permita conectar de forma directa Bosquesur con la Cañada Real Galiana. Mientras se desarrolla una solución definitiva, el itinerario se desvía provisionalmente por el norte, a través de un polígono industrial.',
    from: 'way[highway=motorway][ref="A-4"](40.25,-3.75,40.36,-3.65)',
  },
  {
    id: 'desvio-c5', routes: ['RL20'], title: 'Desvío provisional junto a la C-5 de Cercanías',
    text: 'La tercera se encuentra en la proximidad de la línea C-5 de Cercanías, entre las estaciones de La Serna y Parque Polvoranca, donde la ausencia de pasos de conexión entre distintas parcelas de Bosquesur impide la continuidad directa del recorrido.',
    from: 'way[railway=rail](40.297,-3.795,40.312,-3.781)',
  },
  {
    id: 'cuesta-reventon', routes: ['RC10', 'RL22'], title: 'Subida de la Cuesta del Reventón',
    text: 'el tramo de ascenso de la Cuesta del Reventón presenta una pendiente considerable y puede requerir un mayor esfuerzo físico, especialmente para ciclistas.',
    from: 'way(30119800)',
  },
  {
    id: 'pinar-dona-consuelo', routes: ['RL22'], title: 'Zona técnica en el Parque Pinar de Doña Consuelo',
    text: 'Existen zonas que requieren cierto nivel técnico, a la salida de Pozuelo (Parque Cuesta del Reventón), en las cercanías de la Dehesa de Majadahonda, y en el Parque Pinar de Doña Consuelo.',
    from: 'way(1058389037)',
  },
  {
    id: 'arroyo-tejada', routes: ['RC11', 'RL13', 'RL14', 'RL15'], title: 'Arroyo Tejada: paso difícil con lluvias',
    text: 'Durante otoño, invierno y primavera, las lluvias pueden aumentar el caudal del arroyo Tejada, dificultando o incluso impidiendo el paso en algunos tramos.',
    from: 'way[waterway][name="Arroyo de la Tejada"]',
  },
  {
    id: 'canada-recueros', routes: ['RC3'], title: 'Cañada de los Recueros: tráfico de polígono industrial',
    text: 'El tramo correspondiente a la Cañada de los Recueros discurre por una zona compartida con vehículos a motor dentro de un polígono industrial.',
    from: 'way[name="Calle de Cañada de Recueros"]',
  },
  {
    id: 'jarama-a2', routes: ['RL1', 'RL2'], title: 'Riberas del Jarama junto a la A-2: inundables',
    text: 'Existen varios tramos próximos al río Jarama, especialmente en las cercanías de la A-2, que pueden verse afectados por inundaciones tras episodios de lluvias intensas o crecidas del río.',
    from: 'way[highway=motorway][ref="A-2"](40.40,-3.56,40.48,-3.48)',
  },
  {
    id: 'soto-juntas', routes: ['RL4b'], title: 'Tramo compartido con vehículos a motor',
    text: 'Entre el Soto de las Juntas y la Escuela Nacional de Protección Civil existe un tramo compartido con vehículos a motor.',
    from: 'way(438162915)', to: 'way(481782997)',
  },
  {
    id: 'obras-villaviciosa', routes: ['RL7', 'RL8'], title: 'Obras entre la M-50 y Villaviciosa de Odón',
    text: 'Las principales precauciones están relacionadas con las obras existentes entre la M-50 y Villaviciosa de Odón. Estas pueden obligar a modificar ligeramente el itinerario previsto, por lo que resulta recomendable disponer de mapas y haber previsto alternativas.',
    from: 'way[highway=motorway][ref="M-50"](40.33,-3.90,40.40,-3.83)', to: 'node(306574423)',
  },
]

const round6 = (p: Position) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]

export const officialText = (p: Props) => [p.notice, p.warnings, p.description].filter(Boolean).join('\n\n')

type Snapped = { at: Position; m: number; part: number; i: number }

/** Closest point of the track to any anchor vertex, with the part and segment (ending at vertex `i`) it lies on. */
export function snap(anchor: Position[], track: GeoJSON.MultiLineString): Snapped {
  let best: Snapped = { at: [], m: Infinity, part: -1, i: -1 }
  lines(track).forEach((l, part) => {
    for (let i = 1; i < l.length; i++) {
      const seg: GeoJSON.LineString = { type: 'LineString', coordinates: [l[i - 1], l[i]] }
      for (const p of anchor) {
        const n = nearestOnGeometry(p, seg)
        if (n.at && n.m < best.m) best = { at: n.at, m: n.m, part, i }
      }
    }
  })
  return best
}

/** The track between two snapped points on the same part. */
export function between(track: GeoJSON.MultiLineString, a: Snapped, b: Snapped): Position[] {
  if (a.part !== b.part) throw new Error('Both ends must fall on the same part of the track')
  const line = track.coordinates[a.part]
  const first = a.i < b.i || (a.i === b.i && haversineMeters(line[a.i - 1], a.at) <= haversineMeters(line[a.i - 1], b.at))
  const [s, e] = first ? [a, b] : [b, a]
  return [s.at, ...line.slice(s.i, e.i), e.at]
}

export function build(spec: Spec, routes: Map<string, Route>, from: Position[], to?: Position[]): HazardFeature {
  const route = routes.get(spec.routes[0])
  if (!route) throw new Error(`${spec.id}: unknown route ${spec.routes[0]}`)
  if (!officialText(route.properties).includes(spec.text)) throw new Error(`${spec.id}: text no longer on the official ${spec.routes[0]} page`)
  const a = snap(from, route.geometry)
  const b = to && snap(to, route.geometry)
  for (const s of [a, b]) if (s && s.m > MAX_METERS) throw new Error(`${spec.id}: anchor is ${Math.round(s.m)} m from ${spec.routes[0]}`)
  const path = b ? between(route.geometry, a, b).map(round6) : null
  const at = path ? path[Math.floor(path.length / 2)] : round6(a.at)
  for (const id of spec.routes.slice(1)) {
    const r = routes.get(id)
    const m = r ? nearestOnGeometry(at, r.geometry).m : Infinity
    if (m > MAX_METERS) throw new Error(`${spec.id}: ${id} does not pass the point (${Math.round(m)} m)`)
  }
  return { type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { id: spec.id, title: spec.title, text: spec.text, routes: spec.routes, path } }
}

async function anchor(statement: string): Promise<Position[]> {
  const { elements } = (await overpass(`[out:json][timeout:60];${statement};out geom;`)) as { elements: Element[] }
  const pts = elements.flatMap((e) => (e.geometry ? e.geometry.map((g) => [g.lon, g.lat]) : e.lon !== undefined && e.lat !== undefined ? [[e.lon, e.lat]] : []))
  if (!pts.length) throw new Error(`No OpenStreetMap feature for ${statement}`)
  return pts
}

async function main() {
  const file = JSON.parse(await readFile(ROUTES, 'utf8')) as GeoJSON.FeatureCollection<GeoJSON.MultiLineString, Props> & { metadata: { sourceUrl: string } }
  const routes = new Map(file.features.map((f) => [f.properties.id, f as Route]))
  const features: HazardFeature[] = []
  for (const spec of HAZARDS) {
    const f = build(spec, routes, await anchor(spec.from), spec.to ? await anchor(spec.to) : undefined)
    console.log(`${spec.id}: ${f.geometry.coordinates.join(',')}${f.properties.path ? ` (tramo de ${f.properties.path.length} puntos)` : ''}`)
    features.push(f)
  }
  const out = {
    type: 'FeatureCollection',
    metadata: { source: 'Comunidad de Madrid; ubicación aproximada a partir de © OpenStreetMap contributors, ODbL', sourceUrl: file.metadata.sourceUrl, extractedAt: new Date().toISOString().slice(0, 10) },
    features,
  }
  await writeFile(OUT, JSON.stringify(out))
  console.log(`Wrote ${features.length} hazards to ${OUT}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
