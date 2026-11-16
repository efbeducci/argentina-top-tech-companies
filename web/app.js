"use strict";
// Argentina Top Tech Companies — web frontend
// Salaries shown in USD MEP (primary) with ARS in tooltip on hover.

(function () {
  const LANG = document.documentElement.lang || "es";
  const LOCALE = "es-AR";
  const DATA_URL = "/api/v1/data.json";

  const $ = (sel, ctx) => (ctx ?? document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx ?? document).querySelectorAll(sel)];
  const h = (tag, attrs, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("data-")) el.setAttribute(k, v);
      else el[k] = v;
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(typeof c === "string" ? c : c);
    }
    return el;
  };

  // --- Currency formatters --------------------------------------------------

  const moneyUSD = (n) => n == null ? "—"
    : "$" + Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 0 }) + " USD";

  const moneyARS = (n) => n == null ? "—"
    : "$" + Number(n).toLocaleString(LOCALE, { maximumFractionDigits: 0 }) + " ARS";

  // Pay shade based on USD annual value
  const SHADE_EDGES_USD = [10000, 18000, 25000, 40000];
  const shade = (usd) => {
    if (!usd) return "0";
    for (let i = SHADE_EDGES_USD.length - 1; i >= 0; i--) {
      if (usd >= SHADE_EDGES_USD[i]) return String(i + 2);
    }
    return "1";
  };

  // --- State ----------------------------------------------------------------
  let D = null;
  const state = {
    role:     null,
    province: null,
    years:    null,
    sort:     "median_usd",
    asc:      false,
    q:        "",
  };

  // --- Data helpers ---------------------------------------------------------

  const cell = (role, province, years) =>
    D?.cells?.[`${role}|${province}|${years}`] ?? null;

  // --- Render ---------------------------------------------------------------

  function renderSample() {
    if (!D?.sample) return;
    const notice = h("div", { class: "sample-notice" },
      "⚠️ Estos son datos de muestra. Para datos reales, corré el pipeline: ",
      h("code", {}, "python3 scripts/ingest_sysarmy.py encuesta.csv --mep-rate 1250")
    );
    const main = $("main");
    if (main) main.prepend(notice);
  }

  function renderFilterBar() {
    const bar = $("#filter-bar");
    if (!bar || !D) return;
    bar.innerHTML = "";

    // Role selector
    const roleSelect = h("select", { id: "sel-role", "aria-label": "Rol" },
      h("option", { value: "" }, LANG === "es" ? "Todos los roles" : "All roles"),
      ...D.roles.map((r) => h("option", { value: r.slug }, r.name))
    );
    roleSelect.value = state.role ?? "";
    roleSelect.addEventListener("change", () => { state.role = roleSelect.value || null; renderAll(); });

    // Province selector
    const provSelect = h("select", { id: "sel-province", "aria-label": "Provincia" },
      h("option", { value: "" }, LANG === "es" ? "Todo el país" : "All provinces"),
      ...Object.entries(D.provinces).map(([code, v]) =>
        h("option", { value: code }, v.es))
    );
    provSelect.value = state.province ?? "";
    provSelect.addEventListener("change", () => { state.province = provSelect.value || null; renderAll(); });

    // Years selector
    const yearsSelect = h("select", { id: "sel-years", "aria-label": "Experiencia" },
      h("option", { value: "" }, LANG === "es" ? "Todos los años" : "All years"),
      ...D.years.map((y) => h("option", { value: y }, `${y} años`))
    );
    yearsSelect.value = state.years ?? "";
    yearsSelect.addEventListener("change", () => { state.years = yearsSelect.value || null; renderAll(); });

    bar.append(
      h("div", { class: "filter-item" }, h("label", { for: "sel-role" }, "Rol: "), roleSelect),
      h("div", { class: "filter-item" }, h("label", { for: "sel-province" }, "Provincia: "), provSelect),
      h("div", { class: "filter-item" }, h("label", { for: "sel-years" }, "Experiencia: "), yearsSelect),
    );
  }

  function renderSummary() {
    const wrap = $("#summary");
    if (!wrap || !D) return;
    wrap.innerHTML = "";

    // Gather visible cells
    const matches = Object.entries(D.cells).filter(([key]) => {
      const [r, p, y] = key.split("|");
      return (!state.role || r === state.role)
          && (!state.province || p === state.province)
          && (!state.years || y === state.years);
    }).map(([, v]) => v);

    if (!matches.length) {
      wrap.append(h("p", { class: "cell-empty" }, "Sin datos para esta selección."));
      return;
    }

    const medians = matches.map((v) => v.median_usd).filter(Boolean).sort((a, b) => a - b);
    const overall = medians[Math.floor(medians.length / 2)] ?? null;
    const totalPeople = matches.reduce((s, v) => s + (v.n ?? 0), 0);
    const wellPaid = matches.reduce((s, v) => s + (v.n ?? 0) * (v.share ?? 0), 0) / (totalPeople || 1);

    const threshStr = moneyUSD(D.threshold_usd);

    wrap.append(
      card("Mediana general", moneyUSD(overall), `USD MEP anual bruto`),
      card("En pesos", overall ? moneyARS(Math.round(overall * D.mep_rate)) : "—", `MEP $${D.mep_rate.toLocaleString(LOCALE)} ARS/USD`),
      card("Respuestas", totalPeople.toLocaleString(LOCALE), "en la selección"),
      card(`Ganan >${threshStr}`, `${Math.round(wellPaid * 100)}%`, "de los respondentes"),
    );
  }

  function card(label, value, sub) {
    return h("div", { class: "card" },
      h("div", { class: "label" }, label),
      h("div", { class: "value" }, value),
      h("div", { class: "sub" }, sub),
    );
  }

  function renderMatrix() {
    const wrap = $("#matrix-wrap");
    if (!wrap || !D) return;
    wrap.innerHTML = "";

    const roles = state.role
      ? D.roles.filter((r) => r.slug === state.role)
      : D.roles;
    const years = state.years ? [state.years] : D.years;
    const province = state.province ?? "CABA";

    const title = h("h2", { class: "section-title" },
      `Sueldos por rol y experiencia — ${D.provinces[province]?.es ?? province}`
    );
    wrap.append(title);

    const table = h("table", { class: "matrix" });
    const thead = h("thead", {});
    const headerRow = h("tr", {});
    headerRow.append(h("th", { class: "role-col" }, "Rol"));
    for (const y of years) headerRow.append(h("th", {}, y + " años"));
    thead.append(headerRow);
    table.append(thead);

    const tbody = h("tbody", {});
    for (const role of roles) {
      const tr = h("tr", {});
      tr.append(h("td", { class: "role-col" }, role.name));
      for (const y of years) {
        const c = cell(role.slug, province, y);
        if (!c || c.n < (D.min_group ?? 5)) {
          tr.append(h("td", {}, h("span", { class: "cell-empty" }, "—")));
        } else {
          const s = shade(c.median_usd);
          const tooltipLines = [
            `Mediana: ${moneyUSD(c.median_usd)}`,
            `Rango: ${moneyUSD(c.p25_usd)} – ${moneyUSD(c.p75_usd)}`,
            `En pesos: ${moneyARS(c.median_ars)}`,
            `Rango ARS: ${moneyARS(c.p25_ars)} – ${moneyARS(c.p75_ars)}`,
            `Personas: ${c.n}`,
          ];
          const cell_el = h("span",
            { class: "cell-pay", "data-shade": s },
            moneyUSD(c.median_usd),
            h("span", { class: "n" }, `n=${c.n}`),
            h("div", { class: "tooltip" }, tooltipLines.join("\n")),
          );
          tr.append(h("td", {}, cell_el));
        }
      }
      tbody.append(tr);
    }
    table.append(tbody);

    const matrixWrap = h("div", { class: "matrix-wrap" }, table);
    wrap.append(matrixWrap);

    renderLegend(wrap);
  }

  function renderLegend(container) {
    const labels = [
      ["var(--s1)", `< ${moneyUSD(SHADE_EDGES_USD[0])}`],
      ["var(--s2)", `${moneyUSD(SHADE_EDGES_USD[0])} – ${moneyUSD(SHADE_EDGES_USD[1])}`],
      ["var(--s3)", `${moneyUSD(SHADE_EDGES_USD[1])} – ${moneyUSD(SHADE_EDGES_USD[2])}`],
      ["var(--s4)", `${moneyUSD(SHADE_EDGES_USD[2])} – ${moneyUSD(SHADE_EDGES_USD[3])}`],
      ["var(--s5)", `> ${moneyUSD(SHADE_EDGES_USD[3])}`],
    ];
    const legend = h("div", { class: "legend" },
      ...labels.map(([bg, label]) => h("div", { class: "legend-item" },
        h("span", { class: "legend-swatch", style: `background:${bg}` }),
        label
      ))
    );
    container.append(legend);
  }

  function renderCompanies() {
    const wrap = $("#companies-wrap");
    if (!wrap || !D) return;
    wrap.innerHTML = "";

    const title = h("h2", { class: "section-title" }, "Empresas top");
    wrap.append(title);

    let companies = [...D.companies];
    if (state.q) {
      const q = state.q.toLowerCase();
      companies = companies.filter((c) => c.name.toLowerCase().includes(q));
    }

    const { sort, asc } = state;
    companies.sort((a, b) => {
      const diff = (a[sort] ?? 0) - (b[sort] ?? 0);
      return asc ? diff : -diff;
    });

    if (!companies.length) {
      wrap.append(h("p", { class: "cell-empty" }, "Sin empresas para mostrar."));
      return;
    }

    const maxMedian = Math.max(...companies.map((c) => c.median_usd ?? 0));

    const cols = [
      { key: "name", label: "Empresa", sortable: false },
      { key: "n", label: "Respuestas" },
      { key: "median_usd", label: "Mediana (USD)" },
      { key: "p25_usd", label: "P25 (USD)" },
      { key: "p75_usd", label: "P75 (USD)" },
      { key: "median_ars", label: "Mediana (ARS)" },
    ];

    const table = h("table", { class: "companies" });
    const thead = h("thead", {});
    const headerRow = h("tr", {});
    for (const col of cols) {
      const th = h("th", {
        class: state.sort === col.key ? (state.asc ? "asc" : "desc") : "",
      }, col.label);
      if (col.sortable !== false) {
        th.style.cursor = "pointer";
        th.addEventListener("click", () => {
          if (state.sort === col.key) state.asc = !state.asc;
          else { state.sort = col.key; state.asc = false; }
          renderCompanies();
        });
      }
      headerRow.append(th);
    }
    thead.append(headerRow);
    table.append(thead);

    const tbody = h("tbody", {});
    for (const co of companies) {
      const few = co.n < (D.min_group ?? 5);
      const barWidth = maxMedian > 0 ? Math.round((co.median_usd / maxMedian) * 100) : 0;

      const nameCell = h("td", {},
        h("span", { class: "co-name" }, co.name),
        co.linkedin ? h("a", { class: "co-link", href: `https://linkedin.com/company/${co.linkedin}`, target: "_blank", rel: "noopener" }, "↗") : null,
      );

      const medianCell = h("td", {},
        h("div", { class: "bar-wrap" },
          h("div", { class: "bar", style: `width:${barWidth}px;max-width:80px` }),
          h("span", {}, moneyUSD(co.median_usd)),
          few ? h("span", { class: "few", title: "Menos de 5 respuestas" }, "*") : null,
        )
      );

      const tr = h("tr", {},
        nameCell,
        h("td", {}, String(co.n)),
        medianCell,
        h("td", {}, moneyUSD(co.p25_usd)),
        h("td", {}, moneyUSD(co.p75_usd)),
        h("td", {}, moneyARS(co.median_ars)),
      );
      tbody.append(tr);
    }
    table.append(tbody);

    const searchBox = h("input", {
      type: "search",
      placeholder: "Buscar empresa…",
      value: state.q,
      "aria-label": "Buscar empresa",
      style: "margin-bottom:0.75rem;padding:0.3rem 0.6rem;border:1px solid var(--line);border-radius:4px;font:inherit;background:var(--bg2);color:var(--ink);width:100%;max-width:280px",
    });
    searchBox.addEventListener("input", () => { state.q = searchBox.value; renderCompanies(); });

    wrap.append(searchBox, h("div", { class: "companies-wrap" }, table));
    if (companies.some((c) => c.n < (D.min_group ?? 5))) {
      wrap.append(h("p", { style: "font-size:0.78rem;color:var(--ink3);margin-top:0.5rem" },
        "* Menos de 5 respuestas; cifra orientativa."));
    }
  }

  function renderAll() {
    renderFilterBar();
    renderSummary();
    renderMatrix();
    renderCompanies();
  }

  // --- Init -----------------------------------------------------------------

  async function main() {
    const loading = $("#loading");
    try {
      const res = await fetch(DATA_URL + "?v=" + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D = await res.json();
    } catch (e) {
      if (loading) loading.textContent = "Error cargando datos: " + e.message;
      return;
    }

    if (loading) loading.remove();
    renderSample();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
