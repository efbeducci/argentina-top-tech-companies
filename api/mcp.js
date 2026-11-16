// MCP server for Argentina Top Tech Companies — salary data from sysarmy survey.
// Vercel Serverless Function (ES module).
// Protocol: MCP over Streamable HTTP (2026-07-28) with JSONRPC 2.0 fallback.
//
// Salaries: annual gross in USD MEP (dólar bolsa) primary, ARS secondary.
// Source: sysarmy biannual salary survey (CC BY-SA 4.0).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SERVER = {
  name: "tech-pay-argentina",
  title: "Argentina Top Tech Companies",
  version: "1.0.0",
};

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2024-11-05";
const DATA_PATH = join(process.cwd(), "data", "data.json");

// --- Data loading ------------------------------------------------------------

let _data = null;
async function getData() {
  if (_data) return _data;
  const raw = await readFile(DATA_PATH, "utf-8");
  _data = JSON.parse(raw);
  return _data;
}

// --- Tool helpers ------------------------------------------------------------

function figures(cell) {
  if (!cell) return null;
  return {
    people:         cell.n,
    median_usd:     cell.median_usd,
    p25_usd:        cell.p25_usd,
    p75_usd:        cell.p75_usd,
    median_total_usd: cell.total_usd,
    median_ars:     cell.median_ars,
    p25_ars:        cell.p25_ars,
    p75_ars:        cell.p75_ars,
    share_at_threshold: cell.share,
  };
}

function resolveRole(data, role) {
  if (!role) return null;
  const slug = String(role).toLowerCase().trim();
  return data.roles.find((r) => r.slug === slug || r.name.toLowerCase().includes(slug)) ?? null;
}

function resolveProvince(data, prov) {
  if (!prov) return null;
  const up = String(prov).toUpperCase().trim();
  if (data.provinces[up]) return up;
  const lo = prov.toLowerCase().trim();
  return Object.entries(data.provinces).find(
    ([, v]) => v.es.toLowerCase().includes(lo) || v.en.toLowerCase().includes(lo)
  )?.[0] ?? null;
}

function resolveYears(data, years) {
  if (!years) return null;
  const y = String(years).trim();
  if (data.years.includes(y)) return y;
  const n = parseInt(y, 10);
  if (!Number.isFinite(n)) return null;
  if (n <= 1)  return "0-1";
  if (n <= 4)  return "2-4";
  if (n <= 7)  return "5-7";
  if (n <= 11) return "8-11";
  if (n <= 19) return "12-19";
  return "20+";
}

function cellKey(role, province, years) {
  return `${role}|${province}|${years}`;
}

