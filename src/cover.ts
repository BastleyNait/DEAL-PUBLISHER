/**
 * Portada IA en modo asistido, con tu Gemini Pro en tu Chrome de siempre:
 *
 *   npm run cover -- 137857828702                (número de eBay o link)
 *   npm run cover -- 137857828702 168792862159   (varias, una tras otra)
 *   npm run cover -- 137857828702 --nueva        (rehacer una que ya existe)
 *
 * Por cada laptop: baja sus 3 primeras fotos de revolt-laptops.com a una
 * carpeta y la abre, copia el prompt al portapapeles y abre Gemini. Vos
 * arrastrás las fotos, pegás (Ctrl+V), Enter, y descargás la imagen. El
 * script ve la descarga en tu carpeta de Descargas, la guarda en
 * runs/covers/ y el publicador la pone de primera foto en Facebook.
 *
 * No se automatiza Gemini: Google bloquea el login en navegadores
 * controlados por scripts, y forzarlo arriesga tu cuenta.
 */
import "dotenv/config";
import { execFileSync, exec } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SupabaseJobQueue } from "./infrastructure/supabase-job-queue.js";
import { COVERS_DIR, coverBase, findCover } from "./infrastructure/facebook-driver.js";
import { COVER_PROMPT } from "./infrastructure/cover-prompt.js";

const GEMINI_URL = "https://gemini.google.com/app";
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || join(homedir(), "Downloads");
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const WAIT_MINUTES = 15;

const args = process.argv.slice(2);
const redo = args.includes("--nueva");
const ids = args.filter((a) => a !== "--nueva").map((a) => a.match(/(\d{9,})/)?.[1]);
if (ids.length === 0 || ids.some((id) => !id)) {
  console.error("Uso: npm run cover -- <número de eBay | link> [más números…] [--nueva]");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const queue = new SupabaseJobQueue(supabase);

function open(target: string): void {
  exec(`start "" "${target}"`);
}

function copyToClipboard(text: string): void {
  // Set-Clipboard vía archivo UTF-8: `clip` rompe los acentos.
  const tmp = join(COVERS_DIR, ".prompt.txt");
  writeFileSync(tmp, text, "utf8");
  execFileSync("powershell", ["-NoProfile", "-Command", `Get-Content -Raw -Encoding UTF8 '${tmp}' | Set-Clipboard`]);
}

/** Espera una imagen nueva en Descargas (ya terminada de bajar) y devuelve su ruta. */
async function waitForDownload(since: number): Promise<string | null> {
  const sizes = new Map<string, number>();
  const deadline = Date.now() + WAIT_MINUTES * 60_000;
  while (Date.now() < deadline) {
    for (const name of readdirSync(DOWNLOADS_DIR)) {
      if (!IMAGE_EXTS.has(extname(name).toLowerCase())) continue;
      const path = join(DOWNLOADS_DIR, name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.mtimeMs < since || stat.size === 0) continue;
      // Terminada = mismo tamaño en dos vueltas seguidas.
      if (sizes.get(path) === stat.size) return path;
      sizes.set(path, stat.size);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

mkdirSync(COVERS_DIR, { recursive: true });

for (const legacyId of ids as string[]) {
  const { data: row, error } = await supabase
    .from("publications")
    .select("item_id, title, description, price_usd, price_pen, currency, image_urls, ebay_url")
    .like("item_id", `%|${legacyId}|%`)
    .maybeSingle();
  if (error || !row) {
    console.error(`\n✗ ${legacyId}: no hay publicación. Publicala primero desde la Mesa de compra.`);
    continue;
  }

  const existing = findCover(row.item_id);
  if (existing && !redo) {
    console.log(`\n✓ ${legacyId} ya tiene portada: ${existing}  (--nueva para rehacerla)`);
    continue;
  }

  const job = await queue.refresh({
    itemId: row.item_id,
    ebayUrl: row.ebay_url,
    title: row.title,
    description: row.description,
    priceUsd: Number(row.price_usd),
    pricePen: Number(row.price_pen),
    currency: row.currency,
    imageUrls: row.image_urls ?? [],
  });

  const photosDir = join(COVERS_DIR, `${legacyId}-fotos`);
  rmSync(photosDir, { recursive: true, force: true });
  mkdirSync(photosDir, { recursive: true });
  let saved = 0;
  for (const [i, url] of job.imageUrls.slice(0, 3).entries()) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;
    const ext = (res.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
    writeFileSync(join(photosDir, `${i + 1}.${ext}`), Buffer.from(await res.arrayBuffer()));
    saved++;
  }
  if (saved === 0) {
    console.error(`\n✗ ${legacyId}: no se pudo bajar ninguna foto de la tienda.`);
    continue;
  }

  copyToClipboard(COVER_PROMPT);
  const since = Date.now() - 2_000;
  open(photosDir);
  open(GEMINI_URL);

  console.log(`\n▶ ${job.title}`);
  console.log(`  1. Arrastrá las ${saved} fotos de la carpeta que se abrió al chat de Gemini.`);
  console.log("  2. Ctrl+V en el cuadro de texto (el prompt ya está copiado) y Enter.");
  console.log("  3. Cuando salga la imagen, descargala (botón de descarga en tamaño completo).");
  console.log(`  Esperando la descarga en ${DOWNLOADS_DIR} (hasta ${WAIT_MINUTES} min, Ctrl+C para cancelar)…`);

  const download = await waitForDownload(since);
  if (!download) {
    console.error(`  ✗ No llegó ninguna imagen nueva a Descargas. Repetí: npm run cover -- ${legacyId}`);
    continue;
  }

  if (existing) rmSync(existing);
  const target = coverBase(row.item_id) + extname(download).toLowerCase();
  copyFileSync(download, target);
  unlinkSync(download);
  rmSync(photosDir, { recursive: true, force: true });
  console.log(`  ✓ Portada guardada: ${target}`);
  console.log("    El publicador la pone de primera foto cuando postee este aviso.");
  open(target);
}

if (existsSync(join(COVERS_DIR, ".prompt.txt"))) rmSync(join(COVERS_DIR, ".prompt.txt"));
