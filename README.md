# Argentina Top Tech Companies

Sueldos reales de la industria tech argentina, en dólares MEP (dólar bolsa) y pesos argentinos.
Datos de la [encuesta de sueldos sysarmy](https://sysarmy.com/encuesta) (CC BY-SA 4.0).

## Monedas

Todos los sueldos son **anuales brutos**.

- **USD MEP (dólar bolsa)**: moneda principal en la web y en el MCP server.
  El tipo de cambio usado es el MEP vigente al momento de la encuesta
  (pasado como `--mep-rate` al pipeline de ingesta).
- **ARS (pesos argentinos)**: mostrado en tooltip en la web; retornado también en las herramientas MCP.

Los respondentes que declaran cobrar en dólares (`Pagos en dólares = Sí`) tienen su sueldo
registrado directamente en USD; para el resto se divide el sueldo en pesos por el tipo MEP.

## Quickstart

### 1. Instalar dependencias

```bash
npm install
```

### 2. Bajar la encuesta sysarmy

Los CSVs de encuestas anteriores están en [openqube/openqube-sueldos](https://github.com/openqube/openqube-sueldos).
La encuesta más reciente se publica en [sysarmy.com/encuesta](https://sysarmy.com/encuesta).

### 3. Correr el pipeline de ingesta

```bash
python3 scripts/ingest_sysarmy.py ruta/a/encuesta.csv --mep-rate 1250 --out data/data.json
```

El argumento `--mep-rate` es el tipo de cambio MEP (ARS/USD) al momento de la encuesta.
Por ejemplo, si la encuesta es de mediados de 2024 y el MEP estaba en 1250 ARS/USD,
se pasa `--mep-rate 1250`.

El archivo `data/data.json` incluido en el repo tiene **datos de muestra** para que la app
funcione sin necesidad de correr la ingesta. Estos datos son sintéticos y no representan
sueldos reales; se reemplazan al correr el pipeline con datos reales.

### 4. Correr localmente

```bash
npx vercel dev
```

La app queda disponible en `http://localhost:3000`.

### 5. Deploy en Vercel

```bash
npx vercel --prod
```

## Estructura

```
├── api/
│   ├── _classify.js        # Mapeo de provincias y roles (usado por MCP e ingesta)
│   ├── company.js          # Endpoint /api/v1/companies/:name.json
│   ├── data.js             # Endpoint /api/v1/data.json
│   └── mcp.js              # MCP server (Streamable HTTP)
├── data/
│   └── data.json           # Dataset (sample incluido; reemplazar con datos reales)
├── scripts/
│   └── ingest_sysarmy.py   # Pipeline de ingesta: encuesta.csv → data.json
├── skills/
│   └── tech-pay-argentina/ # Skill MCP para agentes AI
│       └── SKILL.md
├── web/
│   ├── app.js              # Frontend vanilla JS
│   ├── index.html          # Página principal
│   └── style.css           # Estilos (azul celeste argentino #74ACDF)
├── package.json
└── vercel.json
```

## MCP Server

El MCP server expone herramientas de consulta de sueldos a agentes AI.
Acceso: `POST /mcp` (Streamable HTTP, JSONRPC 2.0).

Herramientas disponibles:

- `salary_stats(role, province, years)` — mediana, P25, P75 en USD MEP y ARS
- `top_companies(role, province, years, search, limit)` — ranking de empresas por mediana
- `company_salaries(name)` — datos de una empresa específica
- `list_filters()` — slugs válidos de roles, códigos de provincia, buckets de experiencia

Conectar desde Claude Code:

```bash
claude mcp add --transport http tech-pay-argentina https://tu-dominio.vercel.app/mcp
```

## Fuente de datos

- **Encuesta**: [sysarmy.com/encuesta](https://sysarmy.com/encuesta) — encuesta semestral de sueldos tech en Argentina
- **Datos históricos**: [openqube/openqube-sueldos](https://github.com/openqube/openqube-sueldos)
- **Licencia de los datos**: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

## Licencia

Código: MIT. Datos: CC BY-SA 4.0 (sysarmy).

Citación sugerida: *Argentina Top Tech Companies (Encuesta sysarmy), CC BY-SA 4.0.*
