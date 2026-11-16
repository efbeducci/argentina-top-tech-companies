#!/usr/bin/env python3
"""
Ingest sysarmy salary survey CSV → data/data.json

Usage:
  python3 scripts/ingest_sysarmy.py path/to/sysarmy.csv --survey-month 2026-01 [--edition 2026.1]
  python3 scripts/ingest_sysarmy.py path/to/sysarmy.csv --mep-rate 1476 [--out data/data.json] [--min-group 5]

  --survey-month fetches the historical MEP (dólar bolsa) for that month from
  api.argentinadatos.com and uses the monthly median. --mep-rate overrides it.

The sysarmy survey is published biannually at https://sysarmy.com/encuesta
Raw CSVs are in https://github.com/openqube/openqube-sueldos

Currency notes:
  - Since ~2023 the salary column is always in ARS ("..._en_pesos_argentinos"),
    even for people paid in USD. In that case every row is ARS → USD via MEP.
  - Older editions: rows with "Pagos en dólares" == Si/Yes are treated as USD-paid directly.
    The annual USD is computed from monthly * 12.
  - All other rows are peso-paid. Annual ARS = monthly * 12.
    Annual USD = annual ARS / mep_rate.
  - mep_rate is the MEP (dólar bolsa) rate at time of survey, passed as --mep-rate.
"""

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

# --- Column name normalization ------------------------------------------------
# Sysarmy changes column names between editions; we try several candidates.

COLS = {
    "job_title":   ["Trabajo de", "trabajo_de", "Puesto"],
    "location":    ["Dónde estoy trabajando", "donde_estoy_trabajando", "donde_estas_trabajando", "Provincia", "Localidad"],
    "years":       ["Años de experiencia", "anios_de_experiencia", "anos_de_experiencia", "Experiencia"],
    "salary":      ["ultimo_salario_mensual_o_retiro_bruto_en_pesos_argentinos",
                    "Salario mensual BRUTO (en tu moneda local)", "salario_mensual_bruto", "Sueldo bruto"],
    "paid_usd":    ["Pagos en dólares", "pagos_en_dolares", "Cobro en dolares"],
    "company":     ["Nombre de la empresa donde trabajo", "empresa", "Empleador"],
    "usd_type":    ["Tipo de dólar elegido", "tipo_de_dolar_elegido", "Dólar elegido para conversión"],
}


def build_col_map(header):
    """Return {logical_key: actual_csv_header} for every column we can find."""
    col_map = {}
    for key, candidates in COLS.items():
        for c in candidates:
            if c in header:
                col_map[key] = c
                break
    return col_map


def get(row, col_map, key):
    col = col_map.get(key)
    if col is None:
        return ""
    return str(row.get(col, "") or "").strip()


# --- Province mapping ---------------------------------------------------------
import unicodedata

def normalize(text):
    return (unicodedata.normalize("NFKD", str(text or ""))
            .encode("ascii", "ignore").decode()
            .lower()
            .replace("-", " ")
            .split())


def words(text):
    return " ".join(normalize(text))


PROVINCE_NAMES = {
    "CABA": "ciudad autonoma de buenos aires, caba, capital federal, ciudad de buenos aires",
    "BA":   "buenos aires, provincia de buenos aires, gba, gran buenos aires, conurbano bonaerense",
    "CBA":  "cordoba",
    "SF":   "santa fe",
    "MZA":  "mendoza",
    "TUC":  "tucuman",
    "NQN":  "neuquen",
    "RN":   "rio negro",
    "ER":   "entre rios",
    "SL":   "san luis",
    "SAL":  "salta",
    "JUJ":  "jujuy",
    "MIS":  "misiones",
    "CTE":  "corrientes",
    "CHU":  "chubut",
    "TDF":  "tierra del fuego",
    "SGO":  "santiago del estero",
    "CAT":  "catamarca",
    "LR":   "la rioja",
    "SJ":   "san juan",
    "LP":   "la pampa",
    "CHA":  "chaco",
    "FOR":  "formosa",
    "SCZ":  "santa cruz",
}

