# Publicar en GitHub Pages

El workflow de GitHub Pages está en la raíz del repositorio (`.github/workflows/deploy-pages.yml`), fuera de `Ahc_web`, porque GitHub solo detecta workflows en esa ubicación. Publica la web al actualizar `main` y vuelve a generar los calendarios cada hora.

GitHub Pages solo sirve archivos estáticos. Por eso, cada publicación consulta iSquad y guarda una copia de los calendarios en el sitio. La web conserva los equipos, partidos y resultados, pero los datos se actualizan cuando termina la siguiente ejecución del workflow.

Para generar el sitio localmente, ejecuta `npm run build:pages` desde `Ahc_web/amics-handbol-la-canonja`. La publicación de Cloudflare Worker sigue disponible con `npm run deploy` y consulta los datos en directo.
