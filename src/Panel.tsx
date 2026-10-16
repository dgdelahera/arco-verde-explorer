import { useEffect, useMemo, useRef, useState } from 'react'
import { distinct, emptyFilters, lengthMismatch, type Filters, type Metadata, type RouteFeature, type RoutesData } from './filters'
import { directionsUrls, routeEnds, toGpx, type Position } from './geo'
import { MAX_POINTS, openableDraft, planHash, planLine, planMeters } from './plan'
import type { Network } from './network'
import { POI_CATEGORIES, type PoiCategory, type PoiFeature } from './pois'
import { useOnline } from './online'
import { OfflineBanner } from './OfflineBanner'
import { buildProfile, lookupElevations, sampleLines, tileKey, type ElevationData, type ElevationMeta, type Grid, type Profile } from './elevation'

export type LocateStatus = 'idle' | 'loading' | 'done' | 'denied' | 'error' | 'unsupported'
const LOCATE_MESSAGES: Partial<Record<LocateStatus, string>> = {
  loading: 'Buscando tu ubicación…',
  done: 'Rutas ordenadas por cercanía',
  denied: 'No se pudo obtener tu ubicación: has denegado el permiso. Actívalo en el navegador para ordenar por cercanía.',
  error: 'No se pudo obtener tu ubicación. Inténtalo de nuevo.',
  unsupported: 'Tu navegador no permite obtener la ubicación.',
}
const CATEGORY = { corta: 'Corta', larga: 'Larga' }
const GROUPS = { corta: 'Rutas cortas', larga: 'Rutas largas' }
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(d)
}

const km = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`
const orNA = (v: string | number | null) => (v === null || v === '' ? 'No publicado' : v)
const minutes = (m: number) => {
  const t = Math.max(5, Math.round(m / 4000 * 12) * 5)
  return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h ${t % 60} min`
}

function download(filename: string, gpx: string) {
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function useShare() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 3000)
    return () => clearTimeout(t)
  }, [msg])
  const share = async (title: string, url: string) => {
    if (navigator.share) {
      try { return await navigator.share({ title, url }) } catch (e) { if ((e as Error).name === 'AbortError') return }
    }
    try {
      await navigator.clipboard.writeText(url)
      setMsg('Enlace copiado')
    } catch {
      window.prompt('Copia el enlace', url)
      setMsg('No se pudo copiar el enlace')
    }
  }
  return [msg, share] as const
}

export type PoiPanel = {
  active: Set<PoiCategory>
  toggle: (c: PoiCategory) => void
  status: 'idle' | 'loading' | 'error' | 'ready'
  metadata: Metadata | null
  matches: PoiFeature[]
  focus: (f: PoiFeature) => void
}

const Badge = ({ c }: { c: PoiCategory }) => <i className="poi-badge" style={{ background: POI_CATEGORIES[c].color }} aria-hidden="true">{POI_CATEGORIES[c].letter}</i>

export type Planner = { points: Position[]; path: Position[]; canUndo: boolean; undo: () => void; clear: () => void; exit: () => void; addCenter: () => void; message?: string }

const summary = (p: RouteFeature['properties']) =>
  [CATEGORY[p.category], p.type, p.elevationGainM !== null && `dif. altitud ${p.elevationGainM} m (oficial)`].filter(Boolean).join(' · ')

type Props = {
  data: RoutesData
  visible: RouteFeature[]
  filters: Filters
  onFiltersChange: (f: Filters) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  distances: Map<string, number> | null
  locateStatus: LocateStatus
  onLocate: () => void
  planner: Planner | null
  onPlan: (seed?: Position[]) => void
  network: Pick<Network, 'route'>
  pois: PoiPanel
  elevation?: ElevationData | null
  notice?: string
}

