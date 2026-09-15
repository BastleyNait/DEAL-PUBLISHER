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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env — copiá .env.example y completalo.`);
  return value;
}

const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
const queue = new SupabaseJobQueue(supabase);

const dryRun = process.env.FB_DRY_RUN === "true";
const confirmBeforePost = process.env.FB_CONFIRM_BEFORE_POST !== "false";
const location = process.env.FB_LOCATION ?? "Lima, Peru";
const pollIntervalMs = Number(process.env.POLL_INTERVAL_SECONDS ?? "30") * 1000;

// headless: false siempre — un posteo automático e invisible es exactamente
// el patrón que Meta banea. Esto está pensado para correr con la ventana
// abierta, mirando, no como un servicio de fondo desatendido.
const context = await launchFacebookContext(false);
const driver = new FacebookMarketplaceDriver(context, location, dryRun, confirmBeforePost);

process.on("SIGINT", async () => {
  console.log("\nCerrando...");
  await driver.close();
  process.exit(0);
});

const worker = new PublishWorker(queue, driver, pollIntervalMs);
await worker.runForever();
