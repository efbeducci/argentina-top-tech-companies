// MCP server for Argentina Top Tech Companies — salary data from sysarmy survey.
// Vercel Serverless Function (ES module).
// Protocol: MCP over Streamable HTTP (2026-07-28) with JSONRPC 2.0 fallback.
//
// Salaries: annual gross in USD MEP (dólar bolsa) primary, ARS secondary.
// Source: sysarmy biannual salary survey (CC BY-NC-SA 4.0).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { QUERY_KEYWORD, KEYWORD_FORMS, yearsBucket } from "./_jobs.js";
import { words } from "./_classify.js";

const SERVER = {
  name: "tech-pay-argentina",
  title: "Argentina Top Tech Companies",
  version: "1.0.0",
};

// Versions we can speak, newest first. initialize echoes the client's version
// when supported (MCP version negotiation), else offers the newest one.
const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DATA_PATH = join(process.cwd(), "data", "data.json");
const JOBS_PATH = join(process.cwd(), "data", "jobs.json");

// --- Data loading ------------------------------------------------------------

let _data = null;
async function getData() {
  if (_data) return _data;
  const raw = await readFile(DATA_PATH, "utf-8");
  _data = JSON.parse(raw);
  return _data;
}

let _jobs = null;
async function getJobs() {
  if (_jobs) return _jobs;
  try {
    _jobs = JSON.parse(await readFile(JOBS_PATH, "utf-8"));
  } catch {
    _jobs = { generated_at: null, jobs: [] };
  }
  return _jobs;
}

// --- Job search helpers -------------------------------------------------------

const WORKPLACE_VALUES = new Set(["remote", "hybrid", "onsite"]);
const SENIORITY_VALUES = ["intern", "junior", "mid", "senior", "staff", "lead", "head"];

// A query term matches a posting's title, company or keywords. Known skills
// ("node", "react", "rails") match the keyword ids read from the description.
function queryTerms(query) {
  const w = words(query);
  if (!w) return [];
  const tokens = w.split(" ");
  const terms = [];
  for (let i = 0; i < tokens.length; i++) {
    const two = tokens.slice(i, i + 2).join(" ");
    if (i + 1 < tokens.length && QUERY_KEYWORD.has(two)) { terms.push({ text: two, keyword: QUERY_KEYWORD.get(two) }); i++; continue; }
    terms.push({ text: tokens[i], keyword: QUERY_KEYWORD.get(tokens[i]) ?? null });
  }
  return terms;
}

function matchesTerm(job, term) {
  if (term.keyword && job.keywords?.includes(term.keyword)) return true;
  const hay = ` ${words(`${job.title} ${job.company}`)} `;
  if (hay.includes(` ${term.text} `)) return true;
  return term.keyword ? (KEYWORD_FORMS.get(term.keyword) ?? []).some((f) => hay.includes(` ${f} `)) : false;
}

const isRemoteJob = (job) => job.workplace === "remote"
  || (job.location_classes ?? []).some((c) => String(c).startsWith("remote"));

const LEVEL_BUCKET = { intern: "0-1", junior: "0-1", mid: "2-4", senior: "5-7", staff: "8-11", lead: "8-11", head: "12-19" };

// The survey's median for the posting's role, in its province (else the whole
// country's biggest cell for that role), at the experience bucket asked.
function salaryReference(data, job, candidateYears) {
  const role = job.roles?.[0];
  if (!role) return null;
  // Experience: the candidate's, else what the posting asks, else what its
  // title's level usually means in the survey.
  const bucket = candidateYears != null ? yearsBucket(candidateYears)
    : job.years ? yearsBucket(job.years[0]) : LEVEL_BUCKET[job.seniority] ?? null;
  const cells = Object.entries(data.cells).filter(([k]) => {
    const [r, , y] = k.split("|");
    return r === role && (!bucket || y === bucket);
  });
  if (!cells.length) return null;
  const inProvince = cells.filter(([k]) => (job.provinces ?? []).includes(k.split("|")[1]));
  const [key, cell] = (inProvince.length ? inProvince : cells).sort((a, b) => b[1].n - a[1].n)[0];
  const [, province, years] = key.split("|");
  return { role, province, years, years_from: candidateYears != null ? "candidate" : job.years ? "posting" : job.seniority ? "title level" : "largest group", people: cell.n, median_usd: cell.median_usd,
           p25_usd: cell.p25_usd, p75_usd: cell.p75_usd, source: "sysarmy survey (annual gross, USD MEP)" };
}