export function Panel({ data, visible, filters, onFiltersChange, selectedId, onSelect, distances, locateStatus, onLocate, planner, onPlan, network, pois, elevation = null, notice }: Props) {
  const [open, setOpen] = useState(true)
  const [full, setFull] = useState(false)
  const props = data.routes.map((r) => r.properties)
  const municipalities = distinct(props.flatMap((p) => p.municipalities))
  const types = distinct(props.map((p) => p.type))
  const hasGain = props.some((p) => p.elevationGainM !== null)
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onFiltersChange({ ...filters, [k]: e.target.value })
  const active = Object.entries(filters).filter(([k, v]) => k !== 'type' && v).length
  const [filtersOpen] = useState(() => !window.matchMedia?.('(max-width: 767px)').matches)
  const routesHeading = useRef<HTMLHeadingElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const planning = !!planner
  const wasPlanning = useRef(planning)
  useEffect(() => {
    if (wasPlanning.current && !planning) createButton.current?.focus()
    wasPlanning.current = planning
  }, [planning])

  const [prevSelected, setPrevSelected] = useState(selectedId)
  if (prevSelected !== selectedId) {
    setPrevSelected(selectedId)
    if (selectedId) setOpen(true)
  }

  useEffect(() => {
    if (!selectedId) return
    document.getElementById(`route-${selectedId}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  return (
    <main className="panel" data-open={open} data-full={full} data-planning={!!planner}>
      <header className="panel-header">
        <h1>Arco Verde Explorer</h1>
        <button type="button" className="sheet-toggle" aria-label={open ? 'Ocultar panel' : 'Mostrar panel'} aria-expanded={open} aria-controls="panel-body" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
        <button type="button" className="sheet-toggle" aria-label="Ampliar panel" aria-pressed={full} onClick={() => { setFull(!full); setOpen(true) }}>
          Ampliar
        </button>
        <OfflineBanner />
      </header>

      <div id="panel-body" className="panel-body">
        {planner && <PlannerSection planner={{ ...planner, addCenter: () => { setFull(false); planner.addCenter() } }} />}
        {data.metadata && (
          <p className="intro">
            {data.routes.length} rutas oficiales del Arco Verde de la Comunidad de Madrid.{' '}
            <a href={data.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">Fuente oficial</a>
          </p>
        )}
        <details className="filters-box" open={filtersOpen}>
          <summary className="section-title">Filtros{active > 0 && ` (${active})`}</summary>
          <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
            <label className="wide">Buscar por nombre, municipio o lugar
              <input type="search" name="q" value={filters.q} onChange={set('q')} />
            </label>
            {pois.matches.length > 0 && (
              <div className="wide poi-results">
                <p id="poi-results-title">Lugares cercanos a las rutas</p>
                <ul aria-labelledby="poi-results-title">
                  {pois.matches.map((f) => (
                    <li key={f.properties.id}>
                      <button type="button" onClick={() => pois.focus(f)}>
                        <Badge c={f.properties.category} /> {f.properties.name} <small>· {POI_CATEGORIES[f.properties.category].one}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label>Municipio
              <select name="municipality" value={filters.municipality} onChange={set('municipality')}>
                <option value="">Todos</option>
                {municipalities.map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <label>Categoría
              <select name="category" value={filters.category} onChange={set('category')}>
                <option value="">Todas</option>
                <option value="corta">Corta</option>
                <option value="larga">Larga</option>
              </select>
            </label>
            <label>Distancia mín. (km)
              <input type="number" min="0" step="0.5" inputMode="decimal" name="minKm" value={filters.minKm} onChange={set('minKm')} />
            </label>
            <label>Distancia máx. (km)
              <input type="number" min="0" step="0.5" inputMode="decimal" name="maxKm" value={filters.maxKm} onChange={set('maxKm')} />
            </label>
            {hasGain && (
              <label>Dif. altitud máx. (m, oficial)
                <input type="number" min="0" step="50" inputMode="numeric" name="maxGain" value={filters.maxGain} onChange={set('maxGain')} />
              </label>
            )}
          </form>
        </details>

        {types.length > 0 && (
          <fieldset className="type-chips">
            <legend>Tipo de ruta</legend>
            {['', ...types].map((t) => (
              <label key={t || 'all'}>
                <input type="radio" name="type" value={t} checked={filters.type === t} onChange={set('type')} />
                {t || 'Todas'}
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="type-chips poi-chips">
          <legend>Puntos de interés</legend>
          {(Object.keys(POI_CATEGORIES) as PoiCategory[]).map((c) => (
            <label key={c}>
              <input type="checkbox" checked={pois.active.has(c)} onChange={() => pois.toggle(c)} />
              <Badge c={c} /> {POI_CATEGORIES[c].label}
            </label>
          ))}
          <p role="status" className="poi-msg" data-error={pois.status === 'error'}>
            {pois.status === 'loading' ? 'Cargando puntos de interés…' : pois.status === 'error' ? 'No se pudieron cargar los puntos de interés. Desactívala y vuelve a activarla para reintentar.' : ''}
          </p>
        </fieldset>

        <div className="nearby">
          <button type="button" onClick={() => locateStatus !== 'loading' && onLocate()} aria-disabled={locateStatus === 'loading'}>Cerca de mí</button>
          <p role="status" className="locate-msg" data-error={locateStatus !== 'idle' && locateStatus !== 'loading' && locateStatus !== 'done'}>{LOCATE_MESSAGES[locateStatus]}</p>
          <p role="status" className="locate-msg" data-error="true">{notice}</p>
        </div>

        {!planner && (
          <section>
            <h2 className="section-title">Crear ruta</h2>
            <p className="note">Dibuja tu propio recorrido sobre los caminos de Arco Verde.</p>
            <button type="button" ref={createButton} onClick={() => onPlan()}>Crear ruta</button>
          </section>
        )}

        <h2 className="section-title" id="routes-heading" tabIndex={-1} ref={routesHeading}>Rutas</h2>
        <p className="count" aria-live="polite" aria-atomic="true">{visible.length} de {data.routes.length} rutas</p>
        <p className="legend">
          <span><i className="swatch" /> Red oficial</span>
          <span><i className="swatch selected" /> Ruta seleccionada</span>
          <span><i className="dot start" /><i className="dot end" /> Inicio / Fin</span>
        </p>

        {visible.length === 0 && (
          <div className="empty">
            <p>Ninguna ruta coincide con los filtros{pois.matches.length > 0 && `, pero hay ${pois.matches.length === 1 ? 'un lugar' : `${pois.matches.length} lugares`} con ese nombre en «Lugares cercanos a las rutas», junto al buscador`}</p>
            <button type="button" onClick={() => { onFiltersChange(emptyFilters); routesHeading.current?.focus() }}>Limpiar filtros</button>
          </div>
        )}

        {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((c) => {
          const routes = visible.filter((f) => f.properties.category === c)
          return routes.length > 0 && (
            <section key={c}>
              <h3 className="section-title subsection">{GROUPS[c]} ({routes.length})</h3>
              <ul className="route-list">
                {routes.map((feature) => { const p = feature.properties; return (
                <li key={p.id} id={`route-${p.id}`}>
                  <button type="button" className="route-item" aria-expanded={p.id === selectedId} onClick={() => onSelect(p.id === selectedId ? null : p.id)}>
                    <span className="route-id">{p.id}</span>
                    <span className="route-name">{p.name}
                      <small className="route-meta">{summary(p)}{distances?.has(p.id) && ` · a ${km(distances.get(p.id)!)}`}</small>
                    </span>
                    <span className="route-km">{km(p.distanceKm ?? p.computedLengthKm)}</span>
                  </button>
                  {p.id === selectedId && <Details route={feature} network={network} metadata={data.metadata} onPlan={onPlan} elevation={elevation?.routes[p.id] ? { meta: elevation.metadata, profile: elevation.routes[p.id] } : null} />}
                </li>
                )})}
              </ul>
            </section>
          )
        })}

        <footer className="attribution">
          {data.metadata && (
            <p>
              Datos: <a href={data.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">{data.metadata.source}</a>,
              extraído el {longDate(data.metadata.extractedAt)}.
            </p>
          )}
          <p>
            Puntos de interés a menos de 300 m de las rutas: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, ODbL
            {pois.metadata && `, extraídos el ${longDate(pois.metadata.extractedAt)}`}. Información comunitaria, no oficial.
          </p>
          <p>No implica respaldo de la Comunidad de Madrid.</p>
        </footer>
      </div>
    </main>
  )
}

const pageUrl = (hash: string) => `${location.href.split('#')[0]}${hash}`
const meters = (n: number) => `${n.toLocaleString('es-ES')} m`
const gainText = (p: Pick<Profile, 'gainM' | 'lossM'>) => `+${meters(p.gainM)} / −${meters(p.lossM)}`

function ElevationProfile({ data: { profile, minM, maxM, gainM, lossM }, label }: { data: Profile; label: string }) {
  const W = 320, H = 130, L = 44, R = 8, T = 10, B = 104
  const total = profile.at(-1)![0]
  const span = Math.max(maxM - minM, 50)
  const lo = (minM + maxM - span) / 2
  const x = (d: number) => L + (total ? d / total : 0) * (W - L - R)
  const y = (e: number) => B - ((e - lo) / span) * (B - T)
  const line = profile.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ')
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: altitud entre ${meters(minM)} y ${meters(maxM)} a lo largo de ${km(total)}; desnivel ${gainText({ gainM, lossM })}`}>
      <polygon points={`${x(0)},${B} ${line} ${x(total)},${B}`} className="profile-area" />
      <polyline points={line} className="profile-line" />
      <line x1={L} y1={B} x2={W - R} y2={B} className="profile-axis" />
      <line x1={L} y1={T} x2={L} y2={B} className="profile-axis" />
      <text x={L - 4} y={y(maxM) + 4} textAnchor="end">{meters(maxM)}</text>
      <text x={L - 4} y={y(minM) + 4} textAnchor="end">{meters(minM)}</text>
      <text x={L} y={H - 8} textAnchor="start">0 km</text>
      <text x={W - R} y={H - 8} textAnchor="end">{km(total)}</text>
    </svg>
  )
}

function ElevationNote({ meta }: { meta: ElevationMeta }) {
  return (
    <p className="note">
      Los tracks oficiales no incluyen altitud. Perfil y desnivel son un cálculo propio con el <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">{meta.source}</a> (malla
      de {meta.resolutionM} m, muestras cada {meta.sampleSpacingM} m, {meta.smoothing}), consultado el {longDate(meta.retrievedAt)}; {meta.attribution}, <a href={meta.licenceUrl} target="_blank" rel="noopener noreferrer">{meta.licence}</a>.
      Es aproximado: el modelo no recoge puentes ni pasos inferiores y el resultado depende del suavizado.
    </p>
  )
}