PROVINCE_CITIES = {
    "CABA": ["caba", "capital federal"],
    "BA":   ["la plata", "mar del plata", "bahia blanca", "quilmes", "lomas de zamora", "lanus", "avellaneda", "tigre", "moron", "merlo", "san isidro", "vicente lopez", "campana", "zarate"],
    "CBA":  ["cordoba", "villa carlos paz", "rio cuarto", "san francisco", "villa maria"],
    "SF":   ["rosario", "santa fe", "rafaela", "venado tuerto"],
    "MZA":  ["mendoza", "san rafael", "godoy cruz", "lujan de cuyo"],
    "TUC":  ["tucuman", "san miguel de tucuman", "yerba buena", "tafi viejo"],
    "NQN":  ["neuquen", "cipolletti"],
    "RN":   ["bariloche", "viedma"],
    "ER":   ["parana", "concordia", "gualeguaychu"],
    "SL":   ["san luis", "villa mercedes"],
    "SAL":  ["salta", "tartagal"],
    "JUJ":  ["jujuy", "san salvador de jujuy", "palpala"],
    "MIS":  ["posadas", "obera"],
    "CTE":  ["corrientes", "goya"],
    "CHU":  ["comodoro rivadavia", "trelew", "puerto madryn"],
    "TDF":  ["ushuaia", "rio grande"],
    "SGO":  ["santiago del estero", "la banda"],
    "CAT":  ["catamarca", "san fernando del valle de catamarca"],
    "LR":   ["la rioja"],
    "SJ":   ["san juan"],
    "LP":   ["santa rosa"],
    "CHA":  ["resistencia"],
    "FOR":  ["formosa"],
    "SCZ":  ["rio gallegos", "el calafate"],
}


def _build_place_index():
    index = []
    for code, phrase in PROVINCE_NAMES.items():
        for token in phrase.split(","):
            index.append((token.strip(), code))
    for code, cities in PROVINCE_CITIES.items():
        for city in cities:
            index.append((city.strip(), code))
    # Longest first, so "ciudad autonoma de buenos aires" (CABA) wins over "buenos aires" (BA)
    return sorted(index, key=lambda x: -len(x[0]))


PLACE_INDEX = _build_place_index()


def province_of(location):
    w = words(location)
    if not w:
        return None
    for phrase, code in PLACE_INDEX:
        if f" {phrase} " in f" {w} ":
            return code
    return None


# --- Role mapping -------------------------------------------------------------
import re

ROLE_PATTERNS = [
    ("software-engineering-manager", re.compile(r"\bengineering manager\b|\bmanager / director\b|\bjefe de (desarrollo|ingenieria|sistemas)\b|\bcto\b|\btechnical director\b")),
    ("tech-lead",       re.compile(r"\btech lead\b|\btechnical lead(er)?\b|\blider tecnico\b|\blead developer\b")),
    ("data-scientist",  re.compile(r"\bdata sci\w*\b|\bml engineer\b|\bai engineer\b|\bmachine learning\b|\bcientific\w* de datos\b")),
    ("data-engineer",   re.compile(r"\bdata engineer\b|\bdata platform\b|\bingeni\w* de datos\b")),
    ("devops-engineer", re.compile(r"\bdevops\b|\bsre\b|\bsite reliability\b|\binfrastructure engineer\b|\bplatform engineer\b|\bcloud engineer\b|\binfrastructura\b")),
    ("security-engineer", re.compile(r"\bsecurity\b|\bciberseguridad\b|\bpentester\b|\binfosec\b")),
    ("qa-engineer",     re.compile(r"\bqa\b|\bquality assurance\b|\btester?\b|\btest automation\b|\bsdet\b")),
    ("product-manager", re.compile(r"\bproduct manager\b|\bproduct owner\b|\bdirector de producto\b")),
    ("ux-designer",     re.compile(r"\bux\b|\bui designer\b|\buser experience\b|\bdisenad\w+ (ux|ui|web)\b")),
    ("software-engineer", re.compile(r"\bdeveloper\b|\bdesarrollador\b|\bprogramador\b|\bsoftware engineer\b|\bfullstack\b|\bbackend\b|\bfrontend\b|\bmobile\b")),
]


def title_role(job_title):
    w = " ".join(normalize(job_title))
    for slug, pat in ROLE_PATTERNS:
        if pat.search(w):
            return slug
    return None


# --- Experience bucket --------------------------------------------------------

def years_bucket(raw):
    try:
        n = int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None
    if n < 0:
        return None
    if n <= 1:
        return "0-1"
    if n <= 4:
        return "2-4"
    if n <= 7:
        return "5-7"
    if n <= 11:
        return "8-11"
    if n <= 19:
        return "12-19"
    return "20+"


# --- Statistics ---------------------------------------------------------------

