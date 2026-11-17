// data/jobs.json: today's open postings at the companies in data/boards.json,
// kept to the ones a person living in Argentina could take: an office in
// Argentina, remote from Argentina, remote from Latin America, or remote with
// no place named. Postings only: titles, links, locations, stated pay, and
// what api/_jobs.js reads of each (roles and level from the title, years of
// experience and keywords from the description, provinces from the location).
// No descriptions (size), nothing about any person.
//
//     node scripts/jobs.mjs                       # crawl every board
//     node scripts/jobs.mjs --only coderio,redbee # crawl some boards (by board or name)
//     node scripts/jobs.mjs --minutes 10          # stop and publish what it has after 10 min
//
// Ported from pugarte7/spanish-top-tech-companies (MIT), scripts/jobs.mjs:
// every fetch goes through lib/ats's adapters and polite client (per-host
// interval, retries, timeouts); boards are crawled one at a time per host,
// hosts side by side. A host that refuses is retried with growing waits. A
// board that still fails keeps its postings from the previous data/jobs.json
// for up to a week (boards.stale); a board that answers 404 or with no
// postings has none. The daily GitHub Action (.github/workflows/jobs.yml)
// runs it and commits the result.
//
// Beside the companies' own boards it reads job boards that list many
// employers (lib/feeds: Get on Board, We Work Remotely, Jobicy, Himalayas),
// keeping their tech postings (a role read from the title) from the last
// FEED_MAX_DAYS that someone in Argentina could take. A posting a company's
// own board already carries is kept from there; each feed row credits its
// board (`via`) and links to the posting there.

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyJob } from "../api/_jobs.js";
import { FEEDS, client } from "../lib/feeds/index.js";

export const VERSION = 1;
/** lib/ats location classes a person in Argentina can take. */
const AR_CLASSES = new Set(["argentina", "remote-argentina", "remote-latam"]);
/** An office that names no place, only remoteness: "Remote", "Distributed",
 * "Home based - Worldwide". */
const NO_PLACE = /^(?:remote|fully|100%|work|from|at|home|based|distributed|anywhere|worldwide|global|globally|virtual|wfh|flexible|international|[\s\-–—:,/()[\]&.])+$/i;
const REMOTE_WORD = /remote|remoto|home|distributed|anywhere|worldwide|global|virtual|wfh/i;
/** A title that scopes a placeless remote posting somewhere Argentina is not. */
const ELSEWHERE_TITLE = /\b(?:north america|us|usa|united states|canada|emea|europe|eu|uk|apac|asia|india|australia|japan|brazil|brasil|mexico|spain|germany|poland|portugal)\b(?!\s*(?:&|and|\/|or|,)\s*latam)/i;
const LATAM_TITLE = /\b(?:latam|latin america|latinoamerica|south america|sudamerica)\b/i;
const WORKPLACES = new Set(["remote", "hybrid", "onsite"]);
const PERIODS = new Set(["year", "month", "hour"]);

const DEFAULTS = {
  boards: "data/boards.json",
  out: "data/jobs.json",
  // The index whose postings a failing board keeps; the last run's by default.
  previous: "data/jobs.json",
  minutes: Number(process.env.JOBS_MAX_MINUTES) || 60,
  concurrency: 16,
  only: "",
  // Job-board feeds to read: "all", "none", or ids ("getonboard,jobicy").
  // Unset: all of them, or none with --only.
  feeds: "",
};
const FEED_MAX_DAYS = 30;

const THROTTLE_STATUS = new Set([402, 403, 405, 429, 503]);
const BACKOFF_MS = 15_000;
const MAX_TRIES = 4;
const HOST_STRIKES = 5;
const STALE_DAYS = 7;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** One string per office, split as lib/ats's classifier splits them. */
const officesOf = (job) => job.locationsRaw.flatMap((v) => v.split(/\s*[;|]\s*/)).map((v) => v.trim()).filter(Boolean);

/**
 * The posting's location classes when a person living in Argentina could take
 * it, else null. Each office is classed on its own by lib/ats's
 * analyzeLocation. A placeless "Remote" counts only when every office is
 * placeless or Latin-America-wide, and the title does not scope it elsewhere
 * ("Senior Engineer (Remote - US)").
 */
