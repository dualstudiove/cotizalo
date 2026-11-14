// Exportación del presupuesto: vista previa, texto, PDF (escrito a mano, sin librerías) e imagen PNG.
// Un único motor de maquetación (layoutDoc) alimenta el PDF y la imagen, así se ven iguales.
import { bs, diaLocal, esc, fmtFecha, fmtNum, fmtTasa, icon, ref } from "./common.js";
import { CLARO } from "../_ds/diseno/js/tokens.js";
import { derivarAcento } from "../_ds/diseno/js/color.js";

const COLOR_POR_DEFECTO = "#14b8a6"; // Turquesa, el de src/paleta.js

/** Arma el documento a exportar a partir de la respuesta del servidor + datos opcionales del paciente. */
export function buildDoc({ res, negocio, paciente = {} }) {
  const limpio = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    nombre: res.negocio.nombre,
    rif: res.negocio.rif || negocio.rif || null, // los presupuestos guardados antes del RIF lo toman de la config actual
    telefono: res.negocio.telefono,
    direccion: res.negocio.direccion,
    horario: res.negocio.horario,
    pie: res.negocio.pie,
    logo: negocio.logo || null,
    color: negocio.color || COLOR_POR_DEFECTO,
    codigo: res.codigo,
    emision: res.dia,
    vigencia: res.vigencia_hasta,
    precios: res.precios_actualizados_en ? diaLocal(res.precios_actualizados_en) : null,
    paciente: {
      nombre: limpio(paciente.nombre),
      cedula: limpio(paciente.cedula),
      telefono: limpio(paciente.telefono),
      medico: limpio(paciente.medico),
    },
    // «Biopsia ×3»: la cantidad va en el nombre y el precio es el total de la línea (igual en pantalla, PDF, imagen y texto)
    // Debajo de cada línea: lo que incluye (perfiles), la promoción aplicada y las indicaciones previas.
    items: res.items.map((it) => ({
      ...it,
      nombre: it.cantidad > 1 ? `${it.nombre} ×${it.cantidad}` : it.nombre,
      // Precio especial: se marca con su porcentaje y hasta cuándo dura, para que no se tome como el precio regular
      promo: it.descuento_pct
        ? {
          pct: it.descuento_pct,
          hasta: it.promo_hasta || null,
          nombre: it.promo_nombre || null,
          antes: (it.precio_lista_unit_cent || 0) * (it.cantidad || 1),
        }
        : null,
      detalle: [
        it.incluye?.length ? `Incluye: ${it.incluye.join(", ")}` : null,
        it.indicaciones ? `Indicaciones: ${it.indicaciones}` : null,
      ].filter(Boolean),
    })),
    totalRef: res.total_ref_cent,
    totalBs: res.total_bs_cent,
    tasa: res.tasa,
  };
}

/** «PROMOCIÓN −25 % · HASTA EL 14/11/2026» */
/** dd/mm/aaaa → dd/mm/aa */
const fechaCorta = (dia) => fmtFecha(dia).replace(/\/\d{2}(\d{2})$/, "/$1");
/** «Semana del corazón −25 % · hasta el 30/11/26» (sin nombre: «Promoción −25 % · …») */
export const textoPromo = (p) =>
  `${p.nombre || "Promoción"} −${p.pct} %${p.hasta ? ` · hasta el ${fechaCorta(p.hasta)}` : ""}`;
const hayPromos = (d) => d.items.some((it) => it.promo);
export const NOTA_PROMO =
  "Los precios marcados como promoción son especiales y solo se respetan hasta la fecha indicada en cada uno. Después de esa fecha aplican los precios regulares, aunque el presupuesto siga vigente.";

const NOTA =
  "Los precios están expresados en REF (referencial). El monto en bolívares se calcula con la tasa indicada y puede variar según la tasa vigente al momento del pago.";

export const tasaTexto = (d) =>
  !d.tasa
    ? "Tasa de cambio no disponible en este momento."
    : d.tasa.manual
    ? `Tasa aplicada: ${fmtTasa(d.tasa.valor)} Bs. por REF`
    : `Tasa BCV: ${fmtTasa(d.tasa.valor)} Bs. por REF (${fmtFecha(d.tasa.fecha_valor)})`;

