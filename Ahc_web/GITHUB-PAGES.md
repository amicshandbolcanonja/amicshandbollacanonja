# Publicar en GitHub Pages

El workflow de GitHub Pages está en la raíz del repositorio (`.github/workflows/deploy-pages.yml`), fuera de `Ahc_web`, porque GitHub solo detecta workflows en esa ubicación. Publica la web al actualizar `main` y programa la actualización de calendarios y PDF cada 15 minutos (GitHub puede retrasar las ejecuciones programadas).

GitHub Pages solo sirve archivos estáticos. Cada publicación consulta iSquad, conserva las jornadas oficiales y genera un PDF en catalán y castellano por jornada y liga. Cada PDF incluye todos los clubes del grupo, marcadores, horarios, pistas, descansos, partidos pendientes y fecha de actualización. Los enlaces mantienen su ruta y se renuevan en cada publicación. Los archivos descargados son una copia: hay que descargarlos de nuevo para obtener resultados posteriores.

Para generar el sitio localmente, ejecuta `npm ci` y `npm run build:pages` desde `Ahc_web/amics-handbol-la-canonja`. El resultado incluye los archivos `dist/pdfs/` y sus enlaces en `dist/api/data.json`. La publicación de Cloudflare Worker sigue disponible con `npm run deploy` y consulta los datos en directo; los PDF se generan en la compilación de Pages.

Si iSquad falla durante una ejecución programada, no se publica nada y se conserva la web anterior. Al subir cambios a `main` o iniciar el workflow manualmente, la compilación puede usar la última copia pública de los calendarios si contiene todos los equipos. Conserva la fecha real de sincronización y los PDF: los vuelve a generar si la copia incluye todos los partidos, o copia los PDF publicados si solo incluye sus enlaces. Si tampoco puede recuperarlos, no publica. Si Instagram no devuelve ninguna publicación, en esos despliegues se intenta recuperar la última galería pública del club.

Para permitir esa alternativa en una compilación local de PowerShell: `$env:AHC_USE_PUBLISHED_SNAPSHOT = '1'; npm run build:pages`.
