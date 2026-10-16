import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Control, divIcon, DomEvent, latLng, latLngBounds, popup, tooltip, type LatLngBounds, type LatLngTuple, type Map as LeafletMap } from 'leaflet'
import { AttributionControl, CircleMarker, MapContainer, Marker, Pane, Popup, Polyline, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { emptyFilters, filterRoutes, norm, parseRoutes, routeIdFromHash, type RouteFeature, type RoutesData } from './filters'
import { distanceToGeometryMeters, lines, minDistanceToLines, routeEnds, type Position } from './geo'
import { useOnline } from './online'
import { Panel, type LocateStatus } from './Panel'
import { decodePlan, loadDraft, MAX_POINTS, round5, saveDraft } from './plan'
import { osmUrl, parsePois, POI_CATEGORIES, searchPois, type PoiCategory, type PoiFeature, type PoisData } from './pois'
import { parseElevation, type ElevationData } from './elevation'

const NETWORK = '#0072b2'
const SELECTED = '#c2185b'
const PLAN = '#e66100'
const media = (q: string) => matchMedia(q).matches

type Geo = { positions: LatLngTuple[][]; bounds: LatLngBounds }

const positionsOf = (r: RouteFeature): LatLngTuple[][] =>
  lines(r.geometry).map((l) => l.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([lon, lat]) => [lat, lon]))

type LineProps = { positions: LatLngTuple[][]; mode: 'normal' | 'selected' | 'dimmed'; casing?: boolean }

function Endpoint({ at, label, color }: { at: Position; label: string; color: string }) {
  return (
    <CircleMarker center={[at[1], at[0]]} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, interactive: false }}>
      <Tooltip permanent direction="top" offset={[0, -8]}>{label}</Tooltip>
    </CircleMarker>
  )
}

function Endpoints({ route }: { route: RouteFeature }) {
  const ends = routeEnds(route.geometry)
  const type = route.properties.type
  if (!ends) return null
  if (type !== 'Lineal') return <Endpoint at={ends.start} label={type === 'Circular' || type === 'Ida y vuelta' ? 'Inicio y fin' : 'Inicio'} color="#1a7f37" />
  return (
    <>
      <Endpoint at={ends.start} label="Inicio" color="#1a7f37" />
      <Endpoint at={ends.end} label="Fin" color="#b42318" />
    </>
  )
}

const RouteLine = memo(function RouteLine({ positions, mode, casing }: LineProps) {
  const weight = mode === 'selected' ? 7 : mode === 'dimmed' ? 3 : 4
  const opacity = mode === 'dimmed' ? 0.4 : 1
  const pathOptions = useMemo(
    () => ({ color: casing ? '#fff' : mode === 'selected' ? SELECTED : NETWORK, weight: casing ? weight + 3 : weight, opacity, interactive: false }),
    [casing, mode, weight, opacity],
  )
  return <Polyline positions={positions} pathOptions={pathOptions} />
})

function MapSetup({ network }: { network?: LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    const c = map.getContainer()
    c.setAttribute('role', 'group')
    c.setAttribute('aria-label', 'Mapa interactivo de rutas. Usa las flechas para desplazarlo')
    if (!network) return
    const limit = () => { const z = map.getBoundsZoom(network) - 2; if (Number.isFinite(z)) map.setMinZoom(z) }
    limit()
    map.on('resize', limit)
    return () => { map.off('resize', limit) }
  }, [map, network])
  return null
}

function ShowAllControl({ onClick }: { onClick: () => void }) {
  const map = useMap()
  const [el] = useState(() => { const d = document.createElement('div'); d.className = 'leaflet-control'; DomEvent.disableClickPropagation(d); return d })
  useEffect(() => {
    const c = new Control({ position: 'topleft' })
    c.onAdd = () => el
    c.addTo(map)
    return () => { c.remove() }
  }, [map, el])
  return createPortal(<button type="button" className="show-all" onClick={onClick}>Ver toda la red</button>, el)
}