const datosPaciente = (d) =>
  [
    ["Paciente", d.paciente.nombre],
    ["C.I.", d.paciente.cedula],
    ["Teléfono", d.paciente.telefono],
    ["Médico referente", d.paciente.medico],
  ].filter(([, v]) => v);
const contacto = (d) =>
  [d.rif && `RIF ${d.rif}`, d.telefono && `Tel. ${d.telefono}`, d.direccion, d.horario].filter(
    Boolean,
  );

// ─────────────────────────── Texto ───────────────────────────
export function toText(d) {
  const L = [
    "PRESUPUESTO DE EXÁMENES",
    d.nombre,
    ...contacto(d),
    "",
    `Código: ${d.codigo}`,
    `Fecha: ${fmtFecha(d.emision)}  ·  Válido hasta: ${fmtFecha(d.vigencia)}`,
  ];
  const pac = datosPaciente(d);
  if (pac.length) L.push("", ...pac.map(([k, v]) => `${k}: ${v}`));
  L.push("", "EXÁMENES Y PERFILES");
  for (const it of d.items) {
    L.push(
      `- ${it.nombre}: ${ref(it.precio_cent)}${
        it.promo ? ` (precio regular: ${ref(it.promo.antes)})` : ""
      }`,
    );
    if (it.promo) L.push(`   [${textoPromo(it.promo).toUpperCase()}]`);
    for (const x of it.detalle) L.push(`   ${x}`);
  }
  if (hayPromos(d)) L.push("", `* ${NOTA_PROMO}`);
  L.push("", `TOTAL: ${ref(d.totalRef)}`);
  if (d.tasa) L.push(`TOTAL EN BOLÍVARES: ${bs(d.totalBs)}`);
  L.push(tasaTexto(d));
  if (d.precios) L.push(`Precios actualizados el ${fmtFecha(d.precios)}.`);
  if (d.pie) L.push("", d.pie);
  return L.join("\n");
}

// ─────────────────────────── Vista previa (HTML) ───────────────────────────
export function paperHTML(d) {
  const pac = datosPaciente(d);
  return `
  <div class="ph">
    ${d.logo ? `<img src="${esc(d.logo)}" alt="">` : ""}
    <div><h2>${esc(d.nombre)}</h2><div class="muted xs">${
    contacto(d).map(esc).join("<br>")
  }</div></div>
    <div class="code"><span class="xs muted">PRESUPUESTO</span><b>${esc(d.codigo)}</b></div>
  </div>
  <div class="meta2"><span>Emisión: <b>${fmtFecha(d.emision)}</b></span><span>Válido hasta: <b>${
    fmtFecha(d.vigencia)
  }</b></span>${
    d.precios ? `<span>Precios actualizados: <b>${fmtFecha(d.precios)}</b></span>` : ""
  }</div>
  ${
    pac.length
      ? `<div class="pac">${
        pac.map(([k, v]) => `<span class="nowrap"><b>${esc(k)}:</b> ${esc(v)}</span>`).join(
          " &nbsp;·&nbsp; ",
        )
      }</div>`
      : ""
  }
  <table><thead><tr><th>Descripción</th><th style="text-align:right">Precio</th></tr></thead><tbody>
    ${
    d.items.map((it) =>
      `<tr><td><b>${esc(it.nombre)}</b>${
        it.promo ? `<span class="promo-pdf">${esc(textoPromo(it.promo))}</span>` : ""
      }${it.detalle.map((x) => `<span class="inc">${esc(x)}</span>`).join("")}</td><td class="p">${
        ref(it.precio_cent)
      }${it.promo ? `<s class="antes">${ref(it.promo.antes)}</s>` : ""}</td></tr>`
    ).join("")
  }
  </tbody></table>
  ${
    hayPromos(d)
      ? `<div class="notice info nota-promo">${icon("info")}<div>${esc(NOTA_PROMO)}</div></div>`
      : ""
  }
  <div class="tot">
    <div class="muted small">Total en REF</div><div class="big">${ref(d.totalRef)}</div>
    ${
    d.tasa
      ? `<div class="muted small" style="margin-top:8px">Total en bolívares</div><div class="big">${
        bs(d.totalBs)
      }</div>`
      : ""
  }
    <div class="muted xs" style="margin-top:6px">${esc(tasaTexto(d))}</div>
  </div>
  ${d.pie ? `<p class="small" style="margin-top:14px">${esc(d.pie)}</p>` : ""}
  <p class="note">${esc(NOTA)}</p>`;
}

