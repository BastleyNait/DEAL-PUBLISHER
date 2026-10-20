/**
 * Lo que pidió Revolt para la primera foto, tal cual: laptop recortada a la
 * derecha, caja abierta con el cargador a la izquierda, Windows 11 en
 * pantalla, fondo oscuro, foto de estudio, todo de frente — sin logos en la
 * caja ni deformar la laptop. En inglés porque así lo sigue mejor Gemini.
 * Se pega a mano en gemini.google.com (`npm run cover`).
 */
export const COVER_PROMPT = `Create a professional e-commerce product photograph for a refurbished laptop store, using the laptop in the attached photo(s). It is the exact same physical unit and must stay identical.

Composition:
- Cut the laptop out perfectly from its original background and place it on the RIGHT side of the frame, lid open.
- On the LEFT side, place a small, plain, open cardboard box with the laptop's power adapter (charger) and cable resting inside it. If a charger appears in the attached photos, reproduce that same charger; otherwise use a plain generic black laptop charger.
- Both objects face the camera straight on, frontal view, with no rotation or tilt. Both fully in frame.
- The laptop screen shows the standard Windows 11 default wallpaper (the blue "bloom" on a dark background).
- Background: dark, clean studio backdrop (near black) with a very subtle emerald-green glow behind the products, and a soft reflection on a dark surface.

Photography:
- Studio lighting: soft key light plus rim light separating both objects from the dark background.
- Deep depth of field: BOTH the laptop and the charger box in sharp focus. No blur on either object.
- Photorealistic, high detail, natural colors. Square 1:1 image.

Strict rules:
- Keep every physical trait of the laptop exactly as in the photo: shape, color, materials, keyboard layout and key legends, ports, stickers, logos and wear marks. Do not distort, rename or invent any letters, logos or details.
- The box and the charger have NO logos, NO text, NO labels and NO brand marks of any kind.
- Do not add any text, price, badge or graphic overlay.`;
