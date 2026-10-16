# Despliegue en Cloudflare

La página se publica como un Cloudflare Worker porque también sirve `/api/data`, que obtiene los equipos y calendarios actuales.

Ejecuta estos comandos desde `Ahc_web/amics-handbol-la-canonja`.

1. Instala las dependencias con `npm install`.
2. Inicia sesión en Cloudflare con `npx wrangler login`.
3. Ejecuta `npm run deploy`.

Wrangler publica el sitio en la dirección `*.workers.dev` de la cuenta. Para usar un dominio propio, primero hay que añadirlo a la cuenta de Cloudflare y asociarlo al Worker desde el panel de Cloudflare.