export function openToArgentina(job, analyzeLocation) {
  const hints = { workplaceType: job.workplaceType };
  const offices = officesOf(job).map((office) => {
    const { locationClass } = analyzeLocation([office], hints);
    const placeless = NO_PLACE.test(office) && REMOTE_WORD.test(office);
    return { placeless, raw: locationClass, cls: placeless ? "remote-global" : locationClass };
  });
  // job.locationClass can come from the title or the board's published
  // country, which the offices do not show.
  const fromElsewhere = !offices.some((o) => o.raw === job.locationClass)
    && !["other", "unknown"].includes(job.locationClass);
  const classes = [...new Set([...offices.map((o) => o.cls), ...(fromElsewhere ? [job.locationClass] : [])])];
  if (classes.some((c) => AR_CLASSES.has(c))) return classes;
  if (["remote-us", "remote-canada", "remote-spain", "remote-europe"].includes(job.locationClass)) return null;
  if (ELSEWHERE_TITLE.test(job.title)) return null;
  const open = offices.length > 0 && offices.every((o) => o.placeless);
  return open ? classes : null;
}

/** Pay the board publishes in its own fields; pay read from descriptions is left out. */
function salary(comp) {
  if (!comp || comp.source !== "ats-structured" || !PERIODS.has(comp.period)) return null;
  // Boards write 0 for "not stated".
  const min = Number.isFinite(comp.min) && comp.min > 0 ? Math.round(comp.min) : null;
  const max = Number.isFinite(comp.max) && comp.max > 0 ? Math.round(comp.max) : null;
  if (min === null && max === null) return null;
  return { min, max, currency: comp.currency, period: comp.period };
}

/** One index entry from lib/ats's normalized Job, or null when nobody in Argentina could take it. */
export function entry(job, board, location) {
  const classes = openToArgentina(job, location.analyzeLocation);
  if (!classes) return null;
  const row = {
    id: `${job.ats}:${job.board}:${job.externalId}`,
    company: board.name,
    title: job.title,
    // Greenhouse's absolute_url is often the employer's marketing page; its
    // hosted posting (description and form) is the apply URL.
    url: job.ats === "greenhouse" ? job.applyUrl || job.url : job.url || job.applyUrl,
    ats: job.ats,
    location: [...new Map(officesOf(job).map((v) => [v.toLowerCase(), v])).values()].join("; "),
    location_classes: classes,
    workplace: WORKPLACES.has(job.workplaceType) ? job.workplaceType : null,
    posted_at: job.postedAt ?? null,
    salary: salary(job.compensation),
  };
  return { ...row, ...classifyJob(row, job.descriptionText) };
}

const sortJobs = (jobs) => jobs.sort((a, b) =>
  a.company.localeCompare(b.company, "en", { sensitivity: "base" })
  || a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  || a.id.localeCompare(b.id));

/** A refusal or an outage, which may pass, rather than an answer about the board. */
export function throttled(issue) {
  if (["retryable_http", "network_error"].includes(issue.code)) return true;
  return THROTTLE_STATUS.has(Number(/\bHTTP (\d{3})\b/.exec(issue.message)?.[1]));
}

