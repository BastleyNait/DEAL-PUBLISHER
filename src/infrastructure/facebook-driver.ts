import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline/promises";
import { type BrowserContext, type Page, chromium } from "playwright";
import type { MarketplaceDriver, PublishJob } from "../domain/types.js";

const CREATE_ITEM_URL = "https://www.facebook.com/marketplace/create/item";
const RUNS_DIR = join(process.cwd(), "runs");

/**
 * Perfil de Chromium persistente: la sesión de Facebook (cookies, login)
 * queda guardada acá entre corridas, igual que en Chrome de verdad. `npm run
 * login` abre el navegador una vez para que entres a mano — tu contraseña
 * nunca pasa por ningún archivo ni queda guardada por este programa.
 */
export const FB_SESSION_DIR = join(process.cwd(), ".fb-session");

export async function launchFacebookContext(headless: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(FB_SESSION_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
  });
}

/**
 * Driver de Facebook Marketplace vía Playwright, contra tu sesión real. Los
 * selectores de Facebook cambian seguido y no hay forma de probarlos sin una
 * cuenta y una sesión reales — así que van por rol/etiqueta accesible en vez
 * de clases CSS (que rotan todavía más rápido), con variantes en español e
 * inglés, y si algo no aparece el job falla con una captura de pantalla en
 * vez de clickear a ciegas. La primera vez que corra, andá a
 * runs/<itemId>-*.png cuando falle un paso para ver exactamente dónde se
 * frenó y ajustar el selector de ese paso puntual.
 */
export class FacebookMarketplaceDriver implements MarketplaceDriver {
  private page: Page | null = null;

  constructor(
    private readonly context: BrowserContext,
    private readonly location: string,
    private readonly dryRun: boolean,
    private readonly confirmBeforePost: boolean,
  ) {}

  async post(job: PublishJob): Promise<void> {
    const page = await this.context.newPage();
    this.page = page;

    try {
      await page.goto(CREATE_ITEM_URL, { waitUntil: "domcontentloaded" });

      if (await this.looksLoggedOut(page)) {
        throw new Error(
          "Facebook pide login. Corré `npm run login` en esta carpeta para entrar a mano una vez, y volvé a intentar.",
        );
      }

      const photoPaths = await this.downloadPhotos(job.imageUrls, job.itemId);
      await this.fillForm(page, job, photoPaths);

      const shotPath = await this.screenshot(page, job.itemId, "listo-para-publicar");

      if (this.dryRun) {
        console.log(`[dry-run] Formulario completo, no se publica. Captura: ${shotPath}`);
        return;
      }

      if (this.confirmBeforePost) {
        console.log(`Formulario completo. Revisá la ventana del navegador (o ${shotPath}).`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await rl.question("Presioná Enter para publicar, o Ctrl+C para cancelar este item... ");
        rl.close();
      }

      await this.clickAny(page, ["Next", "Siguiente"]);
      await page.waitForTimeout(1500);
      await this.clickAny(page, ["Publish", "Publicar"]);
      await page.waitForTimeout(2500);
    } catch (err) {
      const shotPath = await this.screenshot(page, job.itemId, "error").catch(() => null);
      const suffix = shotPath ? ` Captura: ${shotPath}` : "";
      throw new Error(`${err instanceof Error ? err.message : String(err)}.${suffix}`);
    } finally {
      await page.close().catch(() => {});
      this.page = null;
    }
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  private async looksLoggedOut(page: Page): Promise<boolean> {
    return page.url().includes("/login") || (await page.getByLabel(/mobile number|email|correo/i).count()) > 0;
  }

  private async fillForm(page: Page, job: PublishJob, photoPaths: string[]): Promise<void> {
    if (photoPaths.length > 0) {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(photoPaths);
      await page.waitForTimeout(1000);
    }

    await this.fillByLabel(page, ["Title", "Título"], job.title);
    await this.fillByLabel(page, ["Price", "Precio"], String(Math.round(job.priceUsd)));

    // Categoría y condición son combos/menús, no campos de texto: se abren y
    // se elige la primera opción razonable. Es lo más frágil del formulario.
    await this.selectFromMenu(page, ["Category", "Categoría"], ["Electronics", "Electrónica", "Electrónicos"]);
    await this.selectFromMenu(page, ["Condition", "Estado", "Condición"], ["Used - Good", "Usado - Bueno", "Used", "Usado"]);

    await this.fillByLabel(page, ["Description", "Descripción"], job.description);

    await this.fillLocation(page);
  }

  private async fillByLabel(page: Page, labels: string[], value: string): Promise<void> {
    for (const label of labels) {
      const field = page.getByLabel(new RegExp(label, "i")).first();
      if (await field.count()) {
        await field.click();
        await field.fill(value);
        return;
      }
    }
    throw new Error(`No encontré el campo "${labels[0]}" en el formulario de Marketplace.`);
  }

  private async selectFromMenu(page: Page, fieldLabels: string[], optionTexts: string[]): Promise<void> {
    let opened = false;
    for (const label of fieldLabels) {
      const field = page.getByLabel(new RegExp(label, "i")).first();
      if (await field.count()) {
        await field.click();
        opened = true;
        break;
      }
    }
    if (!opened) throw new Error(`No encontré el selector "${fieldLabels[0]}" en el formulario.`);

    await page.waitForTimeout(400);
    for (const text of optionTexts) {
      const option = page.getByRole("option", { name: new RegExp(text, "i") }).first();
      if (await option.count()) {
        await option.click();
        return;
      }
    }
    throw new Error(`Se abrió "${fieldLabels[0]}" pero ninguna opción coincidió con ${optionTexts.join(" / ")}.`);
  }

  private async fillLocation(page: Page): Promise<void> {
    const field = page.getByLabel(/location|ubicación/i).first();
    if (!(await field.count())) return; // No siempre está: a veces ya viene precargada.
    await field.click();
    await field.fill(this.location);
    await page.waitForTimeout(700);
    const suggestion = page.getByRole("option").first();
    if (await suggestion.count()) await suggestion.click();
  }

  private async clickAny(page: Page, texts: string[]): Promise<void> {
    for (const text of texts) {
      const button = page.getByRole("button", { name: new RegExp(`^${text}$`, "i") }).first();
      if (await button.count()) {
        await button.click();
        return;
      }
    }
    throw new Error(`No encontré ningún botón "${texts.join(" / ")}".`);
  }

  private async screenshot(page: Page, itemId: string, tag: string): Promise<string> {
    if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
    const safeId = itemId.replace(/[^a-zA-Z0-9]/g, "");
    const path = join(RUNS_DIR, `${safeId}-${tag}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  }

  /** Las fotos ya están en R2 (públicas); se bajan a un temporal porque setInputFiles quiere paths locales. */
  private async downloadPhotos(urls: string[], itemId: string): Promise<string[]> {
    const dir = join(tmpdir(), `deal-publisher-${itemId.replace(/[^a-zA-Z0-9]/g, "")}`);
    mkdirSync(dir, { recursive: true });

    const paths: string[] = [];
    for (const [index, url] of urls.entries()) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = url.toLowerCase().endsWith(".png") ? "png" : "jpg";
        const path = join(dir, `${index}.${ext}`);
        writeFileSync(path, buffer);
        paths.push(path);
      } catch (err) {
        console.error(`No se pudo bajar la foto ${index} (${url}):`, err);
      }
    }
    return paths;
  }
}