const PLAN_MAX_TILES = 4
const planTiles = new Map<string, Grid>()
type PlanElevation = { key: string; profile: Profile | null; reason?: string }

function usePlanElevation(points: Position[]): PlanElevation | null {
  const key = planHash(points)
  const online = useOnline()
  const samples = useMemo(() => sampleLines([points]), [points])
  const tooLarge = new Set(samples.map((s) => tileKey(s.p))).size > PLAN_MAX_TILES
  const [result, setResult] = useState<PlanElevation | null>(null)
  useEffect(() => {
    if (samples.length < 2 || tooLarge) return
    const ctrl = new AbortController()
    const get = (url: string) => fetch(url, { signal: ctrl.signal }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text() })
    const timer = setTimeout(() => {
      lookupElevations(samples.map((s) => s.p), get, planTiles)
        .then((z) => setResult({ key, profile: buildProfile(samples, z) }))
        .catch(() => { if (!ctrl.signal.aborted) setResult({ key, profile: null, reason: 'no se pudo consultar el modelo del terreno' }) })
    }, 800)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [samples, tooLarge, key, online])
  if (samples.length < 2) return { key, profile: null }
  if (tooLarge) return { key, profile: null, reason: 'trazado demasiado extenso para calcularlo en el navegador' }
  return result?.key === key ? result : null
}

