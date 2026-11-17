// Serves /api/v1/jobs.json — today's open postings a person in Argentina can take
// (written daily by scripts/jobs.mjs), and /api/v1/jobs-summary.json.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=900");
  const file = req.query?.summary ? "jobs-summary.json" : "jobs.json";
  try {
    const raw = await readFile(join(process.cwd(), "data", file), "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(raw);
  } catch (e) {
    res.status(404).json({ error: "No job index yet", detail: e.message });
  }
}
