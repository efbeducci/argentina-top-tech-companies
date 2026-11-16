// Argentine province mapping and sysarmy role taxonomy for the ingest pipeline and MCP server.
// Not a Vercel Function (files starting with _ in api/ are not served).

export const norm = (text) => String(text ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
  .toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).join(" ");

export const words = (text) => norm(text)
  .replace(/([a-z])\s*\/\s*(?:a|as|ra|ras)\b/g, "$1")
  .replace(/([a-z])\s*\((?:a|as)\)/g, "$1")
  .replace(/([a-z])@/g, "$1o")
  .replace(/[^a-z0-9+#]+/g, " ").trim();

// --- Argentine provinces -------------------------------------------------------

export const PROVINCE_NAMES = {
  CABA: "Ciudad Autónoma de Buenos Aires, CABA, Capital Federal, Ciudad de Buenos Aires, Buenos Aires Ciudad",
  BA:   "Buenos Aires, Provincia de Buenos Aires, GBA, Gran Buenos Aires, Conurbano Bonaerense",
  CBA:  "Córdoba",
  SF:   "Santa Fe",
  MZA:  "Mendoza",
  TUC:  "Tucumán",
  NQN:  "Neuquén",
  RN:   "Río Negro, Rio Negro",
  ER:   "Entre Ríos, Entre Rios",
  SL:   "San Luis",
  SAL:  "Salta",
  JUJ:  "Jujuy",
  MIS:  "Misiones",
  CTE:  "Corrientes",
  CHU:  "Chubut",
  TDF:  "Tierra del Fuego",
  SGO:  "Santiago del Estero",
  CAT:  "Catamarca",
  LR:   "La Rioja",
  SJ:   "San Juan",
  LP:   "La Pampa",
  CHA:  "Chaco",
  FOR:  "Formosa",
  SCZ:  "Santa Cruz",
};

// Main cities keyed by province code; "/" joins aliases of the same city.
export const CITIES = {
  CABA: "Buenos Aires/CABA/Capital Federal",
  BA:   "La Plata, Mar del Plata, Bahía Blanca/Bahia Blanca, San Miguel, Quilmes, Lomas de Zamora, Lanús/Lanus, Avellaneda, Tigre, Morón/Moron, Tres de Febrero, Merlo, San Isidro, Vicente López/Vicente Lopez, Campana, Zárate/Zarate",
  CBA:  "Córdoba/Cordoba, Villa Carlos Paz, Río Cuarto/Rio Cuarto, San Francisco, Villa María/Villa Maria",
  SF:   "Rosario, Santa Fe, Rafaela, Venado Tuerto",
  MZA:  "Mendoza, San Rafael, Godoy Cruz, Luján de Cuyo/Lujan de Cuyo",
  TUC:  "San Miguel de Tucumán/Tucuman, Yerba Buena, Tafí Viejo/Tafi Viejo",
  NQN:  "Neuquén/Neuquen, Cipolletti",
  RN:   "Bariloche, Viedma, Cipolletti",
  ER:   "Paraná/Parana, Concordia, Gualeguaychú/Gualeguaychu",
  SL:   "San Luis, Villa Mercedes",
  SAL:  "Salta, Tartagal",
  JUJ:  "San Salvador de Jujuy/Jujuy, Palpalá/Palpala",
  MIS:  "Posadas, Oberá/Obera",
  CTE:  "Corrientes, Goya",
  CHU:  "Comodoro Rivadavia, Trelew, Puerto Madryn",
  TDF:  "Ushuaia, Río Grande/Rio Grande",
  SGO:  "Santiago del Estero, La Banda",
  CAT:  "San Fernando del Valle de Catamarca/Catamarca",
  LR:   "La Rioja",
  SJ:   "San Juan",
  LP:   "Santa Rosa",
  CHA:  "Resistencia",
  FOR:  "Formosa",
  SCZ:  "Río Gallegos/Rio Gallegos, El Calafate",
};

const splitNames = (text, sep) => String(text ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
const plainWords = (text) => norm(text).replace(/[^a-z0-9]+/g, " ").trim();

// Every place as [normalizedWords, provinceCode, primaryCityName|null].
export const PLACES = [
  ...Object.entries(PROVINCE_NAMES).flatMap(([code, names]) =>
    splitNames(names, ",").map((n) => [n, code, null])),
  ...Object.entries(CITIES).flatMap(([code, list]) =>
    splitNames(list, ",").flatMap((group) =>
      splitNames(group, "/").map((n) => [n, code, splitNames(group, "/")[0]]))),
].map(([name, code, city]) => [plainWords(name), code, city]);

export const placeNames = (code, city) =>
  PLACES.filter(([, c, ci]) => c === code && (!city || ci === city)).map(([n]) => n);

const hasPhrase = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

export function provincesOf(location) {
  const where = words(location);
  if (!where) return [];
  const found = new Set();
  for (const [name, code] of PLACES) if (name && hasPhrase(where, name)) found.add(code);
  return [...found];
}

// --- Roles -------------------------------------------------------------------

// Sysarmy survey "Trabajo de" values map to these slugs.
// Each entry: [slug, pattern, unless?]. Patterns read words(jobTitle).
export const ROLE_TITLES = [
  ["software-engineering-manager", /\bengineering manager\b|\bjefe de (desarrollo|ingenieria|sistemas)\b|\b(technical|tech) director\b|\bdirector (de )?(tecnologia|ingenieria)\b|\bcto\b/],
  ["tech-lead", /\b(tech|technical) lead\b|\blider (tecnico|de desarrollo)\b|\blead developer\b|\blead (backend|frontend|fullstack|software)\b/],
  ["data-scientist", /\bdata sci\w*\b|\bml engineer\b|\bmachine learning\b|\bcientific\w* de datos\b/],
  ["data-engineer", /\bdata engineer\b|\bdata platform\b|\bingeni\w* de datos\b/],
  ["devops-engineer", /\bdevops\b|\bsre\b|\bsite reliability\b|\binfrastructure engineer\b|\bplatform engineer\b|\bcloud engineer\b|\binfrastructura\b/],
  ["security-engineer", /\bsecurity\b|\bciberseguridad\b|\bpentester\b|\bsoc analyst\b|\binfosec\b/],
  ["qa-engineer", /\bqa\b|\bquality assurance\b|\btester?\b|\btest automation\b|\bautomation engineer\b|\bsdet\b/],
  ["product-manager", /\bproduct manager\b|\bproduct owner\b|\bpo\b|\bdirector de producto\b/],
  ["ux-designer", /\bux\b|\bui designer\b|\buser experience\b|\bdiseñador\w* (ux|ui|web|grafico)\b/],
  ["software-engineer", /\bdeveloper\b|\bdesarrollador\b|\bprogramador\b|\bsoftware engineer\b|\bfullstack\b|\bfull stack\b|\bbackend\b|\bfrontend\b|\bfront end\b|\bback end\b|\bmobile\b|\bios developer\b|\bandroid developer\b/],
];

// Map a job title string to its role slug(s).
export function titleRoles(title) {
  const w = words(title);
  const found = [];
  for (const [slug, pattern, unless] of ROLE_TITLES) {
    if (pattern.test(w) && (!unless || !unless.test(w))) found.push(slug);
  }
  return found;
}

// --- Experience buckets ------------------------------------------------------

export const YEARS_BUCKETS = ["0-1", "2-4", "5-7", "8-11", "12-19", "20+"];

const YEARS_RANGES = [
  [/^0$|^1$/, "0-1"],
  [/^[23]$|^4$/, "2-4"],
  [/^[567]$/, "5-7"],
  [/^[89]$|^1[01]$/, "8-11"],
  [/^1[2-9]$/, "12-19"],
  [/^(20|[2-9]\d|\d{3,})$/, "20+"],
];

export function yearsToRange(raw) {
  const n = parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  for (const [pat, bucket] of YEARS_RANGES) if (pat.test(String(n))) return bucket;
  return null;
}

// --- Currency helpers --------------------------------------------------------

export function annualARS(monthlyGross) {
  return Math.round(Number(monthlyGross) * 12);
}

export function arsToUSD(annualARS, mepRate) {
  return Math.round(annualARS / Number(mepRate));
}

// --- Keywords (skills matching) -----------------------------------------------
// Subset relevant to Argentine tech market.
export const KEYWORDS = [
  ["python",     ["python"]],
  ["javascript", ["javascript", "js"]],
  ["typescript", ["typescript", "ts"]],
  ["java",       ["java"], { cased: "Java" }],
  ["golang",     ["go", "golang"]],
  ["rust",       ["rust"]],
  ["c-sharp",    ["c#", "dotnet", ".net"]],
  ["c-plus-plus",["c++"]],
  ["php",        ["php"]],
  ["ruby",       ["ruby"]],
  ["kotlin",     ["kotlin"]],
  ["swift",      ["swift"]],
  ["scala",      ["scala"]],
  ["react",      ["react", "reactjs", "react.js"]],
  ["angular",    ["angular", "angularjs"]],
  ["vue",        ["vue", "vuejs", "vue.js"]],
  ["node",       ["node", "nodejs", "node.js"]],
  ["django",     ["django"]],
  ["fastapi",    ["fastapi", "fast api"]],
  ["spring",     ["spring", "spring boot"]],
  ["laravel",    ["laravel"]],
  ["rails",      ["rails", "ruby on rails"]],
  ["docker",     ["docker"]],
  ["kubernetes", ["kubernetes", "k8s"]],
  ["terraform",  ["terraform"]],
  ["aws",        ["aws", "amazon web services"]],
  ["gcp",        ["gcp", "google cloud"]],
  ["azure",      ["azure"]],
  ["postgresql", ["postgresql", "postgres"]],
  ["mysql",      ["mysql"]],
  ["mongodb",    ["mongodb", "mongo"]],
  ["redis",      ["redis"]],
  ["elasticsearch", ["elasticsearch", "elastic"]],
  ["kafka",      ["kafka"]],
  ["graphql",    ["graphql"]],
  ["react-native",["react native"]],
  ["flutter",    ["flutter"]],
  ["machine-learning", ["machine learning", "ml", "ai", "inteligencia artificial"]],
  ["data-science", ["data science", "ciencia de datos"]],
  ["spark",      ["spark", "apache spark"]],
  ["airflow",    ["airflow"]],
  ["dbt",        ["dbt"]],
  ["git",        ["git"]],
  ["linux",      ["linux"]],
  ["agile",      ["agile", "scrum", "kanban"]],
];

export function keywordsOf(text) {
  const w = ` ${norm(text)} `;
  const found = [];
  for (const [id, forms] of KEYWORDS) {
    if (forms.some((f) => w.includes(` ${norm(f)} `))) found.push(id);
  }
  return found;
}

// --- Classify a sysarmy survey row -------------------------------------------

export function classify(row) {
  // Normalize common column name variants across survey editions.
  const get = (...candidates) => {
    for (const k of candidates) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  const jobTitle   = get("Trabajo de", "trabajo_de", "Puesto");
  const location   = get("Dónde estoy trabajando", "donde_estoy_trabajando", "Provincia", "Localidad");
  const yearsRaw   = get("Años de experiencia", "anios_de_experiencia", "Experiencia");
  const salaryRaw  = get("Salario mensual BRUTO (en tu moneda local)", "salario_mensual_bruto", "Sueldo");
  const paidInUSD  = get("Pagos en dólares", "pagos_en_dolares", "Cobro en dolares");
  const company    = get("Nombre de la empresa donde trabajo", "empresa", "Empleador");
  const usdType    = get("Tipo de dólar elegido", "tipo_de_dolar_elegido", "Dólar elegido para conversión");

  const roles = titleRoles(jobTitle);
  const provinces = provincesOf(location);
  const yearBucket = yearsToRange(yearsRaw);
  const salaryNum = parseFloat(String(salaryRaw).replace(/[^0-9.]/g, ""));

  const inUSD = /sí|si|yes|true|1/i.test(paidInUSD);

  return { roles, provinces, yearBucket, salaryNum, inUSD, usdType, company, jobTitle };
}
