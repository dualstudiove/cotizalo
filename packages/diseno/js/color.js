// Acento de marca con buen contraste. Un negocio elige un color vivo y de él salen:
//   --accent       el color tal cual, para rellenos (botones, barras, gráficos)
//   --accent-ink   el texto encima del relleno: blanco u oscuro, el que contraste más
//   --accent-text  el mismo tono, oscurecido (o aclarado en modo oscuro) lo justo para leerse como
//                  texto, enlace, borde de selección o foco sobre la superficie, el fondo y su tinte
// Así los colores pueden ser brillantes sin que la interfaz se vuelva ilegible.
import { CLARO, mezclar, OSCURO } from "./tokens.js";

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const aHex = (c) =>
  `#${
    c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join(
      "",
    )
  }`;

/** Luminancia relativa (WCAG 2). */
export function luminancia(h) {
  const [r, g, b] = rgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contraste WCAG entre dos colores #rrggbb (de 1 a 21). */
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function aHsl(h) {
  const [r, g, b] = rgb(h);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r
    ? (g - b) / d + (g < b ? 6 : 0)
    : max === g
    ? (b - r) / d + 2
    : (r - g) / d + 4;
  return [hue / 6, s, l];
}
function deHsl([h, s, l]) {
  if (!s) return aHex([l, l, l]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return aHex([canal(h + 1 / 3), canal(h), canal(h - 1 / 3)]);
}

/** Oscurece (sentido −1) o aclara (+1) el color, sin cambiar su tono, hasta contrastar ≥ min con todos los fondos. */
export function ajustarContraste(color, fondos, sentido, min = 4.5) {
  const [h, s, l] = aHsl(color);
  let x = color;
  for (let k = 0; k <= 100; k++) {
    x = deHsl([h, s, Math.max(0, Math.min(1, l + sentido * k * 0.01))]);
    if (fondos.every((f) => contraste(x, f) >= min)) return x;
  }
  return x;
}

/** El texto sobre un relleno del color: blanco u oscuro, el que más contraste. */
export const tintaSobre = (color) =>
  contraste("#ffffff", color) >= contraste(CLARO.ink, color) ? "#ffffff" : CLARO.ink;

/** Todo lo que el sistema de diseño necesita de un color de marca. */
export function derivarAcento(color) {
  return {
    color,
    tinta: tintaSobre(color),
    texto: ajustarContraste(
      color,
      [CLARO.surface, CLARO.bg, mezclar(color, CLARO.surface, 0.89)],
      -1,
    ),
    textoOscuro: ajustarContraste(
      color,
      [OSCURO.surface, OSCURO.bg, mezclar(color, OSCURO.surface, 0.74)],
      1,
    ),
  };
}
