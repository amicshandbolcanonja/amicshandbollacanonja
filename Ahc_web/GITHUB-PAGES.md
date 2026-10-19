# Publicar en GitHub Pages

El workflow de GitHub Pages está en la raíz del repositorio (`.github/workflows/deploy-pages.yml`), fuera de `Ahc_web`, porque GitHub solo detecta workflows en esa ubicación. Publica la web al actualizar `main` y programa la actualización de calendarios y PDF cada 15 minutos (GitHub puede retrasar las ejecuciones programadas).

GitHub Pages solo sirve archivos estáticos. Cada publicación consulta iSquad, conserva las jornadas oficiales y genera un PDF en catalán y castellano por jornada y liga. Cada PDF incluye todos los clubes del grupo, marcadores, horarios, pistas, descansos, partidos pendientes y fecha de actualización. Los enlaces mantienen su ruta y se renuevan en cada publicación. Los archivos descargados son una copia: hay que descargarlos de nuevo para obtener resultados posteriores.

Para generar el sitio localmente, ejecuta `npm ci` y `npm run build:pages` desde `Ahc_web/amics-handbol-la-canonja`. El resultado incluye los archivos `dist/pdfs/` y sus enlaces en `dist/api/data.json`. Si una consulta de calendario falla, la compilación se interrumpe para conservar la versión publicada. La publicación de Cloudflare Worker sigue disponible con `npm run deploy` y consulta los datos en directo; los PDF se generan en la compilación de Pages.
