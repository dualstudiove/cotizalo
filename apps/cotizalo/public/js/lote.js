// Exámenes y perfiles en bloque: edición rápida en tabla, y exportar / importar CSV (se abre en Excel).
// El servidor valida todo junto (POST …/lote): si una fila tiene un error, no se guarda nada y se dice cuál.
import {
  $,
  $$,
  api,
  centAInput,
  conBoton,
  esc,
  icon,
  modal,
  NEGOCIO,
  norm,
  parsePrecio,
  toast,
} from "./common.js";

// ───────────── Edición rápida de exámenes ─────────────
/**
 * Convierte la lista de exámenes en una tabla editable. Solo se envían las filas que cambiaron (y las nuevas).
 * lista: los exámenes visibles con los filtros actuales.
 */
export function edicionRapida(cont, c, lista, { alTerminar }) {
  const opcionesCat = (sel) =>
    c.categorias.map((k) =>
      `<option value="${k.id}" ${k.id === sel ? "selected" : ""}>${esc(k.nombre)}</option>`
    ).join("");
  const filaHtml = (e, i) =>
    `<tr data-i="${i}" data-id="${e?.id || ""}">
      <td><input type="text" data-c="nombre" maxlength="120" value="${
      esc(e?.nombre)
    }" aria-label="Nombre" placeholder="Nombre del examen"></td>
      <td data-l="Categoría:"><select data-c="categoria_id" aria-label="Categoría">${
      opcionesCat(e?.categoria_id || c.categorias[0]?.id)
    }</select></td>
      <td data-l="Precio:"><div class="input-unit"><input type="text" data-c="precio" inputmode="decimal" value="${
      e && !e.solo_en_perfil ? centAInput(e.precio_cent) : ""
    }" aria-label="Precio" placeholder="0,00" ${
      e?.solo_en_perfil ? "disabled" : ""
    }><span>REF</span></div></td>
      <td class="centro-celda" data-l="Solo en perfil:"><input type="checkbox" data-c="solo_en_perfil" ${
      e?.solo_en_perfil ? "checked" : ""
    } aria-label="Solo dentro de un perfil"></td>
      <td data-l="Indicaciones:"><input type="text" data-c="indicaciones" maxlength="300" value="${
      esc(e?.indicaciones)
    }" aria-label="Indicaciones" placeholder="Ej.: ayuno de 8 horas"></td>
      <td class="centro-celda" data-l="Visible:"><input type="checkbox" data-c="activo" ${
      e?.activo === 0 ? "" : "checked"
    } aria-label="Visible para los pacientes"></td>
    </tr>`;

  const originales = lista.map((e) => ({ ...e }));
  cont.innerHTML = `
    <div class="notice" style="margin-bottom:10px">${
    icon("info")
  }<div>Edición rápida: cambia lo que necesites directamente en la tabla y pulsa <b>Guardar cambios</b>. Las filas cambiadas se marcan. Para la descripción, usa «Editar» en la lista normal.</div></div>
    <div class="tw rapida"><table class="t editable"><thead><tr><th>Examen</th><th>Categoría</th><th>Precio</th><th title="Solo dentro de un perfil">Solo en perfil</th><th>Indicaciones</th><th title="Visible para los pacientes">Visible</th></tr></thead>
      <tbody id="rb">${originales.map(filaHtml).join("")}</tbody></table></div>
    <div class="barra-lote"><button type="button" class="btn btn-sm" id="r-mas">${
    icon("plus")
  } Agregar fila</button>
      <span class="grow muted small" id="r-n">Sin cambios</span>
      <button type="button" class="btn" id="r-no">Cancelar</button><button type="button" class="btn btn-primary" id="r-si" disabled>Guardar cambios</button></div>`;

  const leer = (tr) => {
    const v = (k) => $(`[data-c=${k}]`, tr);
    const solo = v("solo_en_perfil").checked;
    return {
      id: tr.dataset.id || undefined,
      nombre: v("nombre").value.trim(),
      categoria_id: v("categoria_id").value,
      precio_txt: v("precio").value.trim(),
      solo_en_perfil: solo,
      indicaciones: v("indicaciones").value.trim(),
      activo: v("activo").checked,
    };
  };
  const cambio = (tr) => {
    const f = leer(tr);
    const e = originales[Number(tr.dataset.i)];
    if (!e) return f.nombre !== ""; // fila nueva: cuenta si tiene nombre
    const precio = f.solo_en_perfil ? 0 : parsePrecio(f.precio_txt);
    return f.nombre !== e.nombre || f.categoria_id !== e.categoria_id ||
      f.solo_en_perfil !== !!e.solo_en_perfil ||
      (!f.solo_en_perfil && precio !== e.precio_cent) ||
      f.indicaciones !== (e.indicaciones || "") ||
      f.activo !== !!e.activo;
  };
  const actualizar = () => {
    const n = $$("#rb tr", cont).filter((tr) => {
      const ch = cambio(tr);
      tr.classList.toggle("cambiada", ch);
      return ch;
    }).length;
    $("#r-n", cont).textContent = n ? `${n} fila${n === 1 ? "" : "s"} con cambios` : "Sin cambios";
    $("#r-si", cont).disabled = !n;
  };
  $("#rb", cont).addEventListener("input", (ev) => {
    if (ev.target.dataset.c === "solo_en_perfil") {
      $("[data-c=precio]", ev.target.closest("tr")).disabled = ev.target.checked;
    }
    ev.target.closest("tr").classList.remove("con-error");
    actualizar();
  });
  $("#rb", cont).addEventListener("change", actualizar);
  $("#r-mas", cont).addEventListener("click", () => {
    const i = $$("#rb tr", cont).length + 1000; // índice fuera de los originales: fila nueva
    $("#rb", cont).insertAdjacentHTML("beforeend", filaHtml(null, i));
    $("#rb tr:last-child [data-c=nombre]", cont).focus();
  });
  $("#r-no", cont).addEventListener("click", () => alTerminar(false));
  $("#r-si", cont).addEventListener("click", (ev) =>
    conBoton(ev.currentTarget, async () => {
      const trs = $$("#rb tr", cont).filter(cambio);
      const filas = trs.map((tr) => {
        const f = leer(tr);
        const precio = f.solo_en_perfil ? 0 : parsePrecio(f.precio_txt);
        if (!f.solo_en_perfil && precio === null) {
          tr.classList.add("con-error");
          throw new Error(
            `«${f.nombre || "Fila nueva"}»: escribe un precio válido, por ejemplo 12,50.`,
          );
        }
        const { precio_txt: _, ...resto } = f;
        return { ...resto, precio_cent: precio };
      });
      try {
        const r = await api("/api/admin/examenes/lote", { method: "POST", body: { filas } });
        toast(`Guardado: ${r.creados} nuevo(s) y ${r.actualizados} cambiado(s).`, "ok");
        alTerminar(true);
      } catch (e) {
        // «Fila 3: …» → se marca esa fila de la tabla
        const m = /^Fila (\d+): (.*)$/.exec(e.message);
        if (m && trs[Number(m[1]) - 1]) {
          const tr = trs[Number(m[1]) - 1];
          tr.classList.add("con-error");
          tr.scrollIntoView({ block: "center" });
          throw new Error(`«${leer(tr).nombre || "Fila nueva"}»: ${m[2]}`);
        }
        throw e;
      }
    }));
}

