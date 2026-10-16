import { useOnline } from './online'

// The live region stays mounted so screen readers announce the text when it appears.
export function OfflineBanner() {
  return <p className="offline" role="status">{useOnline() ? null : 'Sin conexión: mostrando datos guardados. El mapa base puede estar incompleto.'}</p>
}
