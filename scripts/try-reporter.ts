// Prueba del latido y del candado de una sola instancia contra Supabase real.
// Uso: npx tsx scripts/try-reporter.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { SupabaseStatusReporter } from "../src/infrastructure/supabase-status-reporter.js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anon = createClient(url, key);

async function view() {
  const { data } = await anon.from("publisher_status_public").select("*").maybeSingle();
  if (!data) return "sin fila";
  const ageS = Math.round((Date.now() - new Date(data.last_seen).getTime()) / 1000);
  return `state=${data.state} | titulo=${data.current_title ?? "-"} | latido hace ${ageS > 100000 ? "una eternidad (apagado)" : ageS + "s"}`;
}

const a = new SupabaseStatusReporter(createClient(url, key));
const b = new SupabaseStatusReporter(createClient(url, key));

console.log("A reclama el lugar:      ", await a.claim());
console.log("B intenta (debe ser false):", await b.claim());
console.log("estado inicial:          ", await view());

a.set("working", { itemId: "v1|1|0", title: "Laptop de prueba" });
await new Promise((r) => setTimeout(r, 1500));
console.log("A trabajando:            ", await view());

a.set("waiting_confirm", { itemId: "v1|1|0", title: "Laptop de prueba" });
await new Promise((r) => setTimeout(r, 1500));
console.log("A esperando confirmacion:", await view());

a.set("idle");
await new Promise((r) => setTimeout(r, 1500));
console.log("A libre:                 ", await view());

await a.stop();
console.log("A se apaga:              ", await view());
console.log("B ahora si puede (true):   ", await b.claim());
await b.stop();
console.log("B se apaga:              ", await view());
process.exit(0);