def median(values):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def percentile(values, p):
    if not values:
        return None
    s = sorted(values)
    idx = (len(s) - 1) * p / 100
    lo, hi = int(idx), math.ceil(idx)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo) if lo != hi else s[lo]


def histogram(values, low, step, high):
    n_bins = int((high - low) / step)
    bins = [0] * n_bins
    for v in values:
        idx = int((v - low) / step)
        idx = max(0, min(idx, n_bins - 1))
        bins[idx] += 1
    return bins


def round_to(value, nearest):
    if value is None:
        return None
    return round(value / nearest) * nearest


# --- Main ingest --------------------------------------------------------------

ROLES = ["software-engineer", "tech-lead", "software-engineering-manager",
         "data-scientist", "devops-engineer", "qa-engineer", "product-manager",
         "data-engineer", "ux-designer", "security-engineer"]
ROLE_NAMES = {
    "software-engineer": "Software Engineer / Desarrollador",
    "tech-lead": "Tech Lead / Líder Técnico",
    "software-engineering-manager": "Engineering Manager",
    "data-scientist": "Data Scientist / ML Engineer",
    "devops-engineer": "DevOps / SRE / Infraestructura",
    "qa-engineer": "QA / Tester",
    "product-manager": "Product Manager",
    "data-engineer": "Data Engineer",
    "ux-designer": "UX Designer",
    "security-engineer": "Security Engineer",
}
YEARS_BUCKETS = ["0-1", "2-4", "5-7", "8-11", "12-19", "20+"]

HIST_LOW  = 4000
HIST_STEP = 4000
HIST_HIGH = 80000

ROUND_USD = 500
ROUND_ARS = 500_000


def read_survey(csv_path):
    """Read the CSV, skipping any preamble lines above the real header row."""
    with open(csv_path, encoding="utf-8-sig", errors="replace", newline="") as f:
        raw = list(csv.reader(f))
    known = {c for cands in COLS.values() for c in cands}
    for i, line in enumerate(raw[:50]):
        if sum(1 for c in line if c.strip() in known) >= 3:
            header = [c.strip() for c in line]
            rows = [dict(zip(header, r)) for r in raw[i + 1:] if any(x.strip() for x in r)]
            return header, rows
    raise SystemExit("[ingest] No header row with known columns found in the first 50 lines")


