import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLocation } from "../lib/ats/ranking/location.js";
import { openToArgentina, carryOver } from "../scripts/jobs.mjs";
import { classifyJob, jobTitleRoles, jobProvinces, seniorityOf } from "../api/_jobs.js";
import mcp from "../api/mcp.js";

const cls = (s) => analyzeLocation([s]).locationClass;
const job = (title, locationsRaw, workplaceType = "unknown", locationClass) => ({
  title, locationsRaw, workplaceType,
  locationClass: locationClass ?? analyzeLocation(locationsRaw, { workplaceType }).locationClass,
});

test("Argentine offices, not Arkansas or Spain", () => {
  assert.equal(cls("Buenos Aires, AR"), "argentina");
  assert.equal(cls("Buenos Aires, Argentina"), "argentina");
  assert.equal(cls("Córdoba, Argentina"), "argentina");
  assert.equal(cls("Córdoba, Spain"), "spain");
  assert.equal(cls("Santa Fe, NM"), "us-other");
  assert.equal(cls("Hybrid - Buenos Aires"), "argentina");
});

test("remote scopes", () => {
  assert.equal(cls("Remote - Argentina"), "remote-argentina");
  assert.equal(cls("Remote, LATAM"), "remote-latam");
  assert.equal(cls("Remote (Americas)"), "remote-latam");
  assert.equal(cls("Remote - US"), "remote-us");
  assert.equal(cls("Remote"), "remote-global");
  assert.equal(cls("São Paulo, Brazil"), "latam");
});

test("which postings someone in Argentina can take", () => {
  const open = (j) => openToArgentina(j, analyzeLocation);
  assert.deepEqual(open(job("Backend Engineer", ["Buenos Aires, Argentina"])), ["argentina"]);
  assert.ok(open(job("Backend Engineer", ["Remote - LATAM"], "remote")));
  assert.ok(open(job("Backend Engineer", ["São Paulo, Brazil; Buenos Aires, Argentina"])));
  assert.ok(open(job("Backend Engineer", ["Remote"], "remote")));
  assert.equal(open(job("Backend Engineer (Remote - US)", ["Remote"], "remote")), null);
  assert.equal(open(job("Backend Engineer", ["São Paulo, Brazil"])), null);
  assert.equal(open(job("Backend Engineer", ["Remote - US"], "remote")), null);
  assert.equal(open(job("Backend Engineer", ["Madrid, Spain"])), null);
});

test("roles in the survey's slugs, Spanish titles included", () => {
  assert.deepEqual(jobTitleRoles("Senior Software Engineer"), ["software-engineer"]);
  assert.deepEqual(jobTitleRoles("Engineering Manager, Payments"), ["software-engineering-manager"]);
  assert.deepEqual(jobTitleRoles("Lead Frontend Developer"), ["tech-lead"]);
  assert.deepEqual(jobTitleRoles("Desarollador Java Senior"), ["software-engineer"]);
  assert.deepEqual(jobTitleRoles("Analista SOC (SIEM)"), ["security-engineer"]);
  assert.deepEqual(jobTitleRoles("Mechanical Engineer"), []);
});

test("levels and provinces", () => {
  assert.equal(seniorityOf("Desarrollador Full Stack Ssr"), "mid");
  assert.equal(seniorityOf("Semi Senior Java Developer"), "mid");
  assert.equal(seniorityOf("Sr Backend Engineer"), "senior");
  assert.deepEqual(jobProvinces("Buenos Aires, Argentina"), ["CABA"]);
  assert.deepEqual(jobProvinces("Vicente López, Buenos Aires"), ["BA"]);
  assert.deepEqual(jobProvinces("Córdoba, Argentina"), ["CBA"]);
});

test("classifyJob reads years and skills from the description", () => {
  const c = classifyJob({ title: "Senior Backend Engineer", location: "Buenos Aires" },
    "5+ years of experience with Ruby on Rails, PostgreSQL and AWS.");
  assert.deepEqual(c.years, [5, null]);
  assert.ok(c.keywords.includes("rails") && c.keywords.includes("postgresql"));
});

test("a failing board keeps its previous postings for a week", () => {
  const prev = { version: 1, generated_at: "2026-11-10T00:00:00Z", boards: {},
    jobs: [{ id: "lever:x:1", company: "X", title: "A" }, { id: "lever:y:1", company: "Y", title: "B" }] };
  const now = { version: 1, generated_at: "2026-11-11T00:00:00Z", boards: {}, jobs: [] };
  const out = carryOver(now, [{ ats: "lever", board: "x", code: "network_error" }], prev, Date.parse("2026-11-11T00:00:00Z"));
  assert.deepEqual(out.jobs.map((j) => j.id), ["lever:x:1"]);
  const late = carryOver(now, [{ ats: "lever", board: "x", code: "network_error" }], prev, Date.parse("2026-11-30T00:00:00Z"));
  assert.equal(late.jobs.length, 0);
});

async function call(body) {
  let out;
  const res = { setHeader() {}, status() { return res; }, json(v) { out = v; return res; }, end() { return res; } };
  await mcp({ method: "POST", headers: {}, body }, res);
  return out;
}

test("MCP lists find_jobs and answers it", async () => {
  const list = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.ok(list.result.tools.some((t) => t.name === "find_jobs"));
  const found = await call({ jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "find_jobs", arguments: { query: "java", limit: 3 } } });
  const payload = JSON.parse(found.result.content[0].text);
  assert.ok("jobs" in payload);
});

test("find_jobs filters by publication date", async () => {
  const r = await call({ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "find_jobs", arguments: { posted_within_days: 7, limit: 50 } } });
  const payload = JSON.parse(r.result.content[0].text);
  const since = Date.now() - 7 * 86_400_000;
  for (const j of payload.jobs ?? []) assert.ok(Date.parse(j.posted_at) >= since, j.posted_at);
  const tools = (await call({ jsonrpc: "2.0", id: 4, method: "tools/list" })).result.tools;
  assert.ok(tools.find((t) => t.name === "find_jobs").inputSchema.properties.posted_within_days);
});

test("initialize negotiates the client's protocol version", async () => {
  const init = (v) => call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } });
  assert.equal((await init("2025-06-18")).result.protocolVersion, "2025-06-18");
  assert.equal((await init("2024-11-05")).result.protocolVersion, "2024-11-05");
  assert.equal((await init("1999-01-01")).result.protocolVersion, "2026-07-28");
});