function fit(map: LeafletMap, bounds: LatLngBounds) {
  const sheet = media('(max-width: 767px)') ? (document.querySelector<HTMLElement>('.panel')?.offsetHeight ?? 0) : 0
  const box = map.getContainer().getBoundingClientRect()
  const ctl = map.getContainer().querySelector('.leaflet-top.leaflet-left')!.getBoundingClientRect()
  const [w, h] = [ctl.right - box.left, ctl.bottom - box.top]
  // Padding is a rectangle, so clear the corner controls along whichever side costs less of the visible map.
  const [left, top] = w / box.width < h / (box.height - sheet) ? [w, 0] : [0, h]
  map.fitBounds(bounds, { paddingTopLeft: [24 + left, 48 + top], paddingBottomRight: [24, 24 + sheet], animate: !media('(prefers-reduced-motion: reduce)') })
}

function FitBounds({ bounds, nonce }: { bounds: LatLngBounds; nonce: number }) {
  const map = useMap()
  useEffect(() => { if (bounds.isValid()) fit(map, bounds) }, [map, bounds, nonce])
  return null
}

const poiIcons = Object.fromEntries(Object.entries(POI_CATEGORIES).map(([k, c]) => [k, divIcon({
  className: 'poi-pin', html: `<span style="background:${c.color}">${c.letter}</span>`, iconSize: [24, 24],
})]))

function PoiLayer({ pois, focus }: { pois: PoiFeature[]; focus: { id: string } | null }) {
  const map = useMap()
  const markers = useRef(new Map<string, L.Marker>())
  useEffect(() => {
    const m = focus && markers.current.get(focus.id)
    if (!m) return
    fit(map, m.getLatLng().toBounds(400))
    m.openPopup()
  }, [map, focus, pois])
  return (
    <Pane name="pois" style={{ zIndex: 435 }}>
      {pois.map((f) => {
        const p = f.properties
        const c = POI_CATEGORIES[p.category]
        return (
          <Marker key={p.id} position={[f.geometry.coordinates[1], f.geometry.coordinates[0]]} icon={poiIcons[p.category]} title={`${p.name ?? c.one} (${c.label})`}
            ref={(m) => { if (m) markers.current.set(p.id, m); else markers.current.delete(p.id) }}>
            <Popup>
              <strong>{p.name ?? c.one}</strong><br />
              {c.one}<br />
              <a href={osmUrl(p.id)} target="_blank" rel="noopener noreferrer">Ver en OpenStreetMap</a>
            </Popup>
          </Marker>
        )
      })}
    </Pane>
  )
}

function hitTest(map: LeafletMap, routes: RouteFeature[], geoms: Map<string, Geo>, at: { x: number; y: number }, tol: number) {
  const around = latLngBounds([map.containerPointToLatLng([at.x - tol, at.y - tol]), map.containerPointToLatLng([at.x + tol, at.y + tol])])
  const hits: { route: RouteFeature; d: number }[] = []
  for (const route of routes) {
    const g = geoms.get(route.properties.id)!
    if (!g.bounds.intersects(around)) continue
    const px = g.positions.map((l) => l.map((ll) => { const p = map.latLngToContainerPoint(ll); return [p.x, p.y] }))
    const d = minDistanceToLines([at.x, at.y], px)
    if (d <= tol) hits.push({ route, d })
  }
  return hits.sort((a, b) => a.d - b.d).map((h) => h.route)
}