function PlannerSection({ planner: { points, path, canUndo, undo, clear, exit, addCenter, message } }: { planner: Planner }) {
  const [shareMsg, share] = useShare()
  const m = planMeters(path)
  const ele = usePlanElevation(path)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const status = `${points.length} ${points.length === 1 ? 'punto' : 'puntos'}, ${km(m / 1000)}`
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(status), 1000)
    return () => clearTimeout(t)
  }, [status])
  return (
    <section className="planner" aria-labelledby="planner-heading">
      <h2 className="section-title" id="planner-heading" tabIndex={-1} ref={heading}>Crear ruta</h2>
      <p className="note">Toca o haz clic en el mapa, o usa «Añadir punto en el centro del mapa»: cada punto se ajusta al camino oficial más cercano (a menos de 300 m) y se une al anterior siguiendo los caminos oficiales. Pulsa un punto (o Intro) para eliminarlo; arrástralo para moverlo.</p>
      <p role="status" className="locate-msg" data-error="true">{message}</p>
      <p role="status" className="visually-hidden">{announced}</p>
      <div className="actions">
        <button type="button" onClick={addCenter} disabled={points.length >= MAX_POINTS}>Añadir punto en el centro del mapa</button>
        <button type="button" onClick={undo} disabled={!canUndo}>Deshacer</button>
        <button type="button" onClick={clear} disabled={!points.length}>Borrar</button>
        <button type="button" onClick={exit}>Salir</button>
        <button type="button" className="btn primary" disabled={points.length < 2} onClick={() => download('arco-verde-trazado.gpx', toGpx('Trazado manual', planLine(path)))}>Descargar GPX</button>
        <button type="button" disabled={!points.length} onClick={() => share('Trazado manual', pageUrl(planHash(points)))}>Compartir</button>
        <span role="status" className="note">{shareMsg}</span>
      </div>
      <p><strong>Distancia: {km(m / 1000)}</strong> · {points.length} {points.length === 1 ? 'punto' : 'puntos'}{points.length >= MAX_POINTS && ` (máximo ${MAX_POINTS})`}</p>
      <p>
        {points.length > 1 && <>
          Desnivel estimado:{' '}
          {!ele ? 'calculando…'
            : ele.profile ? <>{gainText(ele.profile)} <small>(altitud {meters(ele.profile.minM)}–{meters(ele.profile.maxM)}, modelo digital del terreno MDT25 © IGN, CC BY 4.0, consultado al dibujar)</small></>
            : `no disponible${ele.reason ? ` (${ele.reason})` : ''}`}
        </>}
      </p>
      {ele?.profile && <ElevationProfile data={ele.profile} label="Perfil de elevación estimado" />}
      {points.length > 1 && <p>Duración estimada: {minutes(m)} <small>(a 4 km/h, sin paradas ni desnivel)</small></p>}
      <p className="warnings" role="note">Trazado manual — no es una ruta validada. Sigue los tracks oficiales de Arco Verde, que pueden incluir tramos por carretera o variantes; revisa el recorrido antes de salir.</p>
    </section>
  )
}

