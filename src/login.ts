/**
 * Abre un Chromium visible con el perfil persistente de .fb-session/ para que
 * entres a Facebook a mano, una sola vez. La sesión (cookies) queda guardada
 * ahí para las corridas de `npm start` — tu contraseña no pasa por acá ni
 * queda guardada por este programa en ningún momento: la escribís vos,
 * directo en la página de Facebook, como cualquier login normal.
 */
import "dotenv/config";
import { launchFacebookContext } from "./infrastructure/facebook-driver.js";

const context = await launchFacebookContext(false);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.facebook.com/login");

console.log("Iniciá sesión en la ventana de Facebook que se abrió.");
console.log("Cuando veas tu feed / Marketplace cargado, volvé acá y presioná Enter.");

await new Promise<void>((resolve) => {
  process.stdin.once("data", () => resolve());
});

await context.close();
console.log("Sesión guardada en .fb-session/. Ya podés correr: npm start");