def ingest(csv_path, mep_rate, min_group=5, date="auto", edition=None):
    header, rows = read_survey(csv_path)
    col_map = build_col_map(header)
    print(f"[ingest] CSV columns found: {list(col_map.keys())}", file=sys.stderr)
    missing = {"job_title", "location", "years", "salary"} - col_map.keys()
    if missing:
        raise SystemExit(f"[ingest] Missing required columns: {sorted(missing)}")
    # Newer editions report salary in pesos for everyone (USD-paid included).
    salary_in_ars = "pesos" in col_map["salary"].lower()
    print(f"[ingest] Total rows: {len(rows)}", file=sys.stderr)

    # Buckets: cells[role|province|years] = list of annual USD values
    cells_usd = defaultdict(list)
    cells_ars = defaultdict(list)
    # For company aggregation: company_name → list of annual USD
    company_usd = defaultdict(list)
    company_ars = defaultdict(list)

    skipped = 0
    for row in rows:
        job_title  = get(row, col_map, "job_title")
        location   = get(row, col_map, "location")
        years_raw  = get(row, col_map, "years")
        salary_raw = get(row, col_map, "salary")
        paid_usd   = get(row, col_map, "paid_usd")
        company    = get(row, col_map, "company")

        role = title_role(job_title)
        if not role:
            skipped += 1
            continue

        prov = province_of(location)
        if not prov:
            skipped += 1
            continue

        yb = years_bucket(years_raw)
        if not yb:
            skipped += 1
            continue

        try:
            monthly = float(str(salary_raw).replace(",", ".").replace(".", "").replace(",", "."))
            # Handle European-style numbers like "1.200.000" or "1,200,000"
            # Try multiple parse strategies
            clean = str(salary_raw).strip()
            # Remove currency symbols
            clean = re.sub(r"[^\d.,]", "", clean)
            if not clean:
                skipped += 1
                continue
            # Detect if it's formatted with dots as thousands separator
            if re.match(r"^\d{1,3}(\.\d{3})+(,\d+)?$", clean):
                clean = clean.replace(".", "").replace(",", ".")
            elif re.match(r"^\d{1,3}(,\d{3})+(\.\d+)?$", clean):
                clean = clean.replace(",", "")
            monthly = float(clean)
        except (ValueError, TypeError):
            skipped += 1
            continue

        if monthly <= 0 or monthly > 100_000_000:
            skipped += 1
            continue

        in_usd = (not salary_in_ars) and bool(re.search(r"^(s[íi]|yes|true|1)$", paid_usd.strip(), re.IGNORECASE))

        if in_usd:
            # Already paid in USD; treat monthly as USD
            annual_usd = monthly * 12
            annual_ars = annual_usd * mep_rate
        else:
            annual_ars = monthly * 12
            annual_usd = annual_ars / mep_rate

        # Sanity check: skip obvious outliers
        if annual_usd < 500 or annual_usd > 500_000:
            skipped += 1
            continue

        key = f"{role}|{prov}|{yb}"
        cells_usd[key].append(annual_usd)
        cells_ars[key].append(annual_ars)

        if company:
            cname = company.strip()
            company_usd[cname].append(annual_usd)
            company_ars[cname].append(annual_ars)

    print(f"[ingest] Skipped: {skipped}, Classified: {sum(len(v) for v in cells_usd.values())}", file=sys.stderr)

    # Threshold: median of mid-career (5-11 years) respondents; "share" = % at or above it
    all_usd = [v for key, vals in cells_usd.items() if key.endswith(("|5-7", "|8-11")) for v in vals]
    threshold_usd = round_to(median(all_usd), ROUND_USD) if all_usd else 18_000
    threshold_ars = round_to(threshold_usd * mep_rate, ROUND_ARS)

    # Build cells dict
    cells_out = {}
    for key, usd_list in cells_usd.items():
        ars_list = cells_ars[key]
        n = len(usd_list)
        if n < min_group:
            continue

        med_usd = median(usd_list)
        med_ars = median(ars_list)
        p25_usd = percentile(usd_list, 25)
        p75_usd = percentile(usd_list, 75)
        p25_ars = percentile(ars_list, 25)
        p75_ars = percentile(ars_list, 75)
        # Total = rough estimate including bonus (10% bump for roles that often have bonus)
        total_usd = med_usd * 1.1
        total_ars = med_ars * 1.1
        share = sum(1 for v in usd_list if v >= threshold_usd) / n

        hist = histogram(usd_list, HIST_LOW, HIST_STEP, HIST_HIGH)
        # Employment mix: salaried / contractor / freelance (placeholder, survey has this info)
        mix = [70, 20, 10]

        cells_out[key] = {
            "n": n,
            "median_usd": round_to(med_usd, ROUND_USD),
            "p25_usd":    round_to(p25_usd, ROUND_USD),
            "p75_usd":    round_to(p75_usd, ROUND_USD),
            "median_ars": round_to(med_ars, ROUND_ARS),
            "p25_ars":    round_to(p25_ars, ROUND_ARS),
            "p75_ars":    round_to(p75_ars, ROUND_ARS),
            "total_usd":  round_to(total_usd, ROUND_USD),
            "total_ars":  round_to(total_ars, ROUND_ARS),
            "share": round(share, 2),
            "hist": hist,
            "mix": mix,
        }

    # Build companies list
    companies_out = []
    for cname, usd_list in sorted(company_usd.items(), key=lambda x: -len(x[1])):
        ars_list = company_ars[cname]
        n = len(usd_list)
        if n < 3:
            continue
        companies_out.append({
            "name": cname,
            "n": n,
            "median_usd": round_to(median(usd_list), ROUND_USD),
            "median_ars": round_to(median(ars_list), ROUND_ARS),
            "p25_usd": round_to(percentile(usd_list, 25), ROUND_USD),
            "p75_usd": round_to(percentile(usd_list, 75), ROUND_USD),
            "p25_ars": round_to(percentile(ars_list, 25), ROUND_ARS),
            "p75_ars": round_to(percentile(ars_list, 75), ROUND_ARS),
        })

    out = {
        "sample": False,
        "date": date,
        "source": f"Encuesta de sueldos sysarmy {edition or ''}".strip() + f", procesada con MEP {mep_rate}",
        "license": "CC BY-NC-SA 4.0",
        "mep_rate": mep_rate,
        "threshold_usd": threshold_usd,
        "threshold_ars": threshold_ars,
        "min_group": min_group,
        "min_ranked": 3,
        "quartile_min": min_group,
        "round_usd": ROUND_USD,
        "round_ars": ROUND_ARS,
        "roles": [{"slug": s, "name": ROLE_NAMES[s]} for s in ROLES],
        "provinces": {
            "CABA": {"es": "Buenos Aires (CABA)", "en": "Buenos Aires City"},
            "BA":   {"es": "Buenos Aires (prov.)", "en": "Buenos Aires Province"},
            "CBA":  {"es": "Córdoba", "en": "Córdoba"},
            "SF":   {"es": "Santa Fe", "en": "Santa Fe"},
            "MZA":  {"es": "Mendoza", "en": "Mendoza"},
            "TUC":  {"es": "Tucumán", "en": "Tucumán"},
            "NQN":  {"es": "Neuquén", "en": "Neuquén"},
            "RN":   {"es": "Río Negro", "en": "Río Negro"},
            "ER":   {"es": "Entre Ríos", "en": "Entre Ríos"},
            "SL":   {"es": "San Luis", "en": "San Luis"},
            "SAL":  {"es": "Salta", "en": "Salta"},
            "JUJ":  {"es": "Jujuy", "en": "Jujuy"},
            "MIS":  {"es": "Misiones", "en": "Misiones"},
            "CTE":  {"es": "Corrientes", "en": "Corrientes"},
            "CHU":  {"es": "Chubut", "en": "Chubut"},
            "TDF":  {"es": "Tierra del Fuego", "en": "Tierra del Fuego"},
            "SGO":  {"es": "Santiago del Estero", "en": "Santiago del Estero"},
            "CAT":  {"es": "Catamarca", "en": "Catamarca"},
            "LR":   {"es": "La Rioja", "en": "La Rioja"},
            "SJ":   {"es": "San Juan", "en": "San Juan"},
            "LP":   {"es": "La Pampa", "en": "La Pampa"},
            "CHA":  {"es": "Chaco", "en": "Chaco"},
            "FOR":  {"es": "Formosa", "en": "Formosa"},
            "SCZ":  {"es": "Santa Cruz", "en": "Santa Cruz"},
        },
        "years": YEARS_BUCKETS,
        "companies": companies_out,
        "cells": cells_out,
        "hist": {"low": HIST_LOW, "step": HIST_STEP, "high": HIST_HIGH},
    }

    return out


