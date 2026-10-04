// Prueba del boton Publicar/Saltear en una pagina local. NO toca Facebook.
// Uso: npx tsx scripts/try-overlay.ts
import { chromium } from "playwright";
import { confirmInBrowser } from "../src/infrastructure/confirm-overlay.js";

const browser = await chromium.launch({ headless: true });
const results: string[] = [];

async function run(label: string, title: string, click: "Publicar" | "Saltear" | "cerrar") {
  const page = await browser.newPage();
  await page.setContent("<html><body><h1>Pagina de prueba</h1></body></html>");
  const pending = confirmInBrowser(page, title);

  await page.waitForSelector("#revolt-confirm-box");
  const visible = await page.evaluate(
    `(() => { const b = document.getElementById("revolt-confirm-box"); const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).zIndex === "2147483647"; })()`,
  );
  const shownTitle = await page.evaluate(`document.querySelector("#revolt-confirm-box div:nth-child(2)").textContent`);

  if (click === "cerrar") await page.close();
  else await page.getByRole("button", { name: click }).click();

  const decision = await pending;
  const stillThere = click === "cerrar" ? false : (await page.locator("#revolt-confirm-box").count()) > 0;
  results.push(`${label}: decision=${decision} | visible=${visible} | titulo ok=${shownTitle === title} | panel removido=${!stillThere}`);
  if (click !== "cerrar") await page.close();
}

await run("click en Publicar", "Laptop Lenovo — para oficina y estudio — 16GB RAM", "Publicar");
await run("click en Saltear", "Titulo con \"comillas\" y 'apostrofes' y \\ barra", "Saltear");
await run("cerrar pestaña", "Se cierra la pestaña", "cerrar");

// Si el panel desaparece (Facebook re-renderiza), se vuelve a poner solo.
const page = await browser.newPage();
await page.setContent("<html><body>x</body></html>");
const pending = confirmInBrowser(page, "Reaparece");
await page.waitForSelector("#revolt-confirm-box");
await page.evaluate(`document.getElementById("revolt-confirm-box").remove()`);
await page.waitForSelector("#revolt-confirm-box", { timeout: 6000 });
results.push("reaparece tras borrarlo: ok");
await page.getByRole("button", { name: "Saltear" }).click();
await pending;
await page.close();

await browser.close();
for (const r of results) console.log(r);
