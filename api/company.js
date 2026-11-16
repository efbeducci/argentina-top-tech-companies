// Serves /api/v1/companies/:name.json — single-company salary breakdown.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");

  const name = String(req.query?.name ?? "").toLowerCase().trim();
  if (!name) {
    res.status(400).json({ error: "Missing name parameter" });
    return;
  }

  try {
    const raw = await readFile(join(process.cwd(), "data", "data.json"), "utf-8");
    const data = JSON.parse(raw);
    const company = data.companies.find((c) => c.name.toLowerCase().includes(name));
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    // Attach cell-level breakdowns for this company if available
    const prefix = company.name;
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ company, mep_rate: data.mep_rate, data_date: data.date });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
