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

Tres formas de encenderlo, todas equivalentes:

- **Desde el dashboard** (la cómoda): botón **📣 Facebook** → **Iniciar
  publicador**. Requiere el paso único de abajo.
- **Doble click** en `Iniciar-Publicador.bat`.
- `npm start` en una terminal.

### Paso único para que el botón del dashboard funcione

```bash
npm run install-launcher
```

Registra el enlace `revolt-fb://` solo para tu usuario de Windows (no toca
nada del sistema). Siempre abre el mismo `Iniciar-Publicador.bat` e ignora lo
que venga después del enlace, así que una página web no puede pasarle nada a
tu PC. La primera vez, el navegador pregunta si abrir "Publicador de
Facebook": aceptá y marcá "Permitir siempre". Para sacarlo:
`npm run uninstall-launcher`.

### Qué hace

Revisa la cola (tabla `publications`, columna `facebook_status = 'queued'`)
cada `POLL_INTERVAL_SECONDS`. Por cada publicación pendiente: abre una pestaña,
llena el formulario, y — con `FB_CONFIRM_BEFORE_POST=true` (default) — te
muestra **dentro de la ventana de Facebook**, abajo a la derecha, un panel con
el título y dos botones: **Publicar** o **Saltear** (queda `failed` con motivo
"Salteado a mano"). Cerrar la pestaña también cuenta como saltear. Si no se
puede dibujar el panel, cae al prompt de la terminal (Enter publica, `n` +
Enter saltea). Con `FB_DRY_RUN=true` llena el formulario y para ahí, sin
publicar nada; sirve para ajustar selectores sin arriesgarte.

Mientras corre avisa su estado a la tabla `publisher_status` cada 10 s
(libre / trabajando / esperando tu click); el dashboard lo muestra con un
punto de color y dice "apagado" si pasan 30 s sin latido. Solo puede haber una
instancia: dos Chromium no pueden compartir tu sesión de Facebook, así que si
ya hay uno encendido, el segundo avisa y se cierra.

`Ctrl+C` (o cerrar la ventana de la consola) corta el proceso entero,
navegador incluido. Ya no hace falta para confirmar nada: usalo solo para
salir de todo, porque los jobs que falten procesar en esa pasada van a fallar
con "el navegador ya se cerró".

Las pruebas que no tocan Facebook: `npx tsx scripts/try-overlay.ts` (el panel
Publicar/Saltear sobre una página local) y `npx tsx scripts/try-reporter.ts`
(latido y candado contra Supabase).

Un job que falla queda marcado `failed` con el motivo en la columna
`facebook_error` — no vuelve a la cola solo; si lo arreglás (o solo lo
salteaste), el botón **Reintentar** del panel Facebook del dashboard lo vuelve
a poner en fila.

## Depurar cuando algo se traba o falla

La terminal va imprimiendo en qué paso está (`navegando…`, `campo Título…`,
`menú Categoría…`, etc.) — si parece "pegado", mirá la última línea impresa:
esa acción falla sola en 10 segundos como mucho, no se cuelga para siempre.

`runs/` va quedando con capturas en cada corrida:
- `NNN-01-cargada-*.png`: cómo se ve la página apenas navega a Marketplace.
  Si acá ya se ve en blanco o pide algo raro, es un problema de Facebook
  (checkpoint de verificación, aviso de cookies tapando todo, sesión vencida
  — corré `npm run login` de nuevo), no del código.
- `NNN-listo-para-publicar-*.png`: el formulario ya completo, antes de tocar
  publicar.
- `NNN-error-*.png`: dónde se frenó si algo falló.

Facebook cambia el formulario de Marketplace seguido. `facebook-driver.ts`
busca los campos por rol/etiqueta accesible (`getByLabel`, `getByRole`) en vez
de clases CSS, que es lo más estable que hay, pero no es inmune a cambios.
Con `FB_DRY_RUN=true`, corré `npm start`, mirá la captura del paso que falló
y el mensaje de error (para categoría/condición, lista lo que sí encontró) y
ajustá el selector de ese paso puntual en `fillForm`.
