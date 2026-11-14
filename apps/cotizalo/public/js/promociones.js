// Promociones (panel de administración): descuentos por periodo en exámenes, perfiles o categorías.
// Si a algo le tocan varias promociones a la vez, se aplica la mayor (no se suman).
import {
  $,
  $$,
  api,
  conBoton,
  confirmar,
  esc,
  fmtFecha,
  icon,
  modal,
  norm,
  ordenable,
  ref,
  toast,
} from "./common.js";

const ESTADOS = {
  vigente: ["ok", "Vigente"],
  programada: ["warn", "Programada"],
  terminada: ["off", "Terminada"],
  pausada: ["off", "Pausada"],
};

const sumar = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Lunes a domingo de la semana de `dia`, y del 1 al último día del mes. */
const semanaDe = (dia) => {
  const dow = (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
  return [sumar(dia, -dow), sumar(dia, 6 - dow)];
};
const mesDe = (dia) => {
  const [y, m] = dia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${dia.slice(0, 7)}-01`, `${dia.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`];
};

function resumenItems(items) {
  const n = (t) => items.filter((i) => i.tipo === t).length;
  return [
    n("categoria") && `${n("categoria")} categoría${n("categoria") === 1 ? "" : "s"}`,
    n("perfil") && `${n("perfil")} perfil${n("perfil") === 1 ? "" : "es"}`,
    n("examen") && `${n("examen")} examen${n("examen") === 1 ? "" : "es"}`,
  ].filter(Boolean).join(", ");
}

export async function pPromociones(page, { catalogo, recargar }) {
  const [c, d] = await Promise.all([catalogo(true), api("/api/admin/promociones")]);
  page.innerHTML = `
    <div class="page-head"><h1>Promociones</h1><button class="btn btn-primary" id="nueva">${
    icon("plus")
  } Nueva promoción</button></div>
    <p class="muted small">Un descuento en exámenes, perfiles o categorías durante unas fechas. El paciente ve el precio de antes tachado y el nuevo, y el presupuesto guarda el precio con descuento. Si a un examen le tocan dos promociones (la suya y la de su categoría), se aplica la mayor.</p>
    <div class="tw"><table class="t"><thead><tr><th>Promoción</th><th class="right">Descuento</th><th>Fechas</th><th>Aplica a</th><th>Estado</th><th></th></tr></thead><tbody>
    ${
    d.promociones.length
      ? d.promociones.map((p) => {
        const [cls, txt] = ESTADOS[p.estado];
        return `<tr class="${
          p.estado === "terminada" || p.estado === "pausada" ? "off" : ""
        }"><td><b>${
          esc(p.nombre)
        }</b></td><td class="right nowrap" data-l="Descuento:" data-v="${p.porcentaje}"><b>−${p.porcentaje} %</b></td>
          <td class="nowrap" data-l="Fechas:" data-v="${p.desde} ${p.hasta}">${
          p.desde === p.hasta ? fmtFecha(p.desde) : `${fmtFecha(p.desde)} – ${fmtFecha(p.hasta)}`
        }</td><td class="small" data-l="Aplica a:">${esc(resumenItems(p.items))}</td>
          <td><span class="badge ${cls}">${txt}</span></td>
          <td class="acts"><button class="btn btn-sm" data-e="${p.id}">${
          icon("edit")
        } Editar</button> ${
          p.estado === "terminada"
            ? ""
            : `<button class="btn btn-sm" data-p="${p.id}">${
              p.activo ? "Pausar" : "Reanudar"
            }</button> `
        }<button class="btn btn-sm btn-danger btn-icon" data-d="${p.id}" aria-label="Eliminar ${
          esc(p.nombre)
        }">${icon("trash")}</button></td></tr>`;
      }).join("")
      : '<tr><td colspan="6" class="empty">Aún no hay promociones.</td></tr>'
  }
    </tbody></table></div>`;
  ordenable($(".t", page), { clave: "promociones" });
  $("#nueva").addEventListener("click", () => formPromocion(c, d.hoy, null, recargar));
  $(".t tbody", page).addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const p = d.promociones.find((x) => x.id === (b.dataset.e || b.dataset.p || b.dataset.d));
    if (b.dataset.e) formPromocion(c, d.hoy, p, recargar);
    if (b.dataset.p) {
      await conBoton(b, async () => {
        await api(`/api/admin/promociones/${p.id}`, { method: "PUT", body: { activo: !p.activo } });
        toast(p.activo ? "Promoción pausada" : "Promoción reanudada", "ok");
        await recargar();
      });
    }
    if (
      b.dataset.d &&
      await confirmar(
        `¿Eliminar la promoción «${p.nombre}»? Los presupuestos ya generados no cambian.`,
        {
          ok: "Eliminar",
          peligro: true,
          titulo: "Eliminar promoción",
        },
      )
    ) {
      await conBoton(b, async () => {
        await api(`/api/admin/promociones/${p.id}`, { method: "DELETE" });
        toast("Promoción eliminada", "ok");
        await recargar();
      });
    }
  });
}

function formPromocion(c, hoy, p, recargar) {
  const sel = new Set((p?.items || []).map((i) => `${i.tipo}:${i.id}`));
  const fila = (tipo, id, nombre, extra) =>
    `<label class="check" data-n="${
      esc(norm(nombre))
    }"><input type="checkbox" value="${tipo}:${id}" ${sel.has(`${tipo}:${id}`) ? "checked" : ""}> ${
      esc(nombre)
    } ${extra ? `<span class="muted small">· ${extra}</span>` : ""}</label>`;
  const examenes = c.examenes.filter((e) => !e.solo_en_perfil); // los «solo en perfil» no tienen precio propio
  const m = modal({
    ancho: true,
    titulo: p ? "Editar promoción" : "Nueva promoción",
    html: `<form id="fpr" novalidate>
      <div class="row"><div class="field"><label for="pn">Nombre</label><input id="pn" type="text" maxlength="80" placeholder="Ej.: Semana del corazón" value="${
      esc(p?.nombre)
    }"></div>
        <div class="field"><label for="pp">Descuento</label><div class="input-unit"><input id="pp" type="number" min="1" max="90" inputmode="numeric" placeholder="25" value="${
      p?.porcentaje || ""
    }"><span>%</span></div></div></div>
      <div class="field"><span class="lbl">Fechas</span>
        <div class="chips" style="margin-bottom:8px"><button type="button" class="chip" data-r="hoy">Solo hoy</button><button type="button" class="chip" data-r="semana">Esta semana</button><button type="button" class="chip" data-r="mes">Este mes</button></div>
        <div class="row"><div class="field" style="margin:0"><label for="pd">Desde</label><input id="pd" type="date" value="${
      p?.desde || hoy
    }"></div><div class="field" style="margin:0"><label for="ph">Hasta (incluido)</label><input id="ph" type="date" value="${
      p?.hasta || hoy
    }"></div></div></div>
      <div class="field"><label>Aplica a</label><input type="search" id="pq" placeholder="Buscar…" aria-label="Buscar">
        <div class="picklist" id="ppl">
          <h4>Categorías <span class="muted">(todos sus exámenes)</span></h4>${
      c.categorias.map((k) => fila("categoria", k.id, k.nombre, `${k.examenes} exámenes`)).join("")
    }
          <h4>Perfiles</h4>${
      c.perfiles.map((x) => fila("perfil", x.id, x.nombre, ref(x.precio_cent))).join("") ||
      '<p class="muted small">Sin perfiles.</p>'
    }
          <h4>Exámenes</h4>${
      examenes.map((e) => fila("examen", e.id, e.nombre, ref(e.precio_cent))).join("")
    }
        </div><div class="hint" id="prs"></div></div>
    </form>`,
    acciones: [{ texto: "Cancelar", onClick: (x) => x() }, {
      texto: "Guardar",
      clase: "btn-primary",
      onClick: async (cerrar, btn) => {
        const items = $$("#ppl input:checked", m.el).map((i) => {
          const [tipo, id] = i.value.split(":");
          return { tipo, id };
        });
        await conBoton(btn, async () => {
          const body = {
            nombre: $("#pn", m.el).value,
            porcentaje: Number($("#pp", m.el).value),
            desde: $("#pd", m.el).value,
            hasta: $("#ph", m.el).value,
            items,
            activo: p ? p.activo : true,
          };
          await api(p ? `/api/admin/promociones/${p.id}` : "/api/admin/promociones", {
            method: p ? "PUT" : "POST",
            body,
          });
          cerrar();
          toast("Promoción guardada", "ok");
          await recargar();
        });
      },
    }],
  });
  const rangos = { hoy: () => [hoy, hoy], semana: () => semanaDe(hoy), mes: () => mesDe(hoy) };
  $$("[data-r]", m.el).forEach((b) =>
    b.addEventListener("click", () => {
      const [a, z] = rangos[b.dataset.r]();
      $("#pd", m.el).value = a;
      $("#ph", m.el).value = z;
    })
  );
  const contar = () => {
    const n = $$("#ppl input:checked", m.el).length;
    $("#prs", m.el).textContent = n
      ? `${n} elegido(s).`
      : "Elige al menos un examen, perfil o categoría.";
  };
  contar();
  $("#ppl", m.el).addEventListener("change", contar);
  $("#pq", m.el).addEventListener("input", (ev) => {
    const q = norm(ev.target.value);
    $$("#ppl label", m.el).forEach((l) => {
      l.hidden = q && !l.dataset.n.includes(q);
    });
  });
  $("#fpr", m.el).addEventListener("submit", (e) => e.preventDefault());
}