function Picking({ visible, geoms, onSelect }: { visible: RouteFeature[]; geoms: Map<string, Geo>; onSelect: (id: string | null) => void }) {
  const map = useMap()
  useEffect(() => {
    const coarse = media('(pointer: coarse)')
    const tol = coarse ? 18 : 12
    const tip = tooltip({ direction: 'top', offset: [0, -6] })
    let frame = 0
    const onClick = (e: L.LeafletMouseEvent) => {
      const hits = hitTest(map, visible, geoms, e.containerPoint, tol)
      if (hits.length === 0) return onSelect(null)
      if (hits.length === 1) return onSelect(hits[0].properties.id)
      const box = document.createElement('div')
      box.setAttribute('role', 'group')
      box.setAttribute('aria-label', 'Varias rutas aquí')
      const title = document.createElement('p')
      title.textContent = 'Varias rutas aquí:'
      box.append(title)
      for (const r of hits) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chooser-item'
        b.textContent = `${r.properties.id} · ${r.properties.name}`
        b.onclick = () => {
          map.closePopup()
          onSelect(r.properties.id)
          setTimeout(() => document.querySelector<HTMLElement>(`#route-${CSS.escape(r.properties.id)} .route-item`)?.focus(), 0)
        }
        box.append(b)
      }
      const pop = popup({ className: 'chooser' }).setLatLng(e.latlng).setContent(box).openOn(map)
      // Removing the focused popup drops focus to <body> without a focusout, so track whether focus was last inside it.
      const el = pop.getElement()!
      let focusInside = false
      el.addEventListener('focusin', () => { focusInside = true })
      el.addEventListener('focusout', (ev) => { focusInside = el.contains(ev.relatedTarget as Node | null) })
      pop.on('remove', () => { if (focusInside) map.getContainer().focus({ preventScroll: true }) })
      const close = pop.getElement()?.querySelector('.leaflet-popup-close-button')
      close?.setAttribute('aria-label', 'Cerrar')
      close?.setAttribute('title', 'Cerrar')
      box.querySelector('button')?.focus()
    }
    let last: L.LeafletMouseEvent
    const onMove = (e: L.LeafletMouseEvent) => {
      last = e
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const hit = hitTest(map, visible, geoms, last.containerPoint, tol)[0]
        map.getContainer().style.cursor = hit ? 'pointer' : ''
        if (!hit) return void tip.remove()
        tip.setContent(`${hit.properties.id} · ${hit.properties.name}`)
        tip.setLatLng(last.latlng).addTo(map)
      })
    }
    const onOut = () => { cancelAnimationFrame(frame); frame = 0; map.getContainer().style.cursor = ''; tip.remove() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tip.remove() }
    document.addEventListener('keydown', onKey)
    map.on('click', onClick)
    if (!coarse) { map.on('mousemove', onMove); map.on('mouseout', onOut) }
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      map.off('click', onClick).off('mousemove', onMove).off('mouseout', onOut)
      map.getContainer().style.cursor = ''
      map.closePopup()
      tip.remove()
    }
  }, [map, visible, geoms, onSelect])
  return null
}

type Edit = (f: (points: Position[]) => Position[]) => void
const pin = (n: number) => divIcon({ className: 'plan-pin', html: String(n), iconSize: [32, 32] })

function PlanLayer({ points, edit }: { points: Position[]; edit: Edit }) {
  const map = useMap()
  const dragEnd = useRef(0)
  useEffect(() => {
    // The mouseup ending a marker drag can also reach the map as a click.
    const onClick = (e: L.LeafletMouseEvent) => Date.now() - dragEnd.current > 300 && edit((p) => [...p, [round5(e.latlng.lng), round5(e.latlng.lat)]])
    map.on('click', onClick)
    map.doubleClickZoom.disable()
    map.getContainer().style.cursor = 'crosshair'
    return () => { map.off('click', onClick); map.doubleClickZoom.enable(); map.getContainer().style.cursor = '' }
  }, [map, edit])
  return (
    <Pane name="plan" style={{ zIndex: 440 }}>
      <Polyline positions={points.map(([lon, lat]): LatLngTuple => [lat, lon])} pathOptions={{ color: PLAN, weight: 4, dashArray: '8 6', interactive: false }} />
      {points.map(([lon, lat], i) => (
        <Marker key={i} position={[lat, lon]} icon={pin(i + 1)} draggable title={`Punto ${i + 1}: arrástralo para moverlo o púlsalo para eliminarlo`} eventHandlers={{
          dragend: (e) => { dragEnd.current = Date.now(); const ll = e.target.getLatLng(); edit((p) => p.map((q, j) => (j === i ? [round5(ll.lng), round5(ll.lat)] : q))) },
        }}>
          <Popup><button type="button" onClick={() => { map.closePopup(); edit((p) => p.filter((_, j) => j !== i)) }}>Eliminar punto {i + 1}</button></Popup>
        </Marker>
      ))}
    </Pane>
  )
}

