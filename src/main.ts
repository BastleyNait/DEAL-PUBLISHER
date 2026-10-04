/**
 * Composition root: arma Supabase + Playwright y los inyecta en PublishWorker.
 * Corre en tu PC, no en la nube — necesita tu sesión de Facebook con
 * navegador real, cosa que un servidor sin cabeza no tiene.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { PublishWorker } from "./application/worker.js";
import { SupabaseJobQueue } from "./infrastructure/supabase-job-queue.js";
import { FacebookMarketplaceDriver, launchFacebookContext } from "./infrastructure/facebook-driver.js";
import { SupabaseStatusReporter } from "./infrastructure/supabase-status-reporter.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env — copiá .env.example y completalo.`);
  return value;
}

/**
 * Antes de abrir el navegador (lento, y sin sentido si no hay conexión), un
 * chequeo directo. supabase-js traga la causa real de un fallo de red —
 * cuando el fetch falla, deja `error.message` en el genérico "TypeError:
 * fetch failed" (se vio así la primera vez que se corrió esto), que no dice
 * si es DNS, TLS, firewall o una URL mal pegada. Acá se hace el fetch a mano
 * para poder imprimir la causa real (`err.cause`, que Node sí expone) y un
 * par de sospechosos habituales antes de rendirse.
 */
async function checkSupabaseReachable(url: string, serviceRoleKey: string): Promise<void> {
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: serviceRoleKey } });
    if (!res.ok && res.status !== 401 && res.status !== 404) {
      console.warn(`Supabase respondió pero con HTTP ${res.status} — puede ser una URL o key equivocada.`);
    } else {
      console.log(`Conexión con Supabase OK (${url}).`);
    }
  } catch (err) {
    const cause = err instanceof Error && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
    console.error("No se pudo conectar a Supabase.");
    console.error("Causa real:", cause ?? err);
    console.error("");
    console.error("Cosas para revisar en tu .env:");
    console.error(`  - SUPABASE_URL tiene que ser exactamente "https://<tu-project-ref>.supabase.co",`);
    console.error(`    sin comillas, sin espacios y sin / al final. Ahora está: ${JSON.stringify(url)}`);
    console.error("  - Si tenés antivirus, VPN o firewall corporativo, puede estar bloqueando la salida.");
    console.error(`  - Probá a mano en esta terminal: curl.exe -i ${url}/rest/v1/`);
    process.exit(1);
  }
}

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
await checkSupabaseReachable(supabaseUrl, supabaseServiceRoleKey);

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const queue = new SupabaseJobQueue(supabase);

// Antes del navegador: si ya hay un publicador corriendo, abrir otro no sirve.
// Dos Chromium no pueden compartir el perfil con tu sesión de Facebook, y se
// pisarían la cola. Pasa, por ejemplo, al tocar "Iniciar" en el dashboard con
// el publicador ya encendido.
const reporter = new SupabaseStatusReporter(supabase);
if (!(await reporter.claim())) {
  console.log("Ya hay un publicador corriendo en esta PC (el dashboard lo ve en línea). No abro otro.");
  console.log("Si no es así, esperá 30 segundos y volvé a intentar.");
  process.exit(0);
}

const dryRun = process.env.FB_DRY_RUN === "true";
const confirmBeforePost = process.env.FB_CONFIRM_BEFORE_POST !== "false";
const location = process.env.FB_LOCATION ?? "Lima, Peru";
const pollIntervalMs = Number(process.env.POLL_INTERVAL_SECONDS ?? "30") * 1000;

// headless: false siempre — un posteo automático e invisible es exactamente
// el patrón que Meta banea. Esto está pensado para correr con la ventana
// abierta, mirando, no como un servicio de fondo desatendido.
const context = await launchFacebookContext(false);
const driver = new FacebookMarketplaceDriver(context, location, dryRun, confirmBeforePost, reporter);

process.on("SIGINT", async () => {
  console.log("\nCerrando...");
  // El estado primero: el dashboard pasa a "apagado" al toque en vez de
  // esperar a que venza el latido.
  await reporter.stop();
  await driver.close();
  process.exit(0);
});

const worker = new PublishWorker(queue, driver, pollIntervalMs, reporter);
await worker.runForever();