/** Crawls every board and returns the index. `ats` holds what is taken from lib/ats. */
export async function crawl(boards, ats, opts = {}) {
  const { discoverJobs, adapterFor, CompanySchema, location } = ats;
  const deadline = Date.now() + (opts.minutes ?? DEFAULTS.minutes) * 60_000;
  const issues = {};
  const failures = [];
  const jobs = new Map();
  const done = new Set();
  const perBoard = {};
  let failed = 0;
  const fail = (board, code, message) => {
    done.add(board);
    failed += 1;
    issues[`${board.ats}:${code}`] = (issues[`${board.ats}:${code}`] ?? 0) + 1;
    failures.push({ company: board.name, ats: board.ats, board: board.board, code, message });
  };

  const queues = new Map();
  for (const board of boards) {
    let company;
    let host;
    try {
      company = CompanySchema.parse({ ...board, active: true });
      host = new URL(adapterFor(company.ats).listUrl(company)).host;
    } catch (error) {
      fail(board, "invalid_board", String(error?.message ?? error).slice(0, 200));
      continue;
    }
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push({ board, company, tries: 1 });
  }

  const backoff = opts.backoffMs ?? BACKOFF_MS;
  let retries = 0;
  const runHost = async (host, queue) => {
    let gap = 0;
    let strikes = 0;
    while (queue.length) {
      const item = queue.shift();
      if (Date.now() > deadline) { fail(item.board, "timeout", "crawl time limit reached"); continue; }
      const result = await discoverJobs([item.company]);
      const issue = result.issues[0];
      if (issue && throttled(issue) && strikes + 1 >= HOST_STRIKES) {
        log(`  ${host} refused ${HOST_STRIKES} times in a row; skipping its other ${queue.length} boards`);
        for (const rest of [item, ...queue.splice(0)]) fail(rest.board, issue.code, issue.message);
        break;
      }
      if (issue && throttled(issue) && item.tries < MAX_TRIES && Date.now() < deadline) {
        item.tries += 1;
        retries += 1;
        strikes += 1;
        gap = Math.min(backoff, Math.max(gap * 2, backoff / 5));
        const wait = Math.min(backoff * 2 ** (strikes - 1), backoff * 8, Math.max(0, deadline - Date.now()));
        log(`  ${host} refused ${item.board.name} (${issue.message.slice(0, 80)}); retrying in ${Math.round(wait / 1000)}s`);
        queue.push(item);
        await sleep(wait);
        continue;
      }
      if (!issue || !throttled(issue)) strikes = 0;
      if (issue) {
        for (const each of result.issues) fail(item.board, each.code, each.message);
      } else {
        done.add(item.board);
        let kept = 0;
        for (const job of result.jobs) {
          const row = entry(job, item.board, location);
          if (row) { jobs.set(row.id, row); kept += 1; }
        }
        perBoard[`${item.board.ats}:${item.board.board}`] = { name: item.board.name, total: result.jobs.length, kept };
      }
      if (queue.length && gap) await sleep(gap);
    }
  };
  const pending = [...queues.entries()];
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) await runHost(...next);
  };
  const workers = Array.from({ length: Math.min(opts.concurrency ?? DEFAULTS.concurrency, pending.length) }, worker);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now()) + 60_000); });
  await Promise.race([Promise.all(workers), late]);
  clearTimeout(timer);
  for (const board of boards) if (!done.has(board)) fail(board, "timeout", "crawl time limit reached");

  return {
    index: {
      version: VERSION,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      boards: { queried: done.size, failed, stale: 0, stale_since: {},
                issues: Object.fromEntries(Object.entries(issues).sort()) },
      jobs: sortJobs([...jobs.values()]),
    },
    failures,
    retries,
    perBoard,
  };
}

const dedupeKey = (job) => `${norm(job.company).replace(/[^a-z0-9]/g, "")}|${norm(job.title).replace(/[^a-z0-9]/g, "")}`;

/**
 * One index row from a feed item, or null: a remote posting open anywhere
 * whose title scopes it elsewhere, one older than `since`, or one whose title
 * reads as no tech role.
 */
export function feedEntry(item, feed, since = 0) {
  if (!item?.title || !item.url) return null;
  if (item.cls === "remote-global" && ELSEWHERE_TITLE.test(item.title)) return null;
  const cls = item.cls === "remote-global" && LATAM_TITLE.test(item.title) ? "remote-latam" : item.cls;
  if (item.posted_at && Date.parse(item.posted_at) < since) return null;
  const row = {
    id: `${feed.id}:feed:${item.externalId}`,
    company: item.company || "Unknown",
    title: item.title,
    url: item.url,
    ats: feed.id,
    via: feed.name,
    location: item.location,
    location_classes: [cls],
    workplace: item.workplace ?? "remote",
    posted_at: item.posted_at ?? null,
    salary: item.salary ?? null,
  };
  const classified = classifyJob(row, item.text);
  return classified.roles.length ? { ...row, ...classified } : null;
}

