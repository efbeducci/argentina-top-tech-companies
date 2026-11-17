// Shared pieces of the job-board feeds (Get on Board, Himalayas, We Work
// Remotely, Jobicy): a polite GET and the remote scope a list of countries or
// regions gives a person living in Argentina.

import { htmlToText } from "../ats/text/html.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * A client that waits `gapMs` between its requests and retries refusals and
 * outages with growing waits. One per feed: each feed is one host.
 */
export function client({ gapMs = 1000, tries = 4, timeoutMs = 30_000 } = {}) {
  let last = 0;
  return async function get(url, as = "json") {
    for (let attempt = 1; ; attempt += 1) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": process.env.ATS_USER_AGENT ?? "argentina-top-tech-companies-jobs",
                     Accept: as === "json" ? "application/json" : "application/rss+xml, application/xml, text/xml" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt < tries) { await sleep(gapMs * 4 ** attempt); continue; }
        throw Object.assign(new Error(`network error: ${error?.message ?? error}`), { code: "network_error" });
      }
      if (RETRY_STATUS.has(res.status) && attempt < tries) { await sleep(gapMs * 4 ** attempt); continue; }
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} for ${url}`),
          { code: res.status === 404 ? "not_found" : RETRY_STATUS.has(res.status) ? "retryable_http" : "http_error" });
      }
      return as === "json" ? res.json() : res.text();
    }
  };
}

export const text = (...html) => html.filter(Boolean).map((h) => htmlToText(String(h))).join("\n");

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const LATAM_COUNTRIES = new Set([
  "argentina", "bolivia", "brazil", "brasil", "chile", "colombia", "costa rica", "cuba", "dominican republic",
  "ecuador", "el salvador", "guatemala", "honduras", "mexico", "nicaragua", "panama", "paraguay", "peru",
  "puerto rico", "uruguay", "venezuela", "belize", "guyana", "suriname", "haiti", "jamaica",
  "trinidad and tobago", "bahamas", "barbados", "anguilla", "antigua and barbuda", "aruba", "bermuda",
  "cayman islands", "curacao", "dominica", "grenada", "montserrat", "saint kitts and nevis", "saint lucia",
  "saint vincent and the grenadines", "turks and caicos islands", "british virgin islands", "us virgin islands",
  "french guiana", "guadeloupe", "martinique", "sint maarten", "saint martin", "saint barthelemy",
  "falkland islands", "bonaire, sint eustatius and saba",
]);
const LATAM_REGION = /\b(latam|latin america|south america|central america|americas|caribbean|lac)\b/;
// Open to the Americas only (Latin America plus the US or Canada) reads as
// remote from Latin America.
const NORTH_AMERICA = new Set(["united states", "united states of america", "usa", "us", "canada", "north america",
  "greenland", "saint pierre and miquelon"]);
const GLOBAL = /\b(anywhere|worldwide|world|global|remote)\b/;

/** Clean country names: "🇦🇷 Argentina", "Bolivia (Plurinational State of)". */
export function places(list) {
  return list.map((p) => norm(p).replace(/[^\x00-\x7f]/g, "").replace(/\(.*?\)/g, "").replace(/^(and|y)\s+/, "").trim())
    .filter(Boolean);
}

/**
 * The location class of a remote posting open to these countries or regions,
 * when Argentina is among them; else null. Nothing listed, or anywhere, is
 * remote-global; Argentina alone is remote-argentina; Argentina or Latin
 * America with only places in the Americas beside it is remote-latam.
 */
export function remoteScope(list) {
  const names = places(list ?? []);
  if (!names.length || names.some((n) => GLOBAL.test(n))) return "remote-global";
  const latam = (n) => LATAM_COUNTRIES.has(n) || LATAM_REGION.test(n) || NORTH_AMERICA.has(n);
  if (!names.includes("argentina") && !names.some((n) => LATAM_REGION.test(n))) return null;
  if (names.length === 1 && names[0] === "argentina") return "remote-argentina";
  return names.every(latam) ? "remote-latam" : "remote-global";
}

export const iso = (value) => {
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
};
