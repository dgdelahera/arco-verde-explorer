import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { lines } from '../src/geo.ts'
import { buildProfile, DEM_URL, lookupElevations, SAMPLE_M, sampleLines, SMOOTH_WINDOW, type ElevationData, type Grid } from '../src/elevation.ts'

const ROUTES = fileURLToPath(new URL('../public/data/routes.geojson', import.meta.url))
const OUT = fileURLToPath(new URL('../public/data/elevation.json', import.meta.url))

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'arco-verde-explorer data script' } })
    if (res.ok) return res.text()
    if (attempt === 3) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

async function main() {
  const fc = JSON.parse(await readFile(ROUTES, 'utf8')) as GeoJSON.FeatureCollection<GeoJSON.MultiLineString, { id: string; elevationGainM: number | null }>
  const cache = new Map<string, Grid>()
  const data: ElevationData = {
    metadata: {
      source: 'MDT25 del Instituto Geográfico Nacional (PNOA-LiDAR)',
      sourceUrl: 'https://www.scne.es/productos.html',
      serviceUrl: DEM_URL,
      attribution: '© Instituto Geográfico Nacional',
      licence: 'CC BY 4.0 scne.es',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/deed.es',
      resolutionM: 25,
      sampleSpacingM: SAMPLE_M,
      smoothing: `media móvil de ${SMOOTH_WINDOW} muestras`,
      retrievedAt: new Date().toISOString().slice(0, 10),
    },
    routes: {},
  }
  for (const f of fc.features) {
    const samples = sampleLines(lines(f.geometry))
    const p = buildProfile(samples, await lookupElevations(samples.map((s) => s.p), fetchText, cache))
    data.routes[f.properties.id] = p
    console.log(`${f.properties.id}: +${p.gainM} / -${p.lossM} m, ${p.minM}-${p.maxM} m (official desnivel ${f.properties.elevationGainM}), ${samples.length} samples`)
  }
  await writeFile(OUT, JSON.stringify(data))
  console.log(`Wrote ${Object.keys(data.routes).length} profiles from ${cache.size} DEM tiles to ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
