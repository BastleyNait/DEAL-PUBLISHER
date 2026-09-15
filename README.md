# DEAL PUBLISHER

Worker local que toma publicaciones ya confirmadas en el dashboard (ver
`+ Publicar` en DEAL WEB) y las postea en Facebook Marketplace, con tu propia
sesión de Facebook en tu PC.

## Por qué corre en tu PC y no en la nube

Facebook Marketplace no tiene una API para crear publicaciones — nunca la
tuvo. Este worker automatiza tu navegador con tu sesión real, y eso solo
existe en una máquina con navegador y con vos logueado. Publicar automatizado
e invisible (headless, en un servidor) es justo el patrón que Meta banea;
por eso corre con la ventana visible, de a una publicación por vez, y con
confirmación tuya antes de publicar por defecto.

**Esto no está probado contra Facebook real.** El código está escrito y
compila, pero los selectores del formulario de Marketplace (`facebook-driver.ts`)
no se pudieron verificar en vivo — hace falta una cuenta de Facebook real para
eso, y quien armó esto no tiene acceso a la tuya. La primera corrida probablemente
necesite un ajuste en algún selector: cuando un paso falla, queda una captura
de pantalla en `runs/` mostrando exactamente dónde se frenó.

## Instalación

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Completá `.env`: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son los mismos
del proyecto DEAL HUNTER (Dashboard de Supabase → Project Settings → API →
`service_role`, no el `anon`). `FB_LOCATION` es la ciudad que va a aparecer en
el aviso.

## Primer uso

```bash
npm run login
```

Se abre un Chromium. Entrá a Facebook a mano, como cualquier login. Cuando
veas tu feed cargado, volvé a la terminal y presioná Enter — la sesión queda
guardada en `.fb-session/` (nunca se sube a git, ver `.gitignore`).

## Uso normal

```bash
npm start
```

Revisa la cola (tabla `publications`, columna `facebook_status = 'queued'`)
cada `POLL_INTERVAL_SECONDS`. Por cada publicación pendiente: abre una pestaña,
llena el formulario, y — con `FB_CONFIRM_BEFORE_POST=true` (default) — espera
que apretés Enter en la terminal antes de tocar el botón de publicar. Con
`FB_DRY_RUN=true` llena el formulario y para ahí, sin publicar nada; sirve
para ajustar selectores sin arriesgarte.

`Ctrl+C` para parar. Un job que falla queda marcado `failed` con el motivo en
la columna `facebook_error` — no vuelve a la cola solo; si lo arreglás, un
`update publications set facebook_status = 'queued' where item_id = '...'` lo
vuelve a poner en fila.

## Si un selector se rompió

Facebook cambia el formulario de Marketplace seguido. `facebook-driver.ts`
busca los campos por rol/etiqueta accesible (`getByLabel`, `getByRole`) en vez
de clases CSS, que es lo más estable que hay, pero no es inmune a cambios.
Con `FB_DRY_RUN=true`, corré `npm start`, mirá la captura en `runs/` del paso
que falló, y ajustá el selector de ese paso puntual en `fillForm`.
