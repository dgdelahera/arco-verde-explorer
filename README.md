# Arco Verde Explorer

Visor web de los 36 recorridos de [Arco Verde](https://www.comunidad.madrid/medio-ambiente/arco-verde), la infraestructura verde de la Comunidad de Madrid: mapa, listado con filtros, ficha de cada ruta, GPX descargable y enlaces de transporte público al inicio y desde el final.

Es una web estática (React + TypeScript + Leaflet) servida con nginx. No tiene backend.

## Datos

`npm run data` descarga la página oficial y los GPX, genera `public/data/routes.geojson` y después calcula `public/data/elevation.json` y `public/data/hazards.geojson` (formato de todos en [docs/data-contract.md](docs/data-contract.md)). Los ficheros se versionan; vuelve a ejecutarlo cuando la Comunidad actualice las rutas. `npm run elevation` recalcula solo la elevación a partir del `routes.geojson` actual.

- Los atributos (nombre, municipios, distancia, desnivel, tipo, sector, precauciones, descripción) se copian tal cual de la página. Lo que no se publica queda vacío.
- La geometría viene de los GPX oficiales, sin puntos duplicados y simplificada solo para dibujarla. La "longitud calculada" se mide sobre el track sin simplificar y se muestra junto a la distancia oficial. En RL2, RL7, RL9, RL18 y RL22 no coinciden porque los GPX publicados son así.
- Los GPX oficiales no traen altitud. El perfil, el desnivel positivo/negativo y la altitud mínima/máxima se calculan muestreando el track cada 50 m sobre el MDT25 del IGN (malla de 25 m, PNOA-LiDAR, servicio WCS `servicios.idee.es/wcs-inspire/mdt`) con una media móvil de 5 muestras, y se muestran aparte del desnivel oficial. Es una aproximación: el modelo del terreno no recoge puentes ni pasos inferiores, y otro suavizado da cifras distintas (del orden de ±20 %). El desnivel oficial se parece más a la diferencia entre altitud máxima y mínima que a un desnivel acumulado, por eso no coinciden.
- En "Crear ruta" el navegador pide al mismo servicio del IGN las teselas que cubren el trazado (hasta 4 de 0,05°) y muestra un desnivel y perfil estimados; si no hay conexión o el trazado es mayor, aparece "no disponible".
- "Descargar GPX" genera en el navegador un GPX con el nombre de la ruta a partir de esa geometría depurada (margen de unos 5 m). El GPX original de comunidad.madrid sigue enlazado en la ficha.

Los avisos oficiales que nombran un lugar concreto (el Puente de la Marmota, el cruce de la M-618, el arroyo Tejada…) se marcan en el mapa con un triángulo ⚠, y con una línea discontinua cuando el aviso habla de un tramo entre dos sitios. La lista está en `scripts/prepare-hazards.ts`: cada aviso cita el texto oficial literal y el elemento de OpenStreetMap que nombra; `npm run hazards` lo sitúa sobre el track y falla si el texto ya no está en la página o si el lugar queda a más de 300 m de la ruta. La ubicación es aproximada. Los avisos que no nombran un sitio ("algunos tramos", "zonas industriales") solo aparecen en la ficha.

`npm run pois` hace una consulta a la Overpass API de OpenStreetMap y genera `public/data/pois.geojson`: fuentes de agua potable, merenderos y refugios, y estaciones de tren, Cercanías, Metro y Metro Ligero a menos de 300 m de algún track. También se versiona. En el mapa cada categoría se activa por separado y todas empiezan apagadas. El buscador encuentra también estos lugares por su nombre. Son datos comunitarios, no oficiales.

Fuente: Comunidad de Madrid, comunidad.madrid/medio-ambiente/arco-verde. Elevación: MDT25 © Instituto Geográfico Nacional, CC BY 4.0 scne.es. Mapa base y puntos de interés © OpenStreetMap contributors, bajo licencia [ODbL](https://www.openstreetmap.org/copyright).

## Desarrollo

```bash
npm ci
npm run dev       # http://localhost:5173
npm test
npm run build
```

## Imagen

Cada push a `main` pasa tests, lint y build, crea un tag semver y publica `ghcr.io/dgdelahera/arco-verde-explorer:<tag>`. Las PR solo construyen la imagen. Se despliega desde `dgdelahera/infra-homelab` en https://arco-verde.dgdelahera.com.
