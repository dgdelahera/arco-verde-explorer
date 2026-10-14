import { useEffect, useMemo, useState } from 'react'
import { latLngBounds, type LatLngBounds, type LatLngTuple } from 'leaflet'
import { MapContainer, Pane, Polyline, TileLayer, useMap } from 'react-leaflet'
import { emptyFilters, filterRoutes, parseRoutes, type RouteFeature, type RoutesData } from './filters'
import { lines } from './geo'
import { Panel } from './Panel'

const COLORS = { corta: '#0072b2', larga: '#d55e00' }

const positions = (r: RouteFeature): LatLngTuple[][] =>
  lines(r.geometry).map((l) => l.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([lon, lat]) => [lat, lon]))
const boundsOf = (routes: RouteFeature[]) => latLngBounds(routes.flatMap(positions).flat())

function FitBounds({ bounds, nonce }: { bounds: LatLngBounds; nonce: number }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds.isValid()) return
    const sheet = matchMedia('(max-width: 767px)').matches ? (document.querySelector<HTMLElement>('.panel')?.offsetHeight ?? 0) : 0
    map.fitBounds(bounds, { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24 + sheet] })
  }, [map, bounds, nonce])
  return null
}

export default function App() {
  const [data, setData] = useState<RoutesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitNonce, setFitNonce] = useState(0)

  useEffect(() => {
    fetch('/data/routes.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(parseRoutes(json)))
      .catch((e: Error) => setError(e.message))
  }, [])

  const visible = useMemo(() => (data ? filterRoutes(data.routes, filters) : []), [data, filters])
  const selected = data?.routes.find((r) => r.properties.id === selectedId) ?? null
  const bounds = useMemo(() => boundsOf(selected ? [selected] : (data?.routes ?? [])), [selected, data])

  if (error) return <p className="status" role="alert">No se pudieron cargar las rutas ({error}). Recarga la página o inténtalo más tarde.</p>
  if (!data) return <p className="status" role="status">Cargando rutas…</p>

  const line = (r: RouteFeature) => {
    const isSelected = r === selected
    return (
      <Polyline
        key={r.properties.id}
        positions={positions(r)}
        pathOptions={{
          color: COLORS[r.properties.category] ?? COLORS.larga,
          weight: isSelected ? 7 : 4,
          opacity: selected && !isSelected ? 0.35 : 0.9,
        }}
        eventHandlers={{ click: () => setSelectedId(r.properties.id) }}
      />
    )
  }
  const others = visible.filter((r) => r !== selected)
  return (
    <div className="layout">
      <Panel
        data={data}
        visible={visible}
        filters={filters}
        onFiltersChange={setFilters}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onShowAll={() => { setSelectedId(null); setFitNonce((n) => n + 1) }}
      />
      <main className="map" aria-label="Mapa de las rutas del Arco Verde. La lista del panel ofrece la misma información en texto.">
        <MapContainer bounds={bounds} className="leaflet-map">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          {others.filter((r) => r.properties.category !== 'corta').map(line)}
          <Pane name="corta" style={{ zIndex: 410 }}>{others.filter((r) => r.properties.category === 'corta').map(line)}</Pane>
          <Pane name="selected" style={{ zIndex: 420 }}>{selected && visible.includes(selected) && line(selected)}</Pane>
          <FitBounds bounds={bounds} nonce={fitNonce} />
        </MapContainer>
      </main>
    </div>
  )
}