// ─────────────────────────── Métricas Helvetica (AFM, en milésimas de em) ───────────────────────────
const WR = [
  278,
  278,
  355,
  556,
  556,
  889,
  667,
  191,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  278,
  278,
  584,
  584,
  584,
  556,
  1015,
  667,
  667,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  500,
  667,
  556,
  833,
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  278,
  278,
  278,
  469,
  556,
  333,
  556,
  556,
  500,
  556,
  556,
  278,
  556,
  556,
  222,
  222,
  500,
  222,
  833,
  556,
  556,
  556,
  556,
  333,
  500,
  278,
  556,
  500,
  722,
  500,
  500,
  500,
  334,
  260,
  334,
  584,
];
const WB = [
  278,
  333,
  474,
  556,
  556,
  889,
  722,
  238,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  333,
  333,
  584,
  584,
  584,
  611,
  975,
  722,
  722,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  556,
  722,
  611,
  833,
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  333,
  278,
  333,
  584,
  556,
  333,
  556,
  611,
  556,
  611,
  556,
  333,
  611,
  611,
  278,
  278,
  556,
  278,
  889,
  611,
  611,
  611,
  611,
  389,
  556,
  333,
  611,
  556,
  778,
  556,
  556,
  500,
  389,
  280,
  389,
  584,
];

/** Deja solo caracteres Latin-1 (los que el PDF puede mostrar con la fuente estándar). */
function lat1(s) {
  return String(s ?? "").normalize("NFC").replace(/\s+/g, " ")
    .replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}
function charW(ch, bold) {
  const t = bold ? WB : WR;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return t[c - 32];
  const base = ch.normalize("NFD")[0];
  const b = base.charCodeAt(0);
  if (b >= 32 && b <= 126 && base !== ch) return t[b - 32];
  if (ch === "¿") return bold ? 611 : 556;
  if (ch === "¡") return 333;
  if (ch === "°") return 400;
  return 556;
}
const textW = (s, bold, size) => {
  let w = 0;
  for (const ch of s) w += charW(ch, bold);
  return (w * size) / 1000;
};

// ─────────────────────────── Motor de maquetación ───────────────────────────
/**
 * Devuelve páginas de comandos de dibujo en unidades (pt). Origen arriba-izquierda.
 *  { t:'text', s, x, y(línea base), size, bold, color, align } · { t:'rect' } · { t:'line' } · { t:'img' }
 */
