import type { Page } from "playwright";

export type Decision = "publish" | "skip";

const BOX_ID = "revolt-confirm-box";
// Si nadie responde en media hora se saltea: un job colgado para siempre
// frena toda la cola que viene atrás.
const MAX_WAIT_MS = 30 * 60_000;

/**
 * El script que dibuja el panel dentro de la página. Va como texto y no como
 * función de TypeScript porque corre en el navegador, donde `document` no
 * existe para este proyecto (sin la librería DOM en el tsconfig). Todo se
 * arma con createElement/textContent y addEventListener: sin innerHTML ni
 * onclick="…", que la política de seguridad de Facebook bloquea.
 *
 * El título viaja como JSON para que comillas o saltos de línea no rompan el
 * script.
 */
function overlayScript(title: string, callbackName: string): string {
  return `(() => {
    if (document.getElementById(${JSON.stringify(BOX_ID)})) return;
    const box = document.createElement("div");
    box.id = ${JSON.stringify(BOX_ID)};
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;padding:14px;border-radius:12px;background:#111820;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);border:2px solid #86a5ff";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:700;margin-bottom:4px";
    head.textContent = "Revolt · formulario completo";
    const body = document.createElement("div");
    body.style.cssText = "opacity:.85;margin-bottom:6px";
    body.textContent = ${JSON.stringify(title)};
    const hint = document.createElement("div");
    hint.style.cssText = "opacity:.6;font-size:12px;margin-bottom:10px";
    hint.textContent = "Revisá fotos, precio y descripción. Al publicar, el programa toca Siguiente y Publicar solo.";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";
    const make = (label, color, decision) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "flex:1;padding:9px 12px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;color:#fff;background:" + color;
      b.addEventListener("click", () => window[${JSON.stringify(callbackName)}](decision));
      return b;
    };
    row.append(make("Publicar", "#0c7a4d", "publish"), make("Saltear", "#555", "skip"));
    box.append(head, body, hint, row);
    document.body.appendChild(box);
  })()`;
}

/**
 * Muestra un panel "Publicar / Saltear" dentro de la propia ventana de
 * Facebook y espera el click. Reemplaza al prompt de la terminal: la ventana
 * es lo que ya estás mirando para revisar el formulario, y así no hace falta
 * volver a la consola ni escribir nada.
 *
 * Facebook puede re-renderizar y llevarse el panel; se vuelve a poner si
 * desaparece. Cerrar la pestaña cuenta como saltear.
 */
export async function confirmInBrowser(page: Page, title: string): Promise<Decision> {
  // Nombre único por llamada: exposeFunction falla si se repite en la misma página.
  const callbackName = `__revoltDecide_${Date.now()}`;
  let resolveDecision!: (d: Decision) => void;
  const decided = new Promise<Decision>((resolve) => (resolveDecision = resolve));

  await page.exposeFunction(callbackName, (d: string) => resolveDecision(d === "publish" ? "publish" : "skip"));
  page.once("close", () => resolveDecision("skip"));

  const script = overlayScript(title, callbackName);
  await page.evaluate(script);

  const keepAlive = setInterval(() => {
    void page
      .locator(`#${BOX_ID}`)
      .count()
      .then((count) => (count === 0 ? page.evaluate(script) : undefined))
      .catch(() => {});
  }, 2000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Decision>((resolve) => {
    timeout = setTimeout(() => resolve("skip"), MAX_WAIT_MS);
  });

  try {
    return await Promise.race([decided, timedOut]);
  } finally {
    clearInterval(keepAlive);
    if (timeout) clearTimeout(timeout);
    // Sale del medio: si no, tapa el botón de Facebook que viene después.
    await page.evaluate(`document.getElementById(${JSON.stringify(BOX_ID)})?.remove()`).catch(() => {});
  }
}