// Annual USD the posting states, when it states one in USD.
function statedAnnualUSD(job) {
  const s = job.salary;
  if (!s || String(s.currency).toUpperCase() !== "USD") return null;
  const top = s.max ?? s.min;
  if (top == null) return null;
  return s.period === "month" ? top * 12 : s.period === "hour" ? top * 2000 : top;
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

  find_jobs: {
    description: "Search today's open tech job postings that a person living in Argentina can take: offices in Argentina, remote from Argentina, remote from Latin America, or remote worldwide. Postings are crawled daily from public company job boards (Greenhouse, Lever, Ashby, Workday and more) and from the job boards Get on Board, We Work Remotely, Jobicy and Himalayas; a result found on one of those names it in `via` (credit it when showing the posting) and its URL is the posting there. Each result has the apply URL and, as reference, the sysarmy survey's median salary for that role, province and experience. Every filter is optional. If nothing matches, the response says how many postings each filter removed. To apply: open the URL, read the form, draft answers from the candidate's CV and show them the full application before submitting; never submit without their explicit yes.",
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string", description: "Free text matched against title, company and the skills read from the description, e.g. 'node react', 'rails', 'data engineer python'." },
        role:      { type: "string", description: "Role slug from list_filters (software-engineer, tech-lead, devops-engineer, data-engineer, qa-engineer, ...)." },
        province:  { type: "string", description: "Argentine province code or name (CABA, BA, CBA, SF, MZA...). Remote postings are kept unless workplace excludes them." },
        workplace: { type: "string", enum: ["remote", "hybrid", "onsite"], description: "Way of working." },
        seniority: { type: "string", enum: SENIORITY_VALUES, description: "Level named in the title." },
        years:     { type: "integer", description: "The candidate's years of experience: drops postings asking for more than years+1, and picks the salary reference bucket." },
        company:   { type: "string", description: "Company name (substring)." },
        min_salary_usd: { type: "integer", description: "Minimum annual gross USD. Compared with the posting's stated USD pay, or else with the survey median for its role." },
        posted_within_days: { type: "integer", description: "Only postings published in the last N days (e.g. 7 for the last week, 30 for the last month). Postings whose board gives no date are left out and counted in undated_excluded." },
        exclude:   { type: "array", items: { type: "string" }, description: "Posting ids already seen or applied to." },
        limit:     { type: "integer", description: "Max results (default 20, max 50)." },
        context:   { type: "string", description: "Why you are calling this tool, in general terms." },
      },
    },
    async run(data, args) {
      const index = await getJobs();
      const all = index.jobs ?? [];
      if (!all.length) return { postings: 0, jobs: [], note: "No job index yet (data/jobs.json). Run: node scripts/jobs.mjs" };
      const role = args.role ? resolveRole(data, args.role)?.slug ?? null : null;
      const province = args.province ? resolveProvince(data, args.province) : null;
      const years = Number.isFinite(Number(args.years)) && args.years !== "" && args.years != null ? Number(args.years) : null;
      const terms = queryTerms(args.query ?? "");
      const company = args.company ? words(args.company) : "";
      const exclude = new Set(args.exclude ?? []);
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const workplace = WORKPLACE_VALUES.has(args.workplace) ? args.workplace : null;
      const seniority = SENIORITY_VALUES.includes(args.seniority) ? args.seniority : null;
      const minUSD = Number(args.min_salary_usd) || null;
      const withinDays = Number(args.posted_within_days) > 0 ? Number(args.posted_within_days) : null;
      const since = withinDays ? Date.now() - withinDays * 86_400_000 : null;
      const postedMs = (j) => (j.posted_at ? Date.parse(j.posted_at) : NaN);

      const filters = {
        exclude:   (j) => !exclude.has(j.id),
        query:     terms.length ? (j) => terms.every((t) => matchesTerm(j, t)) : null,
        role:      role ? (j) => j.roles?.includes(role) : null,
        province:  province ? (j) => j.provinces?.includes(province) || isRemoteJob(j) : null,
        workplace: workplace ? (j) => (workplace === "remote" ? isRemoteJob(j) : j.workplace === workplace) : null,
        seniority: seniority ? (j) => j.seniority === seniority : null,
        years:     years != null ? (j) => !j.years || j.years[0] <= years + 1 : null,
        company:   company ? (j) => words(j.company).includes(company) : null,
        posted_within_days: since ? (j) => postedMs(j) >= since : null,
        min_salary_usd: minUSD ? (j) => {
          const stated = statedAnnualUSD(j);
          if (stated != null) return stated >= minUSD;
          const ref = salaryReference(data, j, years);
          return ref ? ref.median_usd >= minUSD : false;
        } : null,
      };
      const active = Object.entries(filters).filter(([, f]) => f);
      const matched = all.filter((j) => active.every(([, f]) => f(j)));
      const shape = (j) => ({
        id: j.id, company: j.company, title: j.title, url: j.url, location: j.location,
        location_classes: j.location_classes, workplace: j.workplace, seniority: j.seniority,
        years_asked: j.years, provinces: j.provinces, roles: j.roles, keywords: j.keywords?.slice(0, 12),
        stated_salary: j.salary, posted_at: j.posted_at, ...(j.via ? { via: j.via } : {}),
        salary_reference: salaryReference(data, j, years),
      });
      const newest = (a, b) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? ""));
      const result = {
        index_generated_at: index.generated_at,
        postings_in_index: all.length,
        matched: matched.length,
        ...(since ? { posted_since: new Date(since).toISOString().slice(0, 10),
                      undated_excluded: all.filter((j) => !Number.isFinite(postedMs(j))).length } : {}),
        jobs: matched.sort(newest).slice(0, limit).map(shape),
      };
      if (!matched.length && active.length > 1) {
        // Say what each filter removes, and show the closest postings without the strictest one.
        const removedBy = Object.fromEntries(active.filter(([n]) => n !== "exclude").map(([name]) => {
          const others = active.filter(([n]) => n !== name);
          return [name, all.filter((j) => others.every(([, f]) => f(j))).length];
        }));
        const [loosen] = Object.entries(removedBy).sort((a, b) => b[1] - a[1])[0] ?? [];
        result.without_each_filter = removedBy;
        if (loosen && removedBy[loosen] > 0) {
          const others = active.filter(([n]) => n !== loosen);
          result.closest = { dropped_filter: loosen,
            jobs: all.filter((j) => others.every(([, f]) => f(j))).sort(newest).slice(0, Math.min(limit, 10)).map(shape) };
        }
      }
      return result;
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
      protocolVersion: SUPPORTED_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: SERVER,
      instructions: `Argentina tech salary MCP server. Salary data from the sysarmy survey (CC BY-NC-SA 4.0). All figures are annual gross in USD MEP (dólar bolsa) with ARS equivalents. MEP rate used is in list_filters. Job search: find_jobs lists today's open postings a person in Argentina can take, with apply URLs; when applying for someone, show them the complete application and submit only after their explicit yes.`,
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