export function layoutDoc(d, { width, margin, pageH, measure }) {
  const iw = width - margin * 2;
  // Colores del sistema de diseño (modo claro: un documento impreso siempre va en claro).
  // El texto secundario usa --ink-2 y no --ink-3: en letra pequeña --ink-3 no llega a AA sobre el tinte.
  const primary = d.color || COLOR_POR_DEFECTO;
  const C = {
    ink: CLARO.ink,
    muted: CLARO["ink-2"],
    line: CLARO.line,
    lineSoft: CLARO["line-2"],
    paper: CLARO.surface,
    primary, // relleno: la raya bajo el encabezado
    primaryText: derivarAcento(primary).texto, // como texto (el código), con contraste AA
    panel: CLARO.bg, // caja del paciente
    promo: CLARO.info,
    promoBg: CLARO["info-bg"],
  };
  const pages = [[]];
  let y = margin;
  const cur = () => pages[pages.length - 1];
  const salto = (h) => {
    if (pageH && y + h > pageH - margin) {
      pages.push([]);
      y = margin;
    }
  };
  const text = (s, x, size, { bold = false, color = C.ink, align = "l" } = {}) =>
    cur().push({ t: "text", s, x, y: y + size * 0.95, size, bold, color, align });
  const rect = (x, yy, w, h, color, r = 0) => cur().push({ t: "rect", x, y: yy, w, h, color, r });
  const hline = (yy, color = C.line, w = 0.6) =>
    cur().push({ t: "line", x1: margin, y1: yy, x2: width - margin, y2: yy, color, w });
  const wrap = (s, size, bold, maxW) => {
    const out = [];
    for (const par of String(s).split("\n")) {
      let line = "";
      for (const w of par.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${w}` : w;
        if (measure(cand, bold, size) <= maxW) {
          line = cand;
          continue;
        }
        if (line) out.push(line);
        let rest = w;
        while (measure(rest, bold, size) > maxW && rest.length > 1) {
          let k = rest.length;
          while (k > 1 && measure(rest.slice(0, k), bold, size) > maxW) k--;
          out.push(rest.slice(0, k));
          rest = rest.slice(k);
        }
        line = rest;
      }
      out.push(line);
    }
    return out;
  };

  // Encabezado: logo + negocio a la izquierda, código a la derecha
  const top = y;
  const rx = width - margin;
  const logo = d._logo;
  const logoH = 44;
  const logoW = logo ? Math.min(90, (logo.w / logo.h) * logoH) : 0;
  // Como la vista previa de la app: «PRESUPUESTO» apagado y el código en el color del negocio
  text("PRESUPUESTO", rx, 8, { bold: true, color: C.muted, align: "r" });
  y = top + 12;
  text(d.codigo, rx, 15, { bold: true, color: C.primaryText, align: "r" });
  y = top;
  let x0 = margin;
  if (logo) {
    cur().push({ t: "img", x: margin, y: top, w: logoW, h: logoH });
    x0 = margin + logoW + 10;
  }
  const leftW = rx - x0 - 130;
  for (const l of wrap(d.nombre, 17, true, leftW)) {
    text(l, x0, 17, { bold: true });
    y += 20;
  }
  for (const c of contacto(d)) {
    for (const l of wrap(c, 8.5, false, leftW)) {
      text(l, x0, 8.5, { color: C.muted });
      y += 11.5;
    }
  }
  y = Math.max(y, top + logoH) + 10;
  rect(margin, y, iw, 1.6, C.primary);
  y += 12;

  // Fechas: etiqueta apagada y valor en negrita, una tras otra
  {
    let x = margin;
    const fechas = [["Emisión: ", d.emision], ["Válido hasta: ", d.vigencia]];
    if (d.precios) fechas.push(["Precios actualizados: ", d.precios]);
    for (const [k, v] of fechas) {
      const val = fmtFecha(v);
      if (x > margin && x + measure(k + val, true, 9) > rx) {
        x = margin;
        y += 13;
      }
      text(k, x, 9, { color: C.muted });
      x += measure(k, false, 9);
      text(val, x, 9, { bold: true });
      x += measure(val, true, 9) + 14;
    }
    y += 22;
  }

  const pac = datosPaciente(d);
  if (pac.length) {
    // «Paciente:» en negrita y el dato normal; los pares pasan a otra línea si no caben
    const sep = "     ·     ";
    const filas = [[]];
    let ancho = 0;
    for (const [k, v] of pac) {
      const par = [`${k}: `, v];
      const w = measure(par[0], true, 10) + measure(v, false, 10);
      const extra = filas.at(-1).length ? measure(sep, false, 10) : 0;
      if (filas.at(-1).length && ancho + extra + w > iw - 20) {
        filas.push([]);
        ancho = 0;
      }
      ancho += (filas.at(-1).length ? measure(sep, false, 10) : 0) + w;
      filas.at(-1).push(par);
    }
    const h = filas.length * 14 + 14;
    salto(h + 10);
    rect(margin, y, iw, h, C.panel, 8);
    y += 7;
    for (const fila of filas) {
      let x = margin + 10;
      fila.forEach(([k, v], i) => {
        if (i) {
          text(sep, x, 10);
          x += measure(sep, false, 10);
        }
        text(k, x, 10, { bold: true });
        x += measure(k, true, 10);
        text(v, x, 10);
        x += measure(v, false, 10);
      });
      y += 14;
    }
    y += 14;
  }

  // Tabla
  salto(70);
  y += 2;
  text("DESCRIPCIÓN", margin, 8, { bold: true, color: C.muted });
  text("PRECIO", rx, 8, { bold: true, color: C.muted, align: "r" });
  y += 14;
  hline(y, C.line, 0.8);
  const priceW = 100;
  const nameW = iw - priceW - 16;
  for (const it of d.items) {
    const nl = wrap(it.nombre, 11, true, nameW);
    const inc = it.detalle.flatMap((x) => wrap(x, 8.6, false, nameW));
    const chip = it.promo ? textoPromo(it.promo).toUpperCase() : null;
    const cw = chip ? measure(chip, true, 7.4) + 14 : 0;
    // El chip va junto al nombre si cabe en la misma línea; si no, debajo
    const chipAlLado = chip && nl.length === 1 &&
      measure(nl[0], true, 11) + 5 + cw <= nameW;
    const chipAbajo = chip && !chipAlLado;
    const altoDesc = nl.length * 14 + (chipAbajo ? 16.5 : 0) +
      (inc.length ? 3 + inc.length * 11.2 : 0);
    const altoPrecio = chip ? 26 : 14;
    const alto = Math.max(altoDesc, altoPrecio);
    salto(alto + 15);
    y += 7;
    const top = y;
    // Precio (centrado en la fila): el de promoción en tinta y debajo el regular tachado
    y = top + (alto - altoPrecio) / 2;
    text(ref(it.precio_cent), rx, 11, { bold: true, align: "r" });
    if (chip) {
      const antes = ref(it.promo.antes);
      y += 16;
      text(antes, rx, 8.6, { color: C.muted, align: "r" });
      const wa = measure(antes, false, 8.6);
      cur().push({
        t: "line",
        x1: rx - wa,
        y1: y + 5.2,
        x2: rx,
        y2: y + 5.2,
        color: C.muted,
        w: 0.7,
      });
    }
    // Descripción a la izquierda, centrada en vertical en la fila
    y = top + (alto - altoDesc) / 2;
    const pintarChip = (x, yy) => {
      rect(x, yy, cw, 13.5, C.promoBg, 6.75);
      const y0 = y;
      y = yy + 3.3;
      text(chip, x + 7, 7.4, { bold: true, color: C.promo });
      y = y0;
    };
    for (const l of nl) {
      text(l, margin, 11, { bold: true });
      if (chipAlLado) pintarChip(margin + measure(l, true, 11) + 5, y + 0.4);
      y += 14;
    }
    if (chipAbajo) {
      pintarChip(margin, y + 3);
      y += 16.5;
    }
    if (inc.length) y += 3;
    for (const l of inc) {
      text(l, margin, 8.6, { color: C.muted });
      y += 11.2;
    }
    y = top + alto + 8;
    hline(y, C.lineSoft, 0.8);
  }

  if (hayPromos(d)) {
    // Aviso con fondo y el ícono de información a la izquierda (como .notice del sistema de diseño)
    const pad = 9;
    const ico = 10;
    const lineas = wrap(NOTA_PROMO, 8.4, false, iw - pad * 2 - ico - 8);
    const h = lineas.length * 11 + pad * 2 - 2;
    y += 10;
    salto(h);
    rect(margin, y, iw, h, C.promoBg, 6);
    const cx = margin + pad + ico / 2;
    const cy = y + pad + ico / 2;
    cur().push({ t: "circle", cx, cy, r: ico / 2 - 0.5, color: C.promo, w: 1 });
    cur().push({ t: "line", x1: cx, y1: cy - 0.4, x2: cx, y2: cy + 2.6, color: C.promo, w: 1.1 });
    cur().push({ t: "circle", cx, cy: cy - 2.3, r: 0.65, color: C.promo, fill: true });
    y += pad - 1;
    for (const l of lineas) {
      text(l, margin + pad + ico + 8, 8.4, { color: C.promo });
      y += 11;
    }
    y += pad - 1;
  }

  // Totales: alineados a la derecha, sin caja (como la vista previa)
  const tasaLines = wrap(tasaTexto(d), 8.4, false, 300);
  const th = 13 + 24 + (d.tasa ? 13 + 24 + 6 : 0) + tasaLines.length * 11;
  y += hayPromos(d) ? 16 : 14;
  salto(th + 60);
  text("Total en REF", rx, 9, { color: C.muted, align: "r" });
  y += 13;
  text(ref(d.totalRef), rx, 18, { bold: true, align: "r" });
  y += 24;
  if (d.tasa) {
    y += 6;
    text("Total en bolívares", rx, 9, { color: C.muted, align: "r" });
    y += 13;
    text(bs(d.totalBs), rx, 18, { bold: true, align: "r" });
    y += 24;
  }
  y += 2;
  for (const l of tasaLines) {
    text(l, rx, 8.4, { color: C.muted, align: "r" });
    y += 11;
  }
  y += 16;

  if (d.pie) {
    for (const l of wrap(d.pie, 9.2, false, iw)) {
      salto(14);
      text(l, margin, 9.2);
      y += 12.5;
    }
  }
  y += 8;
  for (const l of wrap(NOTA, 8, false, iw)) {
    salto(12);
    text(l, margin, 8, { color: C.muted });
    y += 11;
  }

  return { pages, alto: y + margin };
}

// ─────────────────────────── Logo ───────────────────────────
async function prepararLogo(d) {
  if (d._logo !== undefined) return;
  d._logo = null;
  if (!d.logo || !d.logo.startsWith("data:image/jpeg;base64,")) return;
  try {
    const img = new Image();
    img.src = d.logo;
    await img.decode();
    const bin = atob(d.logo.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    d._logo = { img, w: img.naturalWidth, h: img.naturalHeight, bytes };
  } catch {
    d._logo = null;
  }
}

// ─────────────────────────── PDF ───────────────────────────
const bytesLatin1 = (s) => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
};

export async function toPdfBlob(d) {
  await prepararLogo(d);
  const W = 595.28;
  const H = 841.89;
  const { pages } = layoutDoc(d, {
    width: W,
    margin: 42,
    pageH: H,
    measure: (s, b, z) => textW(lat1(s), b, z),
  });
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(" ");
  };
  const pesc = (s) => s.replace(/[\\()]/g, "\\$&");
  const f = (n) => n.toFixed(2);

  const contenidos = pages.map((cmds) => {
    let c = "";
    for (const m of cmds) {
      if (m.t === "rect" && m.r) {
        // Rectángulo con esquinas redondeadas: cuatro curvas de Bézier (k ≈ 0,5523)
        const r = m.r;
        const k = r * 0.5523;
        const x0 = m.x;
        const x1 = m.x + m.w;
        const y1 = H - m.y;
        const y0 = y1 - m.h;
        c += `${rgb(m.color)} rg ${f(x0 + r)} ${f(y0)} m ${f(x1 - r)} ${f(y0)} l ` +
          `${f(x1 - r + k)} ${f(y0)} ${f(x1)} ${f(y0 + r - k)} ${f(x1)} ${f(y0 + r)} c ` +
          `${f(x1)} ${f(y1 - r)} l ${f(x1)} ${f(y1 - r + k)} ${f(x1 - r + k)} ${f(y1)} ${
            f(x1 - r)
          } ${f(y1)} c ` +
          `${f(x0 + r)} ${f(y1)} l ${f(x0 + r - k)} ${f(y1)} ${f(x0)} ${f(y1 - r + k)} ${f(x0)} ${
            f(y1 - r)
          } c ` +
          `${f(x0)} ${f(y0 + r)} l ${f(x0)} ${f(y0 + r - k)} ${f(x0 + r - k)} ${f(y0)} ${
            f(x0 + r)
          } ${f(y0)} c f\n`;
      } else if (m.t === "rect") {
        c += `${rgb(m.color)} rg ${f(m.x)} ${f(H - m.y - m.h)} ${f(m.w)} ${f(m.h)} re f\n`;
      } else if (m.t === "circle") {
        // Círculo con cuatro curvas de Bézier: relleno (f) o solo contorno (S)
        const k = m.r * 0.5523;
        const cx = m.cx;
        const cy = H - m.cy;
        const r = m.r;
        c += `${rgb(m.color)} ${m.fill ? "rg" : `RG ${m.w} w`} ${f(cx + r)} ${f(cy)} m ` +
          `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ` +
          `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ` +
          `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ` +
          `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c ${
            m.fill ? "f" : "S"
          }\n`;
      } else if (m.t === "line") {
        c += `${rgb(m.color)} RG ${m.w} w ${f(m.x1)} ${f(H - m.y1)} m ${f(m.x2)} ${
          f(H - m.y2)
        } l S\n`;
      } else if (m.t === "img") {
        c += `q ${f(m.w)} 0 0 ${f(m.h)} ${f(m.x)} ${f(H - m.y - m.h)} cm /Im1 Do Q\n`;
      } else {
        const s = lat1(m.s);
        const w = textW(s, m.bold, m.size);
        const x = m.align === "r" ? m.x - w : m.x;
        c += `${rgb(m.color)} rg BT /${m.bold ? "F2" : "F1"} ${m.size} Tf ${f(x)} ${
          f(H - m.y)
        } Td (${pesc(s)}) Tj ET\n`;
      }
    }
    return c;
  });

  const logo = d._logo;
  const primera = logo ? 6 : 5;
  const objs = [];
  objs[1] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  objs[2] = [
    `<< /Type /Pages /Kids [${
      pages.map((_, i) => `${primera + 2 * i} 0 R`).join(" ")
    }] /Count ${pages.length} >>`,
  ];
  objs[3] = ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  objs[4] = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  if (logo) {
    objs[5] = [
      `<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`,
      logo.bytes,
      "\nendstream",
    ];
  }
  pages.forEach((_, i) => {
    const pn = primera + 2 * i;
    const cb = bytesLatin1(contenidos[i]);
    objs[pn] = [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${
        logo ? " /XObject << /Im1 5 0 R >>" : ""
      } >> /Contents ${pn + 1} 0 R >>`,
    ];
    objs[pn + 1] = [`<< /Length ${cb.length} >>\nstream\n`, cb, "\nendstream"];
  });

  const out = [];
  let pos = 0;
  const add = (p) => {
    const u = typeof p === "string" ? bytesLatin1(p) : p;
    out.push(u);
    pos += u.length;
  };
  add("%PDF-1.4\n%âãÏÓ\n");
  const offs = [];
  for (let n = 1; n < objs.length; n++) {
    offs[n] = pos;
    add(`${n} 0 obj\n`);
    objs[n].forEach(add);
    add("\nendobj\n");
  }
  const xref = pos;
  add(`xref\n0 ${objs.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < objs.length; n++) add(`${String(offs[n]).padStart(10, "0")} 00000 n \n`);
  add(
    `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title (${
      pesc(lat1(`Presupuesto ${d.codigo}`))
    }) >> >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return new Blob(out, { type: "application/pdf" });
}

// ─────────────────────────── Imagen PNG ───────────────────────────
export async function toPngBlob(d) {
  await prepararLogo(d);
  const S = 2.4;
  const W = 595;
  const fam = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", system-ui, sans-serif';
  const font = (b, z) => `${b ? 700 : 400} ${z * S}px ${fam}`;
  const mctx = document.createElement("canvas").getContext("2d");
  const measure = (s, b, z) => {
    mctx.font = font(b, z);
    return mctx.measureText(s).width / S;
  };
  const { pages, alto } = layoutDoc(d, { width: W, margin: 36, pageH: 0, measure });
  const c = document.createElement("canvas");
  c.width = Math.round(W * S);
  c.height = Math.round(alto * S);
  const g = c.getContext("2d");
  g.fillStyle = CLARO.surface;
  g.fillRect(0, 0, c.width, c.height);
  g.textBaseline = "alphabetic";
  for (const m of pages[0]) {
    if (m.t === "rect") {
      g.fillStyle = m.color;
      g.beginPath();
      g.roundRect(m.x * S, m.y * S, m.w * S, m.h * S, (m.r || 0) * S);
      g.fill();
    } else if (m.t === "circle") {
      g.beginPath();
      g.arc(m.cx * S, m.cy * S, m.r * S, 0, Math.PI * 2);
      if (m.fill) {
        g.fillStyle = m.color;
        g.fill();
      } else {
        g.strokeStyle = m.color;
        g.lineWidth = m.w * S;
        g.stroke();
      }
    } else if (m.t === "line") {
      g.strokeStyle = m.color;
      g.lineWidth = m.w * S;
      g.beginPath();
      g.moveTo(m.x1 * S, m.y1 * S);
      g.lineTo(m.x2 * S, m.y2 * S);
      g.stroke();
    } else if (m.t === "img") g.drawImage(d._logo.img, m.x * S, m.y * S, m.w * S, m.h * S);
    else {
      g.font = font(m.bold, m.size);
      g.fillStyle = m.color;
      g.textAlign = m.align === "r" ? "right" : "left";
      g.fillText(m.s, m.x * S, m.y * S);
    }
  }
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo crear la imagen."))),
      "image/png",
    )
  );
}

// ─────────────────────────── Descargar / compartir / copiar ───────────────────────────
export function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const puedeCompartir = () => typeof navigator.share === "function";

/** Abre el menú de compartir del teléfono (con el archivo si el sistema lo permite, o con el texto). */
export async function compartir({ blob, nombre, titulo, texto }) {
  if (blob) {
    const file = new File([blob], nombre, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: titulo });
      return true;
    }
  }
  await navigator.share({ title: titulo, text: texto });
  return true;
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

void fmtNum;