type RouteElevation = { meta: ElevationMeta; profile: Profile } | null

function Details({ route, network, metadata, onPlan, elevation }: { route: RouteFeature; network: Pick<Network, 'route'>; metadata: Metadata | null; onPlan: (seed?: Position[]) => void; elevation: RouteElevation }) {
  const p = route.properties
  const [more, setMore] = useState(false)
  const [shareMsg, share] = useShare()
  const directions = directionsUrls(route.geometry, p.type)
  const start = routeEnds(route.geometry)?.start
  const long = (p.description?.length ?? 0) > 280
  const online = useOnline()
  const external = (href: string, label: string) => online
    ? <a className="btn" href={href} target="_blank" rel="noopener noreferrer">{label}</a>
    : <a className="btn" role="link" aria-disabled="true">{label} (requiere conexión)</a>
  const seed = (start: Position) => {
    const saved = openableDraft(network)?.length ?? 0
    if (!saved || window.confirm(`Ya tienes un trazado guardado de ${saved} ${saved === 1 ? 'punto' : 'puntos'}. ¿Sustituirlo por uno nuevo desde esta ruta?`)) onPlan([start])
  }
  return (
    <article className="details" aria-label={`Detalles de ${p.name}`}>
      <h3>{p.name} <span className="route-id">{p.id}</span></h3>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => download(`arco-verde-${p.id}.gpx`, toGpx(`${p.id} ${p.name}`, route.geometry))}>Descargar GPX</button>
        {directions && external(directions.toStart, 'Cómo llegar al inicio')}
        {directions?.fromEnd && external(directions.fromEnd, 'Volver desde el final')}
        {p.planUrl && external(p.planUrl, 'Plano (PDF)')}
        <button type="button" onClick={() => share(p.name, pageUrl(`#${p.id}`))}>Compartir</button>
        {start && <button type="button" onClick={() => seed(start)}>Empezar desde esta ruta</button>}
        <span role="status" className="note">{shareMsg}</span>
      </div>
      {p.notice && <p className="warnings" role="note"><strong>Aviso oficial:</strong> {p.notice}</p>}
      {p.warnings && <p className="warnings" role="note"><strong>Precauciones:</strong> {p.warnings}</p>}
      <dl>
        <dt>Categoría</dt><dd>{CATEGORY[p.category]}</dd>
        <dt>Distancia oficial</dt><dd>{p.distanceKm === null ? 'No publicada' : km(p.distanceKm)}</dd>
        <dt>Longitud calculada</dt>
        <dd>
          {km(p.computedLengthKm)} <small>(calculada a partir del track)</small>
          {lengthMismatch(p) && <small className="mismatch">El track oficial no coincide con la distancia publicada (puede estar incompleto o incluir variantes).</small>}
        </dd>
        <dt>Desnivel oficial (diferencia de altitud)</dt><dd>{p.elevationGainM === null ? 'No publicado' : `${p.elevationGainM} m`}</dd>
        {elevation && (
          <>
            <dt>Desnivel calculado</dt><dd>{gainText(elevation.profile)} <small>(modelo digital del terreno {elevation.meta.source})</small></dd>
            <dt>Altitud calculada</dt><dd>{meters(elevation.profile.minM)} – {meters(elevation.profile.maxM)}</dd>
          </>
        )}
        <dt>Tipo</dt><dd>{orNA(p.type)}</dd>
        <dt>Sector</dt><dd>{orNA(p.sector)}</dd>
        <dt>Municipios</dt><dd>{orNA(p.municipalities.join(', '))}</dd>
      </dl>
      {elevation && <ElevationProfile data={elevation.profile} label="Perfil de elevación calculado" />}
      {metadata && (
        <p className="note">
          Datos oficiales: <a href={metadata.sourceUrl} target="_blank" rel="noopener noreferrer">{metadata.source}</a>, extraídos el {longDate(metadata.extractedAt)}.
          La longitud calculada es un cálculo propio.
        </p>
      )}
      <p className="note">
        Puedes importarlo en Strava (web: Mis rutas → Crear ruta → subir archivo) o abrirlo con Wikiloc, OsmAnd u otra app de rutas.
        Es el track oficial sin puntos duplicados y simplificado con un margen de unos 5 m; también está el <a href={p.gpxUrl} target="_blank" rel="noopener noreferrer">GPX original</a>.
      </p>
      <div id={`desc-${p.id}`} className="desc" data-collapsed={long && !more}>
        {p.description?.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
      </div>
      {long && <button type="button" aria-expanded={more} aria-controls={`desc-${p.id}`} onClick={() => setMore(!more)}>{more ? 'Leer menos' : 'Leer más'}</button>}
      {elevation ? <ElevationNote meta={elevation.meta} /> : (
        <p className="note">Los tracks oficiales no incluyen datos de altitud; no se muestra perfil de elevación.</p>
      )}
    </article>
  )
}
