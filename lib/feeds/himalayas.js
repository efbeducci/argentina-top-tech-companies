// Himalayas (himalayas.app): remote jobs. Public API,
// https://himalayas.app/api. Search by country returns the postings open to
// Argentina, each with the countries it takes (none: anywhere). Twenty a
// page, newest first (roughly), so it pages back until a few pages in a row
// are older than the cutoff.

import { iso, remoteScope, text } from "./common.js";

const API = "https://himalayas.app/jobs/api/search?country=Argentina&sort=recent";
const MAX_PAGES = 200;
const OLD_PAGES_TO_STOP = 3;
const PERIOD = { annual: "year", yearly: "year", monthly: "month", month: "month", hourly: "hour", hour: "hour" };

export function item(job) {
  const cls = remoteScope(job.locationRestrictions);
  if (!cls) return null;
  const min = job.minSalary > 0 ? job.minSalary : null;
  const max = job.maxSalary > 0 ? job.maxSalary : null;
  const period = PERIOD[String(job.salaryPeriod).toLowerCase()];
  const restricted = job.locationRestrictions?.length ?? 0;
  return {
    externalId: String(job.guid).replace(/^https:\/\/himalayas\.app\/companies\//, ""),
    company: job.companyName,
    title: job.title,
    url: job.applicationLink || job.guid,
    location: !restricted ? "Remote (anywhere)"
      : restricted > 8 ? `Remote (${restricted} countries incl. Argentina)`
      : `Remote (${job.locationRestrictions.join(", ")})`,
    cls, workplace: "remote",
    posted_at: iso(job.pubDate),
    salary: (min || max) && job.currency && period ? { min, max, currency: job.currency, period } : null,
    text: text(job.description || job.excerpt),
  };
}

export default {
  id: "himalayas",
  name: "Himalayas",
  home: "https://himalayas.app",
  gapMs: 1500,
  async fetch(get, { since }) {
    const seen = new Map();
    let old = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await get(`${API}&page=${page}`);
      const jobs = body.jobs ?? [];
      if (!jobs.length) break;
      for (const job of jobs) seen.set(job.guid, job);
      old = jobs.every((j) => j.pubDate * 1000 < since) ? old + 1 : 0;
      if (old >= OLD_PAGES_TO_STOP) break;
    }
    return { total: seen.size, items: [...seen.values()].map(item).filter(Boolean) };
  },
};
