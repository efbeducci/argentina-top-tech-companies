// Get on Board (getonbrd.com): the tech job board of Latin America. Public
// API, https://www.getonbrd.com/api-docs. Each posting says how remote it is
// (fully_remote, remote_local with the countries it takes, hybrid,
// no_remote) and its cities; pay is gross USD a month.

import { iso, remoteScope, text } from "./common.js";

const API = "https://www.getonbrd.com/api/v0";
const CATEGORIES = ["programming", "sysadmin-devops-qa", "data-science-analytics", "machine-learning-ai",
  "mobile-developer", "cybersecurity", "design-ux", "innovation-agile"];
const EXPAND = encodeURIComponent(JSON.stringify(["company", "location_tenants", "location_regions", "location_cities"]));
const MAX_PAGES = 10;

const names = (rel) => (rel?.data ?? []).map((x) => x.attributes?.name ?? x.id);

/** One item of ours from a Get on Board job, or null when nobody in Argentina could take it. */
export function item(job) {
  const a = job.attributes;
  const cities = (a.location_cities?.data ?? []).map((c) => c.attributes).filter(Boolean);
  let cls;
  let location;
  let workplace;
  if (a.remote_modality === "fully_remote") {
    cls = "remote-global"; location = "Remote"; workplace = "remote";
  } else if (a.remote_modality === "remote_local") {
    const where = [...names(a.location_tenants), ...names(a.location_regions)];
    cls = remoteScope(where.length ? where : a.countries);
    location = `Remote (${(where.length ? where : a.countries).join(", ")})`;
    workplace = "remote";
  } else {
    if (!(a.countries ?? []).some((c) => /^argentina$/i.test(c))) return null;
    const here = cities.filter((c) => /^argentina$/i.test(c.country)).map((c) => `${c.name}, Argentina`);
    cls = "argentina"; location = here.join("; ") || "Argentina";
    workplace = a.remote_modality === "hybrid" ? "hybrid" : "onsite";
  }
  if (!cls) return null;
  const min = a.min_salary > 0 ? a.min_salary : null;
  const max = a.max_salary > 0 ? a.max_salary : null;
  return {
    externalId: job.id,
    company: a.company?.data?.attributes?.name ?? "Unknown",
    title: a.title,
    url: job.links?.public_url ?? `https://www.getonbrd.com/jobs/${job.id}`,
    location, cls, workplace,
    posted_at: iso(a.published_at),
    salary: min || max ? { min, max, currency: "USD", period: "month" } : null,
    text: text(a.description, a.functions, a.desirable, a.benefits),
  };
}

export default {
  id: "getonboard",
  name: "Get on Board",
  home: "https://www.getonbrd.com",
  gapMs: 1000,
  async fetch(get) {
    const seen = new Map();
    for (const category of CATEGORIES) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await get(`${API}/categories/${category}/jobs?per_page=100&page=${page}&expand=${EXPAND}`);
        for (const job of body.data ?? []) seen.set(job.id, job);
        if (page >= (body.meta?.total_pages ?? 1)) break;
      }
    }
    return { total: seen.size, items: [...seen.values()].map(item).filter(Boolean) };
  },
};