function moneyUSD(n) {
  if (n == null) return null;
  return `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
}

function moneyARS(n) {
  if (n == null) return null;
  return `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })} ARS`;
}

// Try widening the selection when no cell is found.
function widen(data, role, province, years) {
  const combos = [];
  if (province && years) combos.push([role, null, years], [role, province, null]);
  if (province && !years) combos.push([role, null, null]);
  if (!province && years) combos.push([role, null, null]);
  const tried = [];
  for (const [r, p, y] of combos) {
    const key = cellKey(r, p ?? "ALL", y ?? "all");
    // Try all cells that match role (and optionally province or years)
    const matching = Object.entries(data.cells).filter(([k]) => {
      const [kr, kp, ky] = k.split("|");
      return kr === r && (p == null || kp === p) && (y == null || ky === y);
    });
    if (matching.length) {
      const agg = matching.flatMap(([, v]) => Array(v.n).fill(null).map(() => v.median_usd));
      tried.push({ dropped: p == null ? "province" : "years", options: matching.length });
    }
  }
  return tried;
}

// --- Tools -------------------------------------------------------------------

const TOOLS = {

  salary_stats: {
    description: "Annual gross salary statistics for a role in Argentina, in USD MEP (dólar bolsa) and ARS, from the sysarmy survey. Figures are rounded medians of real salaries.",
    inputSchema: {
      type: "object",
      properties: {
        role:     { type: "string", description: "Role slug (e.g. software-engineer, tech-lead, data-scientist). Use list_filters for all slugs." },
        province: { type: "string", description: "Argentine province code or name (e.g. CABA, CBA, BA, SF). Omit for national figures." },
        years:    { type: "string", description: "Years of experience as a bucket (0-1, 2-4, 5-7, 8-11, 12-19, 20+) or an integer." },
        context:  { type: "string", description: "Why you are calling this tool, in general terms." },
      },
      required: ["role"],
    },
    async run(data, args) {
      const roleObj = resolveRole(data, args.role);
      if (!roleObj) {
        return { error: "unknown_role", message: `Role not found. Use list_filters for valid slugs.`, valid_roles: data.roles.map((r) => r.slug) };
      }
      const prov  = resolveProvince(data, args.province);
      const years = resolveYears(data, args.years);

      // Try exact cell first, then widen
      const key = cellKey(roleObj.slug, prov ?? "CABA", years ?? "5-7");
      const cell = data.cells[key];

      if (cell && cell.n >= data.min_group) {
        const f = figures(cell);
        return {
          role: roleObj.name,
          province: prov ? (data.provinces[prov]?.es ?? prov) : null,
          years: years,
          people: f.people,
          currency_note: `USD MEP (dólar bolsa, tipo de cambio referencia: $${data.mep_rate} ARS/USD al momento de la encuesta)`,
          median_usd: f.median_usd,
          p25_usd:    f.p25_usd,
          p75_usd:    f.p75_usd,
          median_total_usd: f.median_total_usd,
          median_ars: f.median_ars,
          p25_ars:    f.p25_ars,
          p75_ars:    f.p75_ars,
          share_at_threshold: f.share_at_threshold,
          threshold_usd: data.threshold_usd,
          data_date: data.date,
          source: data.source,
        };
      }

      // Try widening
      const wider = [];
      const provsToTry = prov ? [prov, null] : [null];
      const yearsToTry = years ? [years, null] : [null];
      for (const p of provsToTry) {
        for (const y of yearsToTry) {
          if (p === prov && y === years) continue;
          const matches = Object.entries(data.cells).filter(([k, v]) => {
            const [kr, kp, ky] = k.split("|");
            return kr === roleObj.slug && (p == null || kp === p) && (y == null || ky === y) && v.n >= data.min_group;
          });
          if (matches.length) {
            wider.push({ dropped: p == null && y == null ? "province and years" : p == null ? "province" : "years", available: matches.length });
          }
        }
      }

      return {
        error: "no_data",
        message: `No data for ${roleObj.name}${prov ? ` in ${data.provinces[prov]?.es ?? prov}` : ""}${years ? ` with ${years} years` : ""} (fewer than ${data.min_group} responses). ${wider.length ? "Widen the selection:" : "No data for this combination."}`,
        wider_selections: wider,
        role: roleObj.slug,
        province: prov,
        years,
      };
    },
  },

  top_companies: {
    description: "Top Argentine tech companies with salary data, ranked by median USD. Each company shows median and middle-half (p25–p75) in USD MEP and ARS.",
    inputSchema: {
      type: "object",
      properties: {
        role:     { type: "string", description: "Filter by role slug. Omit for all roles combined." },
        province: { type: "string", description: "Filter by province. Omit for all provinces." },
        years:    { type: "string", description: "Filter by experience bucket. Omit for all." },
        search:   { type: "string", description: "Search companies by name." },
        limit:    { type: "integer", description: "Max companies to return (default 15, max 30).", default: 15 },
        context:  { type: "string" },
      },
    },
    async run(data, args) {
      let companies = [...data.companies];

      if (args.search) {
        const q = args.search.toLowerCase();
        companies = companies.filter((c) => c.name.toLowerCase().includes(q));
      }

      const limit = Math.min(Number(args.limit ?? 15), 30);
      companies = companies
        .filter((c) => c.n >= data.min_ranked)
        .sort((a, b) => (b.median_usd ?? 0) - (a.median_usd ?? 0))
        .slice(0, limit);

      return {
        companies: companies.map((c) => ({
          name: c.name,
          people: c.n,
          median_usd: c.median_usd,
          p25_usd:    c.p25_usd,
          p75_usd:    c.p75_usd,
          median_ars: c.median_ars,
          few: c.n < data.min_group,
          linkedin: c.linkedin ?? null,
          web: c.web ?? null,
        })),
        currency_note: `USD MEP (dólar bolsa, $${data.mep_rate} ARS/USD al momento de la encuesta)`,
        data_date: data.date,
        source: data.source,
        total: companies.length,
      };
    },
  },

  company_salaries: {
    description: "Salary data for a single Argentine company, in USD MEP and ARS. Returns overall median and breakdown by role or experience if enough data.",
    inputSchema: {
      type: "object",
      properties: {
        name:    { type: "string", description: "Company name (partial match ok)." },
        role:    { type: "string", description: "Filter by role slug." },
        province:{ type: "string", description: "Filter by province." },
        years:   { type: "string", description: "Filter by experience bucket." },
        context: { type: "string" },
      },
      required: ["name"],
    },
    async run(data, args) {
      const q = String(args.name).toLowerCase();
      const matches = data.companies.filter((c) => c.name.toLowerCase().includes(q));
      if (!matches.length) {
        const close = data.companies
          .map((c) => ({ name: c.name, score: c.name.toLowerCase().split(" ").filter((w) => q.includes(w)).length }))
          .filter((c) => c.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => c.name);
        return { error: "not_found", message: `Company "${args.name}" not found.`, close_names: close };
      }
      const company = matches[0];
      return {
        name: company.name,
        people: company.n,
        median_usd:   company.median_usd,
        p25_usd:      company.p25_usd,
        p75_usd:      company.p75_usd,
        median_ars:   company.median_ars,
        p25_ars:      company.p25_ars ?? null,
        p75_ars:      company.p75_ars ?? null,
        few: company.n < data.min_group,
        currency_note: `USD MEP (dólar bolsa, $${data.mep_rate} ARS/USD al momento de la encuesta)`,
        linkedin: company.linkedin ?? null,
        web: company.web ?? null,
        data_date: data.date,
        source: data.source,
      };
    },
  },

  list_filters: {
    description: "Valid role slugs, province codes, experience buckets, and data metadata for Argentina tech salary data.",
    inputSchema: {
      type: "object",
      properties: {
        context: { type: "string" },
      },
    },
    async run(data) {
      return {
        roles: data.roles,
        provinces: Object.entries(data.provinces).map(([code, v]) => ({ code, name_es: v.es, name_en: v.en })),
        years_buckets: data.years,
        min_group: data.min_group,
        mep_rate: data.mep_rate,
        threshold_usd: data.threshold_usd,
        threshold_ars: data.threshold_ars,
        data_date: data.date,
        source: data.source,
        currency_note: "All salary figures are annual gross. USD values use the MEP (dólar bolsa) exchange rate at time of survey. ARS values are the original peso figures.",
      };
    },
  },
};

// --- JSONRPC dispatch --------------------------------------------------------

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function err(id, code, message, data_) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data_ ? { data: data_ } : {}) } };
}

async function handle(body) {
  const { method, id, params } = body ?? {};

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: MODERN_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER,
      instructions: `Argentina tech salary MCP server. Salary data from the sysarmy survey (CC BY-SA 4.0). All figures are annual gross in USD MEP (dólar bolsa) with ARS equivalents. MEP rate used is in list_filters. No job-search tools in this version.`,
    });
  }

  if (method === "tools/list") {
    return ok(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params ?? {};
    const tool = TOOLS[name];
    if (!tool) return err(id, -32601, `Unknown tool: ${name}`);
    try {
      const data = await getData();
      const result = await tool.run(data, args ?? {});
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (e) {
      return err(id, -32603, e.message ?? "Internal error");
    }
  }

  if (method === "ping") return ok(id, {});
  return err(id, -32601, `Method not found: ${method}`);
}

// --- Vercel handler ----------------------------------------------------------

export default async function handler(req, res) {
  const origin = req.headers["origin"] ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    // Health check / server info
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({
      name: SERVER.name,
      title: SERVER.title,
      version: SERVER.version,
      mcp_endpoint: "/mcp",
      description: "Argentina tech salary data from sysarmy survey. Salaries in USD MEP and ARS.",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];

  try {
    const responses = await Promise.all(requests.map(handle));
    const result = isBatch ? responses : responses[0];
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
