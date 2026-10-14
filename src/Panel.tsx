import { useEffect, useState } from 'react'
import { distinct, emptyFilters, lengthMismatch, type Filters, type RouteFeature, type RoutesData } from './filters'
import { startDirectionsUrl } from './geo'

export type LocateStatus = 'idle' | 'loading' | 'done' | 'denied' | 'error' | 'unsupported'
const LOCATE_MESSAGES: Partial<Record<LocateStatus, string>> = {
  loading: 'Buscando tu ubicación…',
  done: 'Rutas ordenadas por cercanía',
  denied: 'No se pudo obtener tu ubicación: has denegado el permiso. Actívalo en el navegador para ordenar por cercanía.',
  error: 'No se pudo obtener tu ubicación. Inténtalo de nuevo.',
  unsupported: 'Tu navegador no permite obtener la ubicación.',
}
const CATEGORY = { corta: 'Corta', larga: 'Larga' }
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(d)
}

const km = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`
const orNA = (v: string | number | null) => (v === null || v === '' ? 'No publicado' : v)

type Props = {
  data: RoutesData
  visible: RouteFeature[]
  filters: Filters
  onFiltersChange: (f: Filters) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShowAll: () => void
  distances: Map<string, number> | null
  locateStatus: LocateStatus
  onLocate: () => void
}

export function Panel({ data, visible, filters, onFiltersChange, selectedId, onSelect, onShowAll, distances, locateStatus, onLocate }: Props) {
  const [open, setOpen] = useState(true)
  const [full, setFull] = useState(false)
  const props = data.routes.map((r) => r.properties)
  const municipalities = distinct(props.flatMap((p) => p.municipalities))
  const types = distinct(props.map((p) => p.type))
  const hasGain = props.some((p) => p.elevationGainM !== null)
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => onFiltersChange({ ...filters, [k]: e.target.value })

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
    <main className="panel" data-open={open} data-full={full}>
      <header className="panel-header">
        <h1>Arco Verde Explorer</h1>
        <button type="button" onClick={onShowAll}>Ver todas</button>
        <button type="button" className="sheet-toggle" aria-expanded={open} aria-controls="panel-body" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar panel' : 'Mostrar panel'}
        </button>
        <button type="button" className="sheet-toggle" aria-pressed={full} onClick={() => { setFull(!full); setOpen(true) }}>
          Ampliar panel
        </button>
      </header>

      <div id="panel-body" className="panel-body">
        {data.metadata && (
          <p className="intro">
            {data.routes.length} rutas oficiales del Arco Verde de la Comunidad de Madrid.{' '}
            <a href={data.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">Fuente oficial</a>
          </p>
        )}
        <h2 className="section-title">Filtros</h2>
        <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="wide">Buscar por nombre o municipio
            <input type="search" name="q" value={filters.q} onChange={set('q')} />
          </label>
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
          {types.length > 0 && (
            <label>Tipo
              <select name="type" value={filters.type} onChange={set('type')}>
                <option value="">Todos</option>
                {types.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          )}
          <label>Distancia mín. (km)
            <input type="number" min="0" step="0.5" inputMode="decimal" name="minKm" value={filters.minKm} onChange={set('minKm')} />
          </label>
          <label>Distancia máx. (km)
            <input type="number" min="0" step="0.5" inputMode="decimal" name="maxKm" value={filters.maxKm} onChange={set('maxKm')} />
          </label>
          {hasGain && (
            <label>Desnivel máx. (m)
              <input type="number" min="0" step="50" inputMode="numeric" name="maxGain" value={filters.maxGain} onChange={set('maxGain')} />
            </label>
          )}
        </form>

        <div className="nearby">
          <button type="button" onClick={onLocate} disabled={locateStatus === 'loading'}>Cerca de mí</button>
          <p role="status" className="locate-msg" data-error={locateStatus !== 'idle' && locateStatus !== 'loading' && locateStatus !== 'done'}>{LOCATE_MESSAGES[locateStatus]}</p>
        </div>

        <h2 className="section-title">Rutas</h2>
        <p className="count">
          <span aria-live="polite" aria-atomic="true">{visible.length} de {data.routes.length} rutas</span>
          <span className="legend"><i className="swatch corta" /> Corta <i className="swatch larga" /> Larga</span>
        </p>

        {visible.length === 0 && (
          <div className="empty">
            <p>Ninguna ruta coincide con los filtros</p>
            <button type="button" onClick={() => onFiltersChange(emptyFilters)}>Limpiar filtros</button>
          </div>
        )}

        <ul className="route-list">
          {visible.map((feature) => { const p = feature.properties; return (
            <li key={p.id} id={`route-${p.id}`}>
              <button type="button" className={`route-item ${p.category}`} aria-expanded={p.id === selectedId} onClick={() => onSelect(p.id === selectedId ? null : p.id)}>
                <span className="route-id">{p.id}</span>
                <span className="route-name">{p.name}
                  <small className="route-meta">{CATEGORY[p.category]}{distances?.has(p.id) && ` · a ${km(distances.get(p.id)!)}`}</small>
                </span>
                <span className="route-km">{km(p.distanceKm ?? p.computedLengthKm)}</span>
              </button>
              {p.id === selectedId && <Details route={feature} />}
            </li>
          )})}
        </ul>

        <footer className="attribution">
          {data.metadata && (
            <p>
              Datos: <a href={data.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">{data.metadata.source}</a>,
              extraído el {longDate(data.metadata.extractedAt)}.
            </p>
          )}
          <p>No implica respaldo de la Comunidad de Madrid.</p>
        </footer>
      </div>
    </main>
  )
}

function Details({ route }: { route: RouteFeature }) {
  const p = route.properties
  const [more, setMore] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const directions = startDirectionsUrl(route.geometry)
  const long = (p.description?.length ?? 0) > 280
  useEffect(() => {
    if (!shareMsg) return
    const t = setTimeout(() => setShareMsg(''), 3000)
    return () => clearTimeout(t)
  }, [shareMsg])
  const share = async () => {
    const url = `${location.href.split('#')[0]}#${p.id}`
    if (navigator.share) {
      try { return await navigator.share({ title: p.name, url }) } catch (e) { if ((e as Error).name === 'AbortError') return }
    }
    try {
      await navigator.clipboard.writeText(url)
      setShareMsg('Enlace copiado')
    } catch {
      window.prompt('Copia el enlace', url)
      setShareMsg('No se pudo copiar el enlace')
    }
  }
  return (
    <article className="details" aria-label={`Detalles de ${p.name}`}>
      <h3>{p.name} <span className="route-id">{p.id}</span></h3>
      <div className="actions">
        <a className="btn primary" href={p.gpxUrl} target="_blank" rel="noopener noreferrer">Descargar GPX (original)</a>
        {p.planUrl && <a className="btn" href={p.planUrl} target="_blank" rel="noopener noreferrer">Plano (PDF)</a>}
        {directions && <a className="btn" href={directions} target="_blank" rel="noopener noreferrer">Cómo llegar al inicio</a>}
        <button type="button" onClick={share}>Compartir</button>
        <span role="status" className="note">{shareMsg}</span>
      </div>
      <p className="note">Puedes importarlo en Strava (web: Mis rutas → Crear ruta → subir archivo) o abrirlo con Wikiloc, OsmAnd u otra app de rutas.</p>
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
        <dt>Desnivel oficial</dt><dd>{p.elevationGainM === null ? 'No publicado' : `${p.elevationGainM} m`}</dd>
        <dt>Tipo</dt><dd>{orNA(p.type)}</dd>
        <dt>Sector</dt><dd>{orNA(p.sector)}</dd>
        <dt>Municipios</dt><dd>{orNA(p.municipalities.join(', '))}</dd>
      </dl>
      <div id={`desc-${p.id}`} className="desc" data-collapsed={long && !more}>
        {p.description?.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
      </div>
      {long && <button type="button" aria-expanded={more} aria-controls={`desc-${p.id}`} onClick={() => setMore(!more)}>{more ? 'Leer menos' : 'Leer más'}</button>}
      <p className="note">Los tracks oficiales no incluyen datos de altitud; no se muestra perfil de elevación.</p>
    </article>
  )
}
