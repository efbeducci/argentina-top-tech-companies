// Serves /api/v1/data.json — the full dataset for the web frontend.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");

  try {
    const raw = await readFile(join(process.cwd(), "data", "data.json"), "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(raw);
  } catch (e) {
    res.status(500).json({ error: "Data not available", detail: e.message });
  }
}
