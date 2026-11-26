import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline/promises";
import { type BrowserContext, type Page, chromium } from "playwright";
import type { MarketplaceDriver, PublishJob, StatusReporter } from "../domain/types.js";
import { type Decision, confirmInBrowser } from "./confirm-overlay.js";

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
  private closed = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly dryRun: boolean,
    private readonly confirmBeforePost: boolean,
    private readonly reporter?: StatusReporter,
  ) {}

  async post(job: PublishJob, location: string): Promise<void> {
    // Puede pasar que close() ya haya corrido (se pidió salir) mientras este
    // job estaba en el aire — mejor un mensaje claro acá que el genérico de
    // Playwright ("Target page, context or browser has been closed") más
    // abajo si se intenta igual abrir una pestaña en un contexto muerto.
    if (this.closed) throw new Error("El navegador ya se cerró (se pidió salir); este ítem no se procesó.");

    const page = await this.context.newPage();
    this.page = page;
    // Default de Playwright es 30s por acción: si un campo nunca aparece, se
    // queda "pegado" 30s por cada uno sin decir nada mientras tanto. Con esto
    // cada acción individual falla en 10s como mucho, y el log de abajo dice
    // en cuál estaba antes de fallar.
    page.setDefaultTimeout(10_000);
    const step = (label: string) => console.log(`  [${job.itemId}] ${label}`);

    try {
      step("navegando a Marketplace…");
      try {
        await page.goto(CREATE_ITEM_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
      } catch (err) {
        throw new Error(`La página no terminó de cargar en 20s (${err instanceof Error ? err.message : err}).`);
      }
      await this.screenshot(page, job.itemId, "01-cargada");

      // Si la página cargó casi vacía, seguir a ciegas solo suma varios
      // timeouts de 10s en fila hasta fallar igual. Se corta acá, ya con la
      // captura de arriba para ver qué hay (checkpoint, cookies, blanco real).
      const bodyText = (await page.locator("body").innerText().catch(() => "")).trim();
      if (bodyText.length < 40) {
        throw new Error(
          `La página cargó casi vacía (${bodyText.length} caracteres de texto). ` +
            "Puede ser un checkpoint de verificación de Facebook, un aviso de cookies tapando todo, o que la sesión no sirve. Mirá la captura.",
        );
      }
      step(`página cargada (${bodyText.length} caracteres de texto, url: ${page.url()})`);

      if (await this.looksLoggedOut(page)) {
        throw new Error(
          "Facebook pide login. Corré `npm run login` en esta carpeta para entrar a mano una vez, y volvé a intentar.",
        );
      }

      step("bajando fotos…");
      const photoPaths = await this.downloadPhotos(job.imageUrls, job.itemId);
      step(`${photoPaths.length}/${job.imageUrls.length} fotos bajadas, llenando el formulario…`);
      await this.fillForm(page, job, photoPaths, step, location);

      const shotPath = await this.screenshot(page, job.itemId, "listo-para-publicar");

      if (this.dryRun) {
        console.log(`[dry-run] Formulario completo, no se publica. Captura: ${shotPath}`);
        return;
      }

      // "Auto-publicar" del dashboard: se lee en cada aviso, así se puede
      // prender y apagar sin reiniciar el publicador.
      const autoPublish = (await this.reporter?.isAutoPublish()) ?? false;
      if (autoPublish) step("auto-publicar encendido: publico sin esperar el click");
      if (this.confirmBeforePost && !autoPublish) {
        console.log(`Formulario completo. Revisá la ventana del navegador (o ${shotPath}).`);
        this.reporter?.set("waiting_confirm", { itemId: job.itemId, title: job.title });
        const decision = await this.askConfirmation(page, job, location);
        this.reporter?.set("working", { itemId: job.itemId, title: job.title });
        if (decision === "skip") throw new Error("Salteado a mano.");
      }

      step("publicando…");
      await this.clickAny(page, ["Next", "Siguiente"]);
      await page.waitForTimeout(800);
      await this.clickAny(page, ["Publish", "Publicar"]);
      await page.waitForTimeout(1200);
    } catch (err) {
      const shotPath = await this.screenshot(page, job.itemId, "error").catch(() => null);
      const suffix = shotPath ? ` Captura: ${shotPath}` : "";
      throw new Error(`${err instanceof Error ? err.message : String(err)}.${suffix}`);
    } finally {
      await page.close().catch(() => {});
      this.page = null;
    }
  }

  /**
   * Primero el panel dentro de la ventana de Facebook. Si por lo que sea no se
   * puede dibujar ahí, se cae a la terminal en vez de publicar sin preguntar
   * o trabar el job.
   */
  private async askConfirmation(page: Page, job: PublishJob, location: string): Promise<Decision> {
    try {
      return await confirmInBrowser(page, `📍 ${location} — ${job.title}`, () => this.reporter?.isAutoPublish() ?? Promise.resolve(false));
    } catch (err) {
      console.warn("No pude mostrar el botón en la ventana de Facebook, uso la terminal:", err);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      // Saltear se escribe, no se hace con Ctrl+C: esa tecla mata el proceso
      // entero y el navegador con él.
      const answer = await rl.question("Enter para publicar, 'n' + Enter para saltear este ítem... ");
      rl.close();
      return answer.trim().toLowerCase().startsWith("n") ? "skip" : "publish";
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.context.close();
  }

  private async looksLoggedOut(page: Page): Promise<boolean> {
    return page.url().includes("/login") || (await page.getByLabel(/mobile number|email|correo/i).count()) > 0;
  }

  private async fillForm(
    page: Page,
    job: PublishJob,
    photoPaths: string[],
    step: (label: string) => void,
    location: string,
  ): Promise<void> {
    if (photoPaths.length > 0) {
      step("subiendo fotos…");
      await this.uploadPhotos(page, photoPaths);
    }

    step("campo Título…");
    await this.fillByLabel(page, ["Title", "Título"], job.title);
    step("campo Precio…");
    // pricePen, no priceUsd: la cuenta de Facebook está en Perú, así que el
    // campo Precio se muestra y se interpreta en soles. Cargar el número en
    // dólares ahí lo vendía a un tercio de su precio real.
    await this.fillByLabel(page, ["Price", "Precio"], String(Math.round(job.pricePen)));

    // Categoría y condición son combos/menús, no campos de texto: se abren y
    // se elige la primera opción razonable. Es lo más frágil del formulario.
    step("menú Categoría…");
    await this.selectFromMenu(page, ["Category", "Categoría"], ["Electronics", "Electrónica", "Electrónicos"]);
    step("menú Condición…");
    await this.selectFromMenu(page, ["Condition", "Estado", "Condición"], ["Used - Good", "Usado - Bueno", "Used", "Usado"]);

    step("campo Descripción…");
    await this.fillByLabel(page, ["Description", "Descripción"], job.description);

    step("campo Ubicación…");
    await this.fillLocation(page, location);
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
   * (a) renderiza de a poco a medida que se scrollea (virtualizado) y (b) no
   * usa role="option" como cabría esperar — la primera corrida real encontró
   * 0 filas con ese rol aunque estaban visibles en pantalla. Por eso se
   * prueba contra varios roles candidatos mientras se scrollea el propio
   * listado, y si ninguno pega, un último intento por texto puro sin importar
   * el rol. Si aun así no aparece, el error lista todo lo que sí se vio — así
   * el próximo ajuste no necesita otra ronda de captura de pantalla.
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
    await page.waitForTimeout(300);

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
      await page.waitForTimeout(150);
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
    for (let waited = 0; waited < 10_000; waited += 300) {
      if ((await thumbnails.count()) > 0) return;
      await page.waitForTimeout(300);
    }
    console.warn(
      `Subí ${photoPaths.length} foto(s) pero no vi ninguna miniatura después de 10s. ` +
        "Puede que Facebook tarde más o que haya cambiado cómo muestra las fotos cargadas — revisá la captura.",
    );
  }

  /**
   * Con varias ciudades ya no alcanza con "si no está el campo, queda la que
   * viene precargada": eso publicaría el mismo aviso dos veces en la misma
   * ciudad. Si no se puede poner la ciudad pedida, el ítem falla.
   */
  private async fillLocation(page: Page, location: string): Promise<void> {
    const field = page.getByLabel(/location|ubicación/i).first();
    if (!(await field.count())) throw new Error(`No encontré el campo de ubicación para poner ${location}.`);
    const city = (location.split(",")[0] ?? location).trim();
    await field.click();
    await field.fill(city);
    // Las sugerencias tardan en llegar; se elige la que nombra la ciudad.
    const suggestion = page.getByRole("option").filter({ hasText: new RegExp(escapeRegExp(city), "i") }).first();
    try {
      await suggestion.waitFor({ timeout: 6000 });
    } catch {
      throw new Error(`Facebook no sugirió ninguna ubicación para "${city}".`);
    }
    await suggestion.click();
    await page.waitForTimeout(500);
    const chosen = await field.inputValue().catch(() => "");
    if (!new RegExp(escapeRegExp(city), "i").test(chosen)) {
      throw new Error(`La ubicación quedó en "${chosen}" en vez de ${location}.`);
    }
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
