import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'
import { gpx } from '@tmcw/togeojson'
import { lengthMeters, lines, type Position } from '../src/geo.ts'

export const PAGE_URL = 'https://www.comunidad.madrid/medio-ambiente/arco-verde'
const OUT = fileURLToPath(new URL('../public/data/routes.geojson', import.meta.url))
const EXPECTED_ROUTES = 36

export type PageRoute = {
  id: string
  name: string
  category: 'corta' | 'larga'
  municipalities: string[]
  distanceKm: number | null
  elevationGainM: number | null
  type: string | null
  sector: string | null
  warnings: string | null
  description: string | null
  gpxUrl: string | null
  planUrl: string | null
}

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()

const codeOf = (s: string) => {
  const m = /^(R[CL])\s*(\d+b?)\b/.exec(s.trim())
  return m ? { id: m[1] + m[2], rest: s.trim().slice(m[0].length).trim() } : null
}

const num = (s: string) => (/^\d+(,\d+)?$/.test(s) ? Number(s.replace(',', '.')) : null)
const MUNICIPALITY_NAMES: Record<string, string> = {
  'Las Rozas': 'Las Rozas de Madrid',
  'las Rozas de Madrid': 'Las Rozas de Madrid',
  'Rivas Vaciamadrid': 'Rivas-Vaciamadrid',
  'San Fernando': 'San Fernando de Henares',
}
export const splitList = (s: string) =>
  s.replace(/^\(\d+\)\s*/, '').replace(/\.$/, '').split(/\s*,\s*|\s+y\s+/).filter(Boolean)
    .map((m) => MUNICIPALITY_NAMES[m] ?? m)

const LABELS = ['PLANO', 'TRACKS', 'TÉRMINOS MUNICIPALES', 'TIPO DE RUTA', 'SECTOR', 'DISTANCIA', 'DESNIVEL', 'PRECAUCIONES', 'DESCRIPCIÓN']
const LABEL_RE = new RegExp(`^(${LABELS.join('|')})\\s*:\\s*`)

/** Splits a route's detail HTML into labelled sections; paragraphs after a label belong to it. */
export function parseDetail(html: string): Record<string, { paragraphs: string[]; href: string | null }> {
  const sections: Record<string, { paragraphs: string[]; href: string | null }> = {}
  let current: { paragraphs: string[]; href: string | null } | null = null
  for (const [, inner] of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const t = text(inner)
    const m = LABEL_RE.exec(t)
    if (m) {
      current = { paragraphs: [], href: /href="([^"]+)"/.exec(inner)?.[1] ?? null }
      sections[m[1]] = current
      const rest = t.slice(m[0].length).trim()
      if (rest) current.paragraphs.push(rest)
    } else if (current && t) current.paragraphs.push(t)
  }
  return sections
}

export function parsePage(pageHtml: string): PageRoute[] {
  const ld = [...pageHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .find((d) => d['@type'] === 'FAQPage')
  if (!ld) throw new Error('FAQPage JSON-LD not found')
  const entries: { name: string; html: string }[] = ld.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => ({
    name: q.name,
    html: q.acceptedAnswer.text,
  }))

  const details = new Map<string, ReturnType<typeof parseDetail>>()
  for (const e of entries) {
    const code = codeOf(e.name)
    if (code) details.set(code.id, parseDetail(e.html))
  }

  const routes: PageRoute[] = []
  for (const e of entries) {
    for (const [, row] of e.html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]))
      const code = cells.length === 6 ? codeOf(cells[0]) : null
      if (!code) continue
      const [, municipios, distancia, desnivel, tipo, sector] = cells
      const d = details.get(code.id)
      const section = (label: string) => d?.[label]?.paragraphs.join('\n\n') || null
      const precauciones = section('PRECAUCIONES')
      const ficha = section('TÉRMINOS MUNICIPALES')
      const abs = (href: string | null | undefined) => (href ? new URL(href, PAGE_URL).href : null)
      routes.push({
        id: code.id,
        name: code.rest,
        category: code.id.startsWith('RC') ? 'corta' : 'larga',
        municipalities: splitList(/ficha/i.test(municipios) && ficha ? ficha : municipios),
        distanceKm: num(distancia),
        elevationGainM: num(desnivel),
        type: tipo || null,
        sector: sector || null,
        warnings: precauciones === 'No' ? null : precauciones,
        description: section('DESCRIPCIÓN'),
        gpxUrl: abs(d?.TRACKS?.href),
        planUrl: abs(d?.PLANO?.href),
      })
    }
  }
  return routes
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]

export function dedupe(line: Position[]): Position[] {
  return line.filter((p, i) => i === 0 || !same(p, line[i - 1]))
}

/** Ramer–Douglas–Peucker in planar degrees, iterative so dense tracks can't blow the stack. */
export function rdp(line: Position[], tolerance: number): Position[] {
  if (line.length < 3) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const [ax, ay] = line[s]
    const dx = line[e][0] - ax
    const dy = line[e][1] - ay
    const len = Math.hypot(dx, dy)
    let max = 0
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const [px, py] = line[i]
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / len
      if (d > max) { max = d; idx = i }
    }
    if (max > tolerance) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return line.filter((_, i) => keep[i])
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function gpxToGeometry(xml: string): { geometry: GeoJSON.MultiLineString; computedLengthKm: number } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const fc = gpx(doc as unknown as Document)
  const raw = fc.features
    .flatMap((f) => (f.geometry ? lines(f.geometry) : []))
    .map((l) => dedupe(l.map((p) => [p[0], p[1]])))
    .filter((l) => l.length >= 2)
  if (!raw.length) throw new Error('GPX has no track')
  const computedLengthKm = Math.round(lengthMeters({ type: 'MultiLineString', coordinates: raw }) / 10) / 100
  const coordinates = raw
    .map((l) => dedupe(rdp(l, 0.00005).map((p) => [round6(p[0]), round6(p[1])])))
    .filter((l) => l.length >= 2)
  return { geometry: { type: 'MultiLineString', coordinates }, computedLengthKm }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'arco-verde-explorer data script' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

async function main() {
  const routes = parsePage(await fetchText(PAGE_URL))
  const missing = routes.filter((r) => !r.gpxUrl).map((r) => r.id)
  const ids = new Set(routes.map((r) => r.id))
  if (routes.length !== EXPECTED_ROUTES || ids.size !== routes.length || missing.length)
    throw new Error(`Expected ${EXPECTED_ROUTES} unique routes with GPX, got ${routes.length} (${ids.size} unique); missing GPX: ${missing.join(', ') || 'none'}`)
  const unparsed = routes.filter((r) => r.distanceKm === null || r.elevationGainM === null).map((r) => r.id)
  if (unparsed.length) throw new Error(`Distance or desnivel not numeric for: ${unparsed.join(', ')}`)

  const features = []
  for (const r of routes) {
    const { geometry, computedLengthKm } = gpxToGeometry(await fetchText(r.gpxUrl!))
    features.push({ type: 'Feature', geometry, properties: { ...r, computedLengthKm } })
    console.log(`${r.id}: ${computedLengthKm} km (official ${r.distanceKm})`)
  }

  const file = {
    type: 'FeatureCollection',
    metadata: { source: 'Comunidad de Madrid — Arco Verde', sourceUrl: PAGE_URL, extractedAt: new Date().toISOString().slice(0, 10) },
    features,
  }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(file))
  console.log(`Wrote ${features.length} routes to ${OUT}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
