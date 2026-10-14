import { useEffect, useState } from 'react'
import { distinct, type Filters, type RouteFeature, type RoutesData } from './filters'

const km = (n: number) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`
const orNA = (v: string | number | null) => (v === null || v === '' ? 'No publicado' : v)

type Props = {
  data: RoutesData
  visible: RouteFeature[]
  filters: Filters
  onFiltersChange: (f: Filters) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onShowAll: () => void
}

export function Panel({ data, visible, filters, onFiltersChange, selectedId, onSelect, onShowAll }: Props) {
  const [open, setOpen] = useState(true)
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
    <aside className="panel" data-open={open}>
      <header className="panel-header">
        <h1>Arco Verde Explorer</h1>
        <button type="button" onClick={onShowAll}>Ver todas</button>
        <button type="button" className="sheet-toggle" aria-expanded={open} aria-controls="panel-body" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar panel' : 'Mostrar panel'}
        </button>
      </header>

      <div id="panel-body" className="panel-body">
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

        <p className="count" aria-live="polite">
          {visible.length} de {data.routes.length} rutas
          <span className="legend"><i className="swatch corta" /> Corta <i className="swatch larga" /> Larga</span>
        </p>

        <ul className="route-list">
          {visible.map(({ properties: p }) => (
            <li key={p.id} id={`route-${p.id}`}>
              <button type="button" className={`route-item ${p.category}`} aria-expanded={p.id === selectedId} onClick={() => onSelect(p.id)}>
                <span className="route-id">{p.id}</span>
                <span className="route-name">{p.name}</span>
                <span className="route-km">{km(p.distanceKm ?? p.computedLengthKm)}</span>
              </button>
              {p.id === selectedId && <Details route={p} />}
            </li>
          ))}
        </ul>

        <footer className="attribution">
          {data.metadata && (
            <p>
              Datos: <a href={data.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">{data.metadata.source}</a>,
              extraído el {data.metadata.extractedAt}.
            </p>
          )}
          <p>No implica respaldo de la Comunidad de Madrid.</p>
        </footer>
      </div>
    </aside>
  )
}

function Details({ route: p }: { route: RouteFeature['properties'] }) {
  return (
    <article className="details" aria-label={`Detalles de ${p.name}`}>
      <h2>{p.name} <span className="route-id">{p.id}</span></h2>
      {p.warnings && <p className="warnings" role="note"><strong>Precauciones:</strong> {p.warnings}</p>}
      <dl>
        <dt>Distancia oficial</dt><dd>{p.distanceKm === null ? 'No publicada' : km(p.distanceKm)}</dd>
        <dt>Longitud calculada</dt><dd>{km(p.computedLengthKm)} <small>(calculada a partir del track)</small></dd>
        <dt>Desnivel oficial</dt><dd>{p.elevationGainM === null ? 'No publicado' : `${p.elevationGainM} m`}</dd>
        <dt>Tipo</dt><dd>{orNA(p.type)}</dd>
        <dt>Sector</dt><dd>{orNA(p.sector)}</dd>
        <dt>Municipios</dt><dd>{orNA(p.municipalities.join(', '))}</dd>
      </dl>
      {p.description?.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
      <p className="links">
        <a href={p.gpxUrl} target="_blank" rel="noopener noreferrer">Descargar GPX (original)</a>
        {p.planUrl && <a href={p.planUrl} target="_blank" rel="noopener noreferrer">Plano (PDF)</a>}
      </p>
      <p className="note">Los tracks oficiales no incluyen datos de altitud; no se muestra perfil de elevación.</p>
    </article>
  )
}
