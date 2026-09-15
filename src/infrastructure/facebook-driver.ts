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
    if (photoPaths.length > 0) await this.uploadPhotos(page, photoPaths);

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

  /**
   * Categoría y condición no son un <select>: son un listado desplegable que
   * renderiza de a poco a medida que se scrollea (virtualizado), así que
   * "Electronics" puede no estar en el DOM todavía cuando se abre el menú,
   * aunque esté más abajo en la lista. Primero se prueba tipeando (muchos de
   * estos combos de Facebook filtran al tipear), y si no, se scrollea el
   * propio listado juntando todo lo que se va viendo hasta que deja de haber
   * contenido nuevo. Si aun así no aparece, el error lista todo lo que sí se
   * vio — así el próximo ajuste no necesita otra ronda de captura de pantalla.
   */
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
    await page.waitForTimeout(500);

    // Primer intento real: no asumir ningún rol de accesibilidad puntual.
    // "role=option" resultó ser el rol equivocado para este menú de Facebook
    // (la primera corrida real encontró 0 con ese rol aunque la fila estaba
    // visible en pantalla) — filas de un menú desplegable en apps como esta
    // suelen ser role=menuitem/menuitemradio, o directamente sin rol y con
    // un onClick a mano. Este selector cubre los candidatos más comunes.
    const CANDIDATE_ROLES = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="button"]';

    const seen = new Set<string>();
    let lastCount = -1;
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidates = page.locator(CANDIDATE_ROLES);
      const count = await candidates.count();
      for (let i = 0; i < count; i++) {
        const text = (await candidates.nth(i).innerText().catch(() => "")).trim();
        if (!text) continue;
        seen.add(text);
        for (const wanted of optionTexts) {
          if (new RegExp(wanted, "i").test(text)) {
            await candidates.nth(i).scrollIntoViewIfNeeded().catch(() => {});
            await candidates.nth(i).click();
            return;
          }
        }
      }
      if (count === lastCount) break; // El scroll dejó de traer filas nuevas.
      lastCount = count;
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(250);
    }

    // Último recurso: buscar el texto en cualquier elemento, sin importar
    // rol ni clase. Más lento y más propenso a pegarle a algo tapado, por
    // eso va al final y no primero.
    for (const wanted of optionTexts) {
      const byText = page.getByText(new RegExp(`^${wanted}$`, "i")).first();
      if (await byText.count()) {
        await byText.scrollIntoViewIfNeeded().catch(() => {});
        await byText.click();
        return;
      }
    }

    throw new Error(
      `Se abrió "${fieldLabels[0]}" pero ninguna opción coincidió con ${optionTexts.join(" / ")}. ` +
        `Se vieron ${seen.size}: ${[...seen].slice(0, 40).join(" | ")}`,
    );
  }

  /**
   * Subir varias fotos a la vez tarda unos segundos en procesarse del lado de
   * Facebook antes de que aparezcan las miniaturas. La primera corrida se
   * quedó con la captura mostrando casilleros grises: probablemente estaban
   * subiendo todavía y la captura se tomó muy pronto, no que hayan fallado.
   * Acá se espera de verdad a que aparezcan miniaturas en vez de una pausa
   * fija corta.
   */
  private async uploadPhotos(page: Page, photoPaths: string[]): Promise<void> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(photoPaths);

    const thumbnails = page.locator('div[aria-label="Thumbnail"], img[src^="blob:"]');
    for (let waited = 0; waited < 15_000; waited += 500) {
      if ((await thumbnails.count()) > 0) return;
      await page.waitForTimeout(500);
    }
    console.warn(
      `Subí ${photoPaths.length} foto(s) pero no vi ninguna miniatura después de 15s. ` +
        "Puede que Facebook tarde más o que haya cambiado cómo muestra las fotos cargadas — revisá la captura.",
    );
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
