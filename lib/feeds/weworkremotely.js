// We Work Remotely (weworkremotely.com): remote jobs. Public RSS feeds, one
// per category. Each item names a region ("Anywhere in the World", "Latin
// America Only", "USA Only") and the countries it takes.

import { XMLParser } from "fast-xml-parser";
import { iso, remoteScope, text } from "./common.js";

const FEEDS = ["remote-programming-jobs", "remote-full-stack-programming-jobs", "remote-back-end-programming-jobs",
  "remote-front-end-programming-jobs", "remote-devops-sysadmin-jobs", "remote-design-jobs", "remote-product-jobs"]
  .map((c) => `https://weworkremotely.com/categories/${c}.rss`);
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

const ANYWHERE = /anywhere|worldwide/i;
const LATAM = /latin america|latam|americas|south america/i;

export function item(raw) {
  const region = String(raw.region ?? "");
  const countries = String(raw.country ?? "").split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
  let cls;
  if (ANYWHERE.test(region)) cls = "remote-global";
  else if (LATAM.test(region)) cls = "remote-latam";
  else cls = countries.length ? remoteScope(countries) : null;
  // A region such as "USA Only" listing Argentina among its countries is
  // still scoped to that region.
  if (cls && !ANYWHERE.test(region) && !LATAM.test(region) && /only/i.test(region)) cls = null;
  if (!cls) return null;
  const [company, ...rest] = String(raw.title ?? "").split(": ");
  const link = String(raw.link ?? raw.guid ?? "");
  return {
    externalId: link.replace(/^https:\/\/weworkremotely\.com\/remote-jobs\//, ""),
    company: rest.length ? company : "Unknown",
    title: rest.length ? rest.join(": ") : company,
    url: link,
    location: `Remote (${region || "anywhere"})`,
    cls, workplace: "remote",
    posted_at: iso(raw.pubDate),
    salary: null,
    text: text(raw.description),
  };
}

export default {
  id: "weworkremotely",
  name: "We Work Remotely",
  home: "https://weworkremotely.com",
  gapMs: 1500,
  async fetch(get) {
    const seen = new Map();
    for (const url of FEEDS) {
      const xml = parser.parse(await get(url, "text"));
      const items = [xml?.rss?.channel?.item ?? []].flat();
      for (const raw of items) seen.set(String(raw.guid ?? raw.link), raw);
    }
    return { total: seen.size, items: [...seen.values()].map(item).filter(Boolean) };
  },
};