export default function App() {
  const [data, setData] = useState<RoutesData | null>(null)
  const [elevation, setElevation] = useState<ElevationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState(emptyFilters)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitNonce, setFitNonce] = useState(0)
  const [me, setMe] = useState<[number, number] | null>(null)
  const [locateStatus, setLocateStatus] = useState<LocateStatus>('idle')
  const [nearMe, setNearMe] = useState(false)
  const [plan, setPlan] = useState<{ points: Position[]; past: Position[][]; edited?: boolean } | null>(null)
  const [planView, setPlanView] = useState<LatLngBounds | null>(null)
  const mapRef = useRef<LeafletMap>(null)
  const online = useOnline()
  const [poiCats, setPoiCats] = useState<Set<PoiCategory>>(new Set())
  const [pois, setPois] = useState<PoisData | 'idle' | 'loading' | 'error'>('idle')
  const [poiFocus, setPoiFocus] = useState<{ id: string } | null>(null)
  const loadPois = () => {
    if (pois !== 'idle' && pois !== 'error') return
    setPois('loading')
    fetch('/data/pois.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setPois(parsePois(json)))
      .catch(() => setPois('error'))
  }
  const poiData = typeof pois === 'object' ? pois : null
  const poiMatches = useMemo(() => (poiData ? searchPois(poiData.pois, filters.q) : []), [poiData, filters.q])
  const shownPois = useMemo(() => poiData?.pois.filter((f) => poiCats.has(f.properties.category)) ?? [], [poiData, poiCats])
  const togglePoi = (c: PoiCategory) => {
    if (!poiCats.has(c)) loadPois()
    setPoiCats((s) => { const n = new Set(s); if (!n.delete(c)) n.add(c); return n })
  }
  const focusPoi = (f: PoiFeature) => {
    setPoiCats((s) => new Set(s).add(f.properties.category))
    setPoiFocus({ id: f.properties.id })
  }

  useEffect(() => {
    fetch('/data/routes.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => setData(parseRoutes(json)))
      .catch((e: Error) => setError(e.message))
    fetch('/data/elevation.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setElevation(parseElevation(json)))
      .catch(() => {})
  }, [])

  const startPlan = useCallback((seed?: Position[]) => {
    const draft = loadDraft()
    const points = seed ?? draft
    setPlan({ points, past: seed && draft.length ? [draft] : [] })
    setPlanView(points.length ? latLng(points[0][1], points[0][0]).toBounds(2000).extend(latLngBounds(points.map(([lon, lat]) => [lat, lon])).pad(0.25)) : null)
  }, [])
  const editPlan = useCallback<Edit>((f) => setPlan((p) => {
    if (!p) return p
    const points = f(p.points)
    return points.length > MAX_POINTS ? p : { points, past: [...p.past, p.points], edited: true }
  }), [])
  useEffect(() => { if (plan?.edited) saveDraft(plan.points) }, [plan])

  useEffect(() => {
    if (!data) return
    const ids = data.routes.map((r) => r.properties.id)
    const onHash = () => {
      const points = decodePlan(location.hash)
      if (!points) return setSelectedId(routeIdFromHash(location.hash, ids))
      history.replaceState(null, '', location.pathname + location.search)
      startPlan(points)
    }
    onHash()
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [data, startPlan])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) location.hash = id
    else if (location.hash) history.pushState(null, '', location.pathname + location.search)
  }, [])

  const geoms = useMemo(
    () => new Map((data?.routes ?? []).map((r) => { const positions = positionsOf(r); return [r.properties.id, { positions, bounds: latLngBounds(positions.flat()) }] as const })),
    [data],
  )
  // maxBounds pads the network generously: on mobile the bottom sheet pushes the fitted view well south of the routes.
  const network = useMemo(() => {
    const b = latLngBounds([])
    for (const g of geoms.values()) b.extend(g.bounds)
    return b.isValid() ? b : undefined
  }, [geoms])
  const visible = useMemo(() => (data ? filterRoutes(data.routes, filters) : []), [data, filters])
  const selected = visible.find((r) => r.properties.id === selectedId) ?? null
  const selectedBounds = selected ? geoms.get(selected.properties.id)!.bounds : null
  const distances = useMemo(
    () => (me && data ? new Map(data.routes.map((r) => [r.properties.id, distanceToGeometryMeters(me, r.geometry) / 1000])) : null),
    [me, data],
  )
  const listed = useMemo(
    () => (distances ? [...visible].sort((a, b) => distances.get(a.properties.id)! - distances.get(b.properties.id)!) : visible),
    [visible, distances],
  )

  const nearest = nearMe && me && listed[0] ? geoms.get(listed[0].properties.id)!.bounds : null
  const bounds = useMemo(() => {
    if (planView) return planView
    if (selectedBounds) return selectedBounds
    const all = latLngBounds([])
    if (me && nearest) return all.extend(nearest).extend([me[1], me[0]])
    for (const r of visible) all.extend(geoms.get(r.properties.id)!.bounds)
    return all
  }, [planView, selectedBounds, visible, geoms, me, nearest])

  const changeFilters = (f: typeof filters) => {
    setFilters(f)
    if (norm(f.q.trim()).length >= 3) loadPois()
    if (selectedId && !filterRoutes(data!.routes, f).some((r) => r.properties.id === selectedId)) select(null)
  }

  const locate = () => {
    if (!navigator.geolocation) return setLocateStatus('unsupported')
    setLocateStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (p) => { setMe([p.coords.longitude, p.coords.latitude]); setLocateStatus('done'); setNearMe(true); setFitNonce((n) => n + 1) },
      (e) => setLocateStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'error'),
      { timeout: 15000 },
    )
  }

  if (error) return <p className="status" role="alert">No se pudieron cargar las rutas ({error}). {online ? 'Recarga la página o inténtalo más tarde.' : 'No hay conexión y este dispositivo aún no tiene las rutas guardadas: conéctate a internet y recarga la página.'}</p>
  if (!data) return <p className="status" role="status">Cargando rutas…</p>

  const showAll = () => { setFilters(emptyFilters); select(null); setNearMe(false); setFitNonce((n) => n + 1) }
  const line = (r: RouteFeature, casing?: boolean) => (
    <RouteLine
      key={r.properties.id}
      positions={geoms.get(r.properties.id)!.positions}
      mode={!selected ? 'normal' : r === selected ? 'selected' : 'dimmed'}
      casing={casing}
    />
  )
  const others = visible.filter((r) => r !== selected)
  const reduce = media('(prefers-reduced-motion: reduce)')
  return (
    <div className="layout">
      <Panel
        data={data}
        visible={listed}
        filters={filters}
        onFiltersChange={changeFilters}
        selectedId={selected?.properties.id ?? null}
        onSelect={select}
        distances={distances}
        locateStatus={locateStatus}
        onLocate={locate}
        planner={plan && {
          points: plan.points,
          canUndo: plan.past.length > 0,
          undo: () => setPlan({ points: plan.past.at(-1)!, past: plan.past.slice(0, -1), edited: true }),
          clear: () => editPlan(() => []),
          addCenter: () => {
            const map = mapRef.current!
            const box = map.getContainer().getBoundingClientRect()
            const x = document.querySelector('.crosshair')!.getBoundingClientRect()
            const ll = map.containerPointToLatLng([x.left + x.width / 2 - box.left, x.top + x.height / 2 - box.top])
            editPlan((p) => [...p, [round5(ll.lng), round5(ll.lat)]])
          },
          exit: () => { setPlan(null); setPlanView(null) },
        }}
        onPlan={startPlan}
        pois={{ active: poiCats, toggle: togglePoi, status: typeof pois === 'object' ? 'ready' : pois, metadata: poiData?.metadata ?? null, matches: poiMatches, focus: focusPoi }}
        elevation={elevation}
      />
      <section className="map" aria-label="Mapa de rutas">
        <MapContainer ref={mapRef} bounds={bounds} maxBounds={network?.pad(3)} maxBoundsViscosity={1} maxZoom={19} className="leaflet-map" zoomControl={false} attributionControl={false} zoomAnimation={!reduce} fadeAnimation={!reduce} markerZoomAnimation={!reduce}>
          <MapSetup network={network} />
          <ZoomControl zoomInTitle="Acercar" zoomOutTitle="Alejar" />
          <ShowAllControl onClick={showAll} />
          <AttributionControl position={media('(max-width: 767px)') ? 'topright' : 'bottomright'} />
          <TileLayer maxZoom={19} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
          <Pane name="casing" style={{ zIndex: 395 }}>{visible.map((r) => line(r, true))}</Pane>
          {others.map((r) => line(r))}
          <Pane name="selected" style={{ zIndex: 420 }}>{selected && line(selected)}</Pane>
          {selected && <Pane name="ends" style={{ zIndex: 425 }}><Endpoints route={selected} /></Pane>}
          {me && (
            <Pane name="me" style={{ zIndex: 430 }}>
              <CircleMarker center={[me[1], me[0]]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a56db', fillOpacity: 1, interactive: false }} />
            </Pane>
          )}
          {!plan && <PoiLayer pois={shownPois} focus={poiFocus} />}
          {plan ? <PlanLayer points={plan.points} edit={editPlan} /> : <Picking visible={visible} geoms={geoms} onSelect={select} />}
          <FitBounds bounds={bounds} nonce={fitNonce} />
        </MapContainer>
        {plan && <div className="crosshair" aria-hidden="true" />}
      </section>
    </div>
  )
}