// ───────────── CSV ─────────────
/** Descarga el CSV de exámenes o de perfiles (lo genera el servidor, listo para Excel). */
export function enlaceCsv(tipo) {
  return `${NEGOCIO}/api/admin/csv/${tipo}`;
}

/** Lee un CSV con «;» o «,», comillas y BOM. Devuelve filas de texto. */
export function leerCsv(texto) {
  const t = texto.replace(/^﻿/, "");
  const primera = t.split(/\r?\n/, 1)[0] || "";
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ";" : ",";
  const filas = [];
  let fila = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ""));
}

const siNo = (v, def) => {
  const x = norm(String(v ?? "").trim());
  if (x === "") return def;
  return ["si", "s", "x", "1", "true", "verdadero", "yes"].includes(x);
};
// Excel antepone «'» a lo que parece fórmula (lo hace nuestra exportación): se quita al importar.
const texto = (v) => String(v ?? "").trim().replace(/^'(?=[=+\-@])/, "");

/** Columnas por su título (sin importar mayúsculas ni acentos). */
function columnas(cabecera, esperadas) {
  const idx = {};
  cabecera.forEach((h, i) => {
    const n = norm(h).trim();
    for (const [clave, prefijo] of Object.entries(esperadas)) {
      if (idx[clave] === undefined && n.startsWith(prefijo)) idx[clave] = i;
    }
  });
  return idx;
}

function filasExamenes(datos) {
  const [cab, ...resto] = datos;
  const ix = columnas(cab, {
    nombre: "nombre",
    categoria: "categoria",
    precio: "precio",
    indicaciones: "indicacion",
    descripcion: "descripcion",
    alias: "otros nombres",
    solo: "solo",
    activo: "activo",
  });
  if (ix.nombre === undefined || ix.categoria === undefined) {
    throw new Error(
      "El archivo necesita al menos las columnas «Nombre» y «Categoría» (usa «Exportar CSV» como modelo).",
    );
  }
  return resto.map((f, i) => {
    const solo = siNo(f[ix.solo], false);
    const precioTxt = texto(f[ix.precio]);
    const precio = solo ? 0 : parsePrecio(precioTxt);
    if (!solo && precio === null) {
      throw new Error(`Fila ${i + 2}: el precio «${precioTxt}» no es válido.`);
    }
    const fila = {
      nombre: texto(f[ix.nombre]),
      categoria: texto(f[ix.categoria]),
      precio_cent: precio,
      solo_en_perfil: solo,
      activo: siNo(f[ix.activo], true),
    };
    if (ix.indicaciones !== undefined) fila.indicaciones = texto(f[ix.indicaciones]);
    if (ix.descripcion !== undefined) fila.descripcion = texto(f[ix.descripcion]);
    if (ix.alias !== undefined) fila.alias = texto(f[ix.alias]);
    return fila;
  });
}

function filasPerfiles(datos) {
  const [cab, ...resto] = datos;
  const ix = columnas(cab, {
    nombre: "nombre",
    precio: "precio",
    examenes: "examenes",
    indicaciones: "indicacion",
    descripcion: "descripcion",
    activo: "activo",
  });
  if (ix.nombre === undefined || ix.precio === undefined || ix.examenes === undefined) {
    throw new Error(
      "El archivo necesita las columnas «Nombre», «Precio» y «Exámenes» (usa «Exportar CSV» como modelo).",
    );
  }
  return resto.map((f, i) => {
    const precioTxt = texto(f[ix.precio]);
    const precio = parsePrecio(precioTxt);
    if (precio === null) throw new Error(`Fila ${i + 2}: el precio «${precioTxt}» no es válido.`);
    const fila = {
      nombre: texto(f[ix.nombre]),
      precio_cent: precio,
      examenes: texto(f[ix.examenes]).split("|").map((x) => x.trim()).filter(Boolean),
      activo: siNo(f[ix.activo], true),
    };
    if (ix.indicaciones !== undefined) fila.indicaciones = texto(f[ix.indicaciones]);
    if (ix.descripcion !== undefined) fila.descripcion = texto(f[ix.descripcion]);
    return fila;
  });
}

/**
 * Importar un CSV: se lee en el navegador, el servidor dice qué haría (simular) y, si se confirma, se guarda.
 * Las filas del servidor («Fila 3») cuentan desde la primera fila de datos; aquí se traducen a la fila del archivo.
 */
export function importarCsv(tipo, { alTerminar }) {
  const esEx = tipo === "examenes";
  const m = modal({
    titulo: esEx ? "Importar exámenes desde CSV" : "Importar perfiles desde CSV",
    html: `<p>${
      esEx
        ? "Columnas: <b>Nombre</b>, <b>Categoría</b>, <b>Precio (REF)</b> y, si quieres, Indicaciones, Descripción, Solo en perfil (sí/no) y Activo (sí/no)."
        : "Columnas: <b>Nombre</b>, <b>Precio (REF)</b>, <b>Exámenes</b> (sus nombres separados por «|») y, si quieres, Indicaciones, Descripción y Activo (sí/no). Los exámenes deben existir antes."
    }</p>
      <p class="muted small">Si un ${
      esEx ? "examen" : "perfil"
    } ya existe con el mismo nombre, se actualiza; si no, se crea. ${
      esEx ? "Las categorías que no existan se crean. " : ""
    }Lo más fácil: pulsa «Exportar CSV», edítalo en Excel y vuelve a importarlo.</p>
      <div class="field"><label for="ci">Archivo .csv</label><input id="ci" type="file"></div>
      <div id="cr"></div>`,
    acciones: [
      { texto: "Cancelar", onClick: (x) => x() },
      {
        texto: "Revisar",
        clase: "btn-primary",
        onClick: async (cerrar, b) => {
          await conBoton(b, async () => {
            if (b.dataset.filas) {
              // Segundo paso: guardar de verdad
              const r = await api(`/api/admin/${tipo}/lote`, {
                method: "POST",
                body: { filas: JSON.parse(b.dataset.filas) },
              });
              cerrar();
              toast(`Importado: ${r.creados} nuevo(s) y ${r.actualizados} actualizado(s).`, "ok");
              alTerminar(true);
              return;
            }
            const f = $("#ci", m.el).files[0];
            if (!f) throw new Error("Elige un archivo.");
            if (f.size > 1_500_000) {
              throw new Error("El archivo es demasiado grande (máximo 1,5 MB).");
            }
            const datos = leerCsv(await f.text());
            if (datos.length < 2) throw new Error("El archivo no tiene filas de datos.");
            const filas = esEx ? filasExamenes(datos) : filasPerfiles(datos);
            let r;
            try {
              r = await api(`/api/admin/${tipo}/lote`, {
                method: "POST",
                body: { filas, simular: true },
              });
            } catch (e) {
              const mm = /^Fila (\d+): (.*)$/.exec(e.message);
              throw mm ? new Error(`Fila ${Number(mm[1]) + 1} del archivo: ${mm[2]}`) : e;
            }
            $("#cr", m.el).innerHTML = `<div class="notice ok">${
              icon("check")
            }<div>Se van a crear <b>${r.creados}</b> y actualizar <b>${r.actualizados}</b>; ${r.sin_cambios} sin cambios.${
              r.categorias_nuevas?.length
                ? ` Categorías nuevas: ${esc(r.categorias_nuevas.join(", "))}.`
                : ""
            }</div></div>`;
            if (r.creados + r.actualizados === 0) {
              b.textContent = "Revisar";
              throw new Error("No hay nada que cambiar.");
            }
            b.dataset.filas = JSON.stringify(filas);
            setTimeout(() => (b.textContent = "Importar"), 0);
          });
        },
      },
    ],
  });
  $("#ci", m.el).addEventListener("change", () => {
    const b = $(".acts .btn-primary", m.el);
    delete b.dataset.filas;
    b.textContent = "Revisar";
    $("#cr", m.el).innerHTML = "";
  });
}
