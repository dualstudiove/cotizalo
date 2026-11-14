// Los tokens de color del modo claro, para lo que se dibuja fuera del CSS (PDF, imágenes, canvas).
// Un documento impreso siempre va en claro, aunque la pantalla esté en oscuro, así que no se leen del
// CSS en vivo. Deben coincidir con :root de tokens.css (lo comprueba test/reglas.test.js).
export const CLARO = {
  bg: "#f3f4f7",
  surface: "#ffffff",
  "surface-2": "#f8f9fb",
  ink: "#14161c",
  "ink-2": "#4b5160",
  "ink-3": "#757c8c",
  line: "#dfe2e9",
  "line-2": "#eceef3",
  accent: "#3342e8",
  "accent-ink": "#ffffff",
  "accent-bg": "#e8eaff",
  ok: "#0f7f64",
  "ok-bg": "#dff3ec",
  warn: "#955700",
  "warn-bg": "#fcefd9",
  danger: "#c0302a",
  "danger-bg": "#fde9e8",
};

/** Mezcla dos colores #rrggbb: `t` es la parte de `b` (0 → a, 1 → b). */
export function mezclar(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const m = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map((s) => m(s).toString(16).padStart(2, "0")).join("")}`;
}

/** El tinte de un acento, igual que --accent-bg con un color de negocio: 11 % del color sobre la superficie. */
export const tinteDe = (color) => mezclar(color, CLARO.surface, 0.89);