/**
 * Reads each feed (side by side, each at its own pace) and returns its rows,
 * leaving out postings already in `existing` (rows, or a promise of them, so
 * feeds can run while the boards are crawled) and ones an earlier feed in
 * FEEDS order carries.
 */
export async function crawlFeeds(feeds, existing = [], opts = {}) {
  const since = (opts.now ?? Date.now()) - FEED_MAX_DAYS * 86_400_000;
  const results = await Promise.all(feeds.map(async (feed) => {
    try {
      const { total, items } = await feed.fetch(opts.get?.(feed) ?? client({ gapMs: feed.gapMs }), { since });
      return { feed, total, rows: items.map((i) => feedEntry(i, feed, since)).filter(Boolean) };
    } catch (error) {
      return { feed, error };
    }
  }));
  const taken = new Set((await existing).map(dedupeKey));
  const rows = [];
  const failures = [];
  const perFeed = {};
  for (const { feed, total, rows: got, error } of results) {
    if (error) {
      failures.push({ company: feed.name, ats: feed.id, board: "feed", code: error.code ?? "feed_error",
                      message: String(error.message ?? error).slice(0, 300) });
      continue;
    }
    let kept = 0;
    for (const row of got) {
      const key = dedupeKey(row);
      if (taken.has(key)) continue;
      taken.add(key);
      rows.push(row);
      kept += 1;
    }
    perFeed[`${feed.id}:feed`] = { name: feed.name, total, kept };
  }
  return { rows, failures, perFeed };
}

const boardKey = (failure) => `${failure.ats}:${failure.board}`;

/** Keeps, unchanged, the previous index's postings of each board that failed this run (up to `maxDays`). */
export function carryOver(index, failures, previous, now = Date.now(), maxDays = STALE_DAYS) {
  if (!isIndex(previous)) return index;
  const since = {};
  for (const failure of failures) {
    if (failure.code === "not_found") continue;
    const key = boardKey(failure);
    const read = previous.boards?.stale_since?.[key] ?? previous.generated_at;
    if (now - Date.parse(read) <= maxDays * 86_400_000) since[key] = read;
  }
  const kept = previous.jobs.filter((job) => since[job.id.split(":").slice(0, 2).join(":")]);
  const carried = Object.keys(since).filter((key) => kept.some((job) => job.id.startsWith(`${key}:`)));
  const ids = new Set(index.jobs.map((job) => job.id));
  return {
    ...index,
    boards: { ...index.boards, stale: carried.length,
              stale_since: Object.fromEntries(carried.sort().map((key) => [key, since[key]])) },
    jobs: sortJobs([...index.jobs, ...kept.filter((job) => !ids.has(job.id))]),
  };
}

export async function loadAts() {
  const [registry, location, campaign] = await Promise.all([
    import("../lib/ats/sources/registry.js"),
    import("../lib/ats/ranking/location.js"),
    import("../lib/ats/domain/campaign.js"),
  ]);
  return { discoverJobs: registry.discoverJobs, adapterFor: registry.adapterFor,
           CompanySchema: campaign.CompanySchema, location };
}

export function isIndex(value) {
  return value?.version === VERSION && typeof value.generated_at === "string"
    && Array.isArray(value.jobs) && typeof value.boards === "object";
}

/** Postings, companies, boards, remote ones, postings per source and per role. */
export function summary(index) {
  const companies = new Set();
  const roles = {};
  const sources = {};
  let remote = 0;
  for (const job of index.jobs) {
    companies.add(job.company);
    const source = job.via ?? "company boards";
    sources[source] = (sources[source] ?? 0) + 1;
    if (job.workplace === "remote" || (job.location_classes ?? []).some((c) => /remote/i.test(String(c)))) remote += 1;
    for (const role of new Set(job.roles ?? [])) roles[role] = (roles[role] ?? 0) + 1;
  }
  return { version: VERSION, generated_at: index.generated_at, postings: index.jobs.length,
           companies: companies.size, boards: index.boards.queried, remote,
           sources: Object.fromEntries(Object.entries(sources).sort((a, b) => b[1] - a[1])),
           roles: Object.fromEntries(Object.entries(roles).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) };
}

