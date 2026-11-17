import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteScope } from "../lib/feeds/common.js";
import { item as gob } from "../lib/feeds/getonboard.js";
import { item as wwr } from "../lib/feeds/weworkremotely.js";
import { item as himalayas } from "../lib/feeds/himalayas.js";
import { item as jobicy } from "../lib/feeds/jobicy.js";
import { feedEntry, crawlFeeds } from "../scripts/jobs.mjs";

test("remote scope from the countries a posting takes", () => {
  assert.equal(remoteScope([]), "remote-global");
  assert.equal(remoteScope(["Anywhere"]), "remote-global");
  assert.equal(remoteScope(["Argentina"]), "remote-argentina");
  assert.equal(remoteScope(["Argentina", "Chile", "Mexico"]), "remote-latam");
  assert.equal(remoteScope(["LATAM"]), "remote-latam");
  assert.equal(remoteScope(["Argentina", "United States", "Canada", "Brazil"]), "remote-latam");
  assert.equal(remoteScope(["LATAM", "Europe", "APAC"]), "remote-global");
  assert.equal(remoteScope(["Argentina", "Spain", "Germany"]), "remote-global");
  assert.equal(remoteScope(["Chile"]), null);
  assert.equal(remoteScope(["USA", "Canada"]), null);
  assert.equal(remoteScope(["🇦🇷 Argentina", "🇧🇴 Bolivia (Plurinational State of)"]), "remote-latam");
});

const gobJob = (attrs) => ({ id: "x-1", links: { public_url: "https://www.getonbrd.com/jobs/x-1" },
  attributes: { title: "Senior Ruby on Rails Developer", published_at: 1794900000, min_salary: 3000, max_salary: 4000,
    company: { data: { attributes: { name: "Acme" } } }, location_tenants: { data: [] }, location_regions: { data: [] },
    location_cities: { data: [] }, countries: [], description: "<p>5 years of Rails</p>", ...attrs } });

test("Get on Board: modality and countries", () => {
  assert.equal(gob(gobJob({ remote_modality: "fully_remote" })).cls, "remote-global");
  const ar = gob(gobJob({ remote_modality: "remote_local",
    location_tenants: { data: [{ attributes: { name: "Argentina" } }, { attributes: { name: "Chile" } }] } }));
  assert.equal(ar.cls, "remote-latam");
  assert.deepEqual(ar.salary, { min: 3000, max: 4000, currency: "USD", period: "month" });
  assert.equal(gob(gobJob({ remote_modality: "remote_local", location_tenants: { data: [{ attributes: { name: "Chile" } }] } })), null);
  assert.equal(gob(gobJob({ remote_modality: "hybrid", countries: ["Chile"] })), null);
  const ba = gob(gobJob({ remote_modality: "hybrid", countries: ["Argentina"],
    location_cities: { data: [{ attributes: { name: "Buenos Aires", country: "Argentina" } }] } }));
  assert.equal(ba.cls, "argentina");
  assert.equal(ba.workplace, "hybrid");
  assert.equal(ba.location, "Buenos Aires, Argentina");
});

test("We Work Remotely: region first", () => {
  const base = { title: "Acme: Senior Rails Engineer", link: "https://weworkremotely.com/remote-jobs/acme-rails",
    pubDate: "Mon, 16 Nov 2026 10:00:00 +0000", country: "🇦🇷 Argentina, 🇺🇸 United States of America" };
  const any = wwr({ ...base, region: "Anywhere in the World" });
  assert.equal(any.cls, "remote-global");
  assert.equal(any.company, "Acme");
  assert.equal(any.title, "Senior Rails Engineer");
  assert.equal(wwr({ ...base, region: "Latin America Only" }).cls, "remote-latam");
  assert.equal(wwr({ ...base, region: "USA Only" }), null);
});

test("Himalayas and Jobicy", () => {
  const h = himalayas({ guid: "https://himalayas.app/companies/acme/jobs/rails", applicationLink: "https://himalayas.app/companies/acme/jobs/rails?utm_source=api",
    title: "Rails Developer", companyName: "Acme", locationRestrictions: ["Argentina"], pubDate: 1794900000,
    minSalary: 60000, maxSalary: 80000, currency: "USD", salaryPeriod: "annual" });
  assert.equal(h.cls, "remote-argentina");
  assert.deepEqual(h.salary, { min: 60000, max: 80000, currency: "USD", period: "year" });
  assert.equal(himalayas({ guid: "g", title: "x", locationRestrictions: ["India"] }), null);
  const j = jobicy({ id: 1, url: "https://jobicy.com/jobs/1-x", jobTitle: "Backend Engineer", companyName: "Acme",
    jobGeo: "LATAM,  Canada,  USA", pubDate: "2026-11-16T00:00:00+00:00" });
  assert.equal(j.cls, "remote-latam");
});

const feed = { id: "fake", name: "Fake Board" };
const one = (over) => ({ externalId: "1", company: "Acme", title: "Senior Rails Engineer", url: "https://x/1",
  location: "Remote", cls: "remote-global", workplace: "remote", posted_at: "2026-11-16T00:00:00Z", salary: null,
  text: "We need 5+ years of Ruby on Rails", ...over });

test("feed rows: tech only, recent, scoped by title, credited", () => {
  const since = Date.parse("2026-10-17T00:00:00Z");
  const row = feedEntry(one(), feed, since);
  assert.equal(row.id, "fake:feed:1");
  assert.equal(row.via, "Fake Board");
  assert.ok(row.roles.includes("software-engineer"));
  assert.ok(row.keywords.includes("rails"));
  assert.equal(feedEntry(one({ title: "Account Executive" }), feed, since), null);
  assert.equal(feedEntry(one({ posted_at: "2026-09-01T00:00:00Z" }), feed, since), null);
  assert.equal(feedEntry(one({ title: "Senior Rails Engineer (US only)" }), feed, since), null);
  assert.deepEqual(feedEntry(one({ title: "Rails Engineer - LATAM" }), feed, since).location_classes, ["remote-latam"]);
});

test("crawlFeeds drops postings a company board or an earlier feed carries", async () => {
  const a = { id: "a", name: "A", fetch: async () => ({ total: 2, items: [one({ externalId: "1" }), one({ externalId: "2", title: "Data Engineer" })] }) };
  const b = { id: "b", name: "B", fetch: async () => ({ total: 1, items: [one({ externalId: "9", company: "ACME" })] }) };
  const broken = { id: "c", name: "C", fetch: async () => { throw Object.assign(new Error("HTTP 503"), { code: "retryable_http" }); } };
  const existing = Promise.resolve([{ company: "Acme", title: "Data Engineer" }]);
  const out = await crawlFeeds([a, b, broken], existing, { now: Date.parse("2026-11-17T00:00:00Z"), get: () => null });
  assert.deepEqual(out.rows.map((r) => r.id), ["a:feed:1"]);
  assert.deepEqual(out.perFeed["b:feed"], { name: "B", total: 1, kept: 0 });
  assert.deepEqual(out.failures.map((f) => [f.ats, f.board, f.code]), [["c", "feed", "retryable_http"]]);
});
