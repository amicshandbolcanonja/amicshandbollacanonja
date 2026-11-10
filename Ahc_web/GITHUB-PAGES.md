# Publicar en GitHub Pages

El workflow de GitHub Pages está en la raíz del repositorio (`.github/workflows/deploy-pages.yml`), fuera de `Ahc_web`, porque GitHub solo detecta workflows en esa ubicación. Publica la web al actualizar `main` y programa la actualización de calendarios y PDF cada 15 minutos (GitHub puede retrasar las ejecuciones programadas).

GitHub Pages solo sirve archivos estáticos. Cada publicación consulta iSquad, conserva las jornadas oficiales y genera un PDF en catalán y castellano por jornada y liga. Cada PDF incluye todos los clubes del grupo, marcadores, descansos, partidos pendientes y los horarios y pistas que se conocen. Los enlaces mantienen su ruta y se renuevan en cada publicación. Los archivos descargados son una copia: hay que descargarlos de nuevo para obtener resultados posteriores.

Para generar el sitio localmente, ejecuta `npm ci` y `npm run build:pages` con Node.js 22.13 o superior desde `Ahc_web/amics-handbol-la-canonja`. El resultado incluye los archivos `dist/pdfs/` y sus enlaces en `dist/api/data.json`. La publicación de Cloudflare Worker sigue disponible con `npm run deploy` y consulta los datos en directo; la vía alternativa de exportaciones y los PDF se procesan en la compilación de Pages.

Si el portal HTML de iSquad no está disponible, Pages lee los PDF oficiales de cada grupo y actualiza los marcadores de todos los partidos. Usa el torneo de la última copia válida de cada equipo y valida que coincidan las jornadas, el recuento de partidos y los cruces del club. Los PDF oficiales no incluyen horas, pistas, plantillas ni clasificación: se mantienen los últimos datos conocidos, con una fecha separada para los horarios, pistas y clasificación. `dist/api/league-details.json` guarda los detalles públicos de los partidos para futuras actualizaciones.

Si las dos fuentes de iSquad fallan en una ejecución programada, no se publica nada y se conserva la web anterior. Al subir cambios a `main` o iniciar el workflow manualmente, la compilación puede usar la última copia pública de los calendarios y PDF sin cambiar la fecha de sincronización. Si Instagram no devuelve ninguna publicación, se intenta recuperar la última galería pública del club.

Para permitir esa alternativa en una compilación local de PowerShell: `$env:AHC_USE_PUBLISHED_SNAPSHOT = '1'; npm run build:pages`.