function put(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
}

export const summaryPath = (path) => path.replace(/(\.json)?$/, "-summary.json");

function write(path, index) {
  const body = JSON.stringify(index, null, 1);
  put(path, body);
  put(summaryPath(path), JSON.stringify(summary(index), null, 2));
  return Buffer.byteLength(body);
}

function readPrevious(path) {
  try {
    if (!existsSync(path)) return null;
    const body = JSON.parse(readFileSync(path, "utf8"));
    return isIndex(body) ? body : null;
  } catch {
    return null;
  }
}

function args(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in out)) throw new Error(`unknown option ${argv[i]}`);
    out[key] = ["minutes", "concurrency"].includes(key) ? Number(argv[++i]) : argv[++i];
  }
  return out;
}

const log = (message) => process.stderr.write(`jobs: ${message}\n`);

async function main() {
  const opts = args(process.argv.slice(2));
  const started = Date.now();
  let boards = JSON.parse(readFileSync(opts.boards, "utf8")).boards;
  if (opts.only) {
    const wanted = new Set(opts.only.split(",").map(norm));
    boards = boards.filter((b) => wanted.has(norm(b.board)) || wanted.has(norm(b.name)));
  }
  process.env.ATS_USER_AGENT ??= `argentina-top-tech-companies-jobs/${VERSION} (+https://github.com/efbeducci/argentina-top-tech-companies; daily job index)`;
  process.env.ATS_LOG_LEVEL ??= "error";
  const feedsOpt = opts.feeds || (opts.only ? "none" : "all");
  const wantedFeeds = feedsOpt === "none" ? []
    : feedsOpt === "all" ? FEEDS : FEEDS.filter((f) => feedsOpt.split(",").map(norm).includes(f.id));
  const crawling = crawl(boards, await loadAts(), opts);
  // Feeds are other hosts: read them while the boards are crawled.
  const feeding = wantedFeeds.length ? crawlFeeds(wantedFeeds, crawling.then((r) => r.index.jobs)) : null;
  const result = await crawling;
  const { boards: stats } = result.index;
  log(`${stats.queried} boards queried, ${stats.failed} failed, ${result.retries} retries, ` +
      `${result.index.jobs.length} postings kept, ${Math.round((Date.now() - started) / 1000)}s`);
  for (const [key, b] of Object.entries(result.perBoard).sort((a, b) => b[1].kept - a[1].kept))
    log(`  ${String(b.kept).padStart(4)} / ${String(b.total).padEnd(5)} ${b.name} (${key})`);
  for (const f of result.failures) log(`  - ${f.company} (${f.ats}:${f.board}) ${f.code}: ${f.message.slice(0, 160)}`);

  if (wantedFeeds.length) {
    const fed = await feeding;
    result.index.jobs = sortJobs([...result.index.jobs, ...fed.rows]);
    result.index.boards.queried += wantedFeeds.length - fed.failures.length;
    result.index.boards.failed += fed.failures.length;
    result.failures.push(...fed.failures);
    for (const [key, f] of Object.entries(fed.perFeed))
      log(`  ${String(f.kept).padStart(4)} / ${String(f.total).padEnd(5)} ${f.name} (${key})`);
    for (const f of fed.failures) log(`  - ${f.company} (${f.ats}:${f.board}) ${f.code}: ${f.message.slice(0, 160)}`);
  }

  let index = result.index;
  const prior = readPrevious(opts.previous);
  if (prior && !opts.only && result.failures.some((f) => f.code !== "not_found")) {
    index = carryOver(index, result.failures, prior);
    log(`carried over ${index.jobs.length - result.index.jobs.length} postings of ${index.boards.stale} failed boards`);
  }
  if (stats.queried > 0 && stats.failed === stats.queried && !index.boards.stale) {
    log("no board could be read and none carried over; index left as it was");
    return;
  }
  log(`wrote ${opts.out} (${write(opts.out, index)} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => {
    log(`error: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
