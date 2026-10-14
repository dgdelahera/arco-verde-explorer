# Arco Verde Explorer

Visor web de los 36 recorridos de [Arco Verde](https://www.comunidad.madrid/medio-ambiente/arco-verde), la infraestructura verde de la Comunidad de Madrid: mapa, listado con filtros, ficha de cada ruta, GPX descargable y enlaces de transporte público al inicio y desde el final.

Es una web estática (React + TypeScript + Leaflet) servida con nginx. No tiene backend.

## Datos

`npm run data` descarga la página oficial y los GPX, y genera `public/data/routes.geojson` (formato en [docs/data-contract.md](docs/data-contract.md)). El fichero se versiona; vuelve a ejecutarlo cuando la Comunidad actualice las rutas.

- Los atributos (nombre, municipios, distancia, desnivel, tipo, sector, precauciones, descripción) se copian tal cual de la página. Lo que no se publica queda vacío.
- La geometría viene de los GPX oficiales, sin puntos duplicados y simplificada solo para dibujarla. La "longitud calculada" se mide sobre el track sin simplificar y se muestra junto a la distancia oficial. En RL2, RL7, RL9, RL18 y RL22 no coinciden porque los GPX publicados son así.
- Los GPX oficiales no traen altitud, así que no hay perfil de elevación. Se muestra el desnivel oficial.
- "Descargar GPX" genera en el navegador un GPX con el nombre de la ruta a partir de esa geometría depurada (margen de unos 5 m). El GPX original de comunidad.madrid sigue enlazado en la ficha.

Fuente: Comunidad de Madrid, comunidad.madrid/medio-ambiente/arco-verde. Mapa base © OpenStreetMap contributors.

## Desarrollo

```bash
npm ci
npm run dev       # http://localhost:5173
npm test
npm run build
```

## Imagen

Cada push a `main` pasa tests, lint y build, crea un tag semver y publica `ghcr.io/dgdelahera/arco-verde-explorer:<tag>`. Las PR solo construyen la imagen. Se despliega desde `dgdelahera/infra-homelab` en https://arco-verde.dgdelahera.com.
