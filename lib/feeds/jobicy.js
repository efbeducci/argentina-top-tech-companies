// Jobicy (jobicy.com): remote jobs. Public API, https://jobicy.com/jobs-rss-feed
// (credit Jobicy and link to the posting). Asked for the postings open to
// Argentina and to Latin America; each names where it takes people (jobGeo).

import { iso, remoteScope, text } from "./common.js";

const API = "https://jobicy.com/api/v2/remote-jobs?count=50";
const GEOS = ["argentina", "latam"];
const MAX_PAGES = 10;
const PERIOD = { yearly: "year", annual: "year", monthly: "month", hourly: "hour" };

export function item(job) {
  const geo = String(job.jobGeo ?? "").split(/\s*,\s*/).filter(Boolean);
  const cls = remoteScope(geo);
  if (!cls) return null;
  const min = job.salaryMin > 0 ? job.salaryMin : null;
  const max = job.salaryMax > 0 ? job.salaryMax : null;
  const period = PERIOD[String(job.salaryPeriod).toLowerCase()];
  return {
    externalId: String(job.id),
    company: job.companyName,
    title: job.jobTitle,
    url: job.url,
    location: `Remote (${geo.join(", ") || "anywhere"})`,
    cls, workplace: "remote",
    posted_at: iso(job.pubDate),
    salary: (min || max) && job.salaryCurrency && period ? { min, max, currency: job.salaryCurrency, period } : null,
    text: text(job.jobDescription || job.jobExcerpt),
  };
}

export default {
  id: "jobicy",
  name: "Jobicy",
  home: "https://jobicy.com",
  gapMs: 2000,
  async fetch(get) {
    const seen = new Map();
    for (const geo of GEOS) {
      let cursor = "";
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await get(`${API}&geo=${geo}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        for (const job of body.jobs ?? []) seen.set(job.id, job);
        if (!body.hasMore || !body.nextCursor) break;
        cursor = body.nextCursor;
      }
    }
    return { total: seen.size, items: [...seen.values()].map(item).filter(Boolean) };
  },
};