MEP_HISTORY_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa"


def fetch_mep(month):
    """Median MEP (dólar bolsa, venta) for a YYYY-MM month, from argentinadatos.com."""
    import subprocess
    import urllib.error
    import urllib.request
    try:
        req = urllib.request.Request(MEP_HISTORY_URL, headers={"User-Agent": "ingest-sysarmy"})
        with urllib.request.urlopen(req, timeout=30) as r:
            history = json.load(r)
    except urllib.error.URLError:
        # python.org builds on macOS often lack CA certs; curl uses the system store.
        out = subprocess.run(["curl", "-sfL", "--max-time", "30", MEP_HISTORY_URL],
                             capture_output=True, check=True)
        history = json.loads(out.stdout)
    values = [d["venta"] for d in history if str(d.get("fecha", "")).startswith(month) and d.get("venta")]
    if not values:
        raise SystemExit(f"[ingest] No MEP data for {month} at {MEP_HISTORY_URL}")
    rate = round(median(values), 1)
    print(f"[ingest] MEP {month}: median {rate} over {len(values)} days (argentinadatos.com)", file=sys.stderr)
    return rate


def main():
    parser = argparse.ArgumentParser(description="Ingest sysarmy survey CSV → data/data.json")
    parser.add_argument("csv", help="Path to the sysarmy survey CSV file")
    parser.add_argument("--mep-rate", type=float,
                        help="ARS/USD MEP (dólar bolsa) rate at time of survey. Overrides --survey-month.")
    parser.add_argument("--survey-month", metavar="YYYY-MM",
                        help="Month the survey was taken; its median MEP is fetched automatically")
    parser.add_argument("--edition", help="Survey edition label, e.g. 2026.1")
    parser.add_argument("--out", default="data/data.json", help="Output path")
    parser.add_argument("--min-group", type=int, default=5,
                        help="Minimum salaries per cell to include in output (default 5)")
    args = parser.parse_args()

    if args.mep_rate is None and not args.survey_month:
        parser.error("pass --survey-month YYYY-MM (auto MEP) or --mep-rate")
    mep_rate = args.mep_rate if args.mep_rate is not None else fetch_mep(args.survey_month)
    data = ingest(args.csv, mep_rate, args.min_group,
                  date=args.survey_month or "auto", edition=args.edition)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[ingest] Written {len(data['cells'])} cells, {len(data['companies'])} companies → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
