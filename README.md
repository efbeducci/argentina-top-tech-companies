# Argentina Top Tech Companies

Sueldos reales de la industria tech argentina, en dólares MEP (dólar bolsa) y pesos argentinos.
Datos de la [encuesta de sueldos sysarmy](https://sysarmy.com/encuesta) (CC BY-NC-SA 4.0).

## Monedas

Todos los sueldos son **anuales brutos**.

- **USD MEP (dólar bolsa)**: moneda principal en la web y en el MCP server.
  Los sueldos en pesos de la encuesta se convierten con la **mediana del MEP del mes de la encuesta**,
  que el pipeline baja automáticamente de [argentinadatos.com](https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa).
- **ARS (pesos argentinos)**: la web muestra el equivalente **al MEP de hoy**
  (consultado en vivo a [dolarapi.com](https://dolarapi.com/v1/dolares/bolsa)) y, en el tooltip, el valor en pesos
  de la encuesta. Si dolarapi no responde, se usa el MEP de la encuesta.

Desde ~2023 la encuesta reporta el sueldo bruto siempre en pesos (incluso para quien cobra en dólares),
así que todas las respuestas se convierten ARS → USD con el MEP de la encuesta.

## Quickstart

### 1. Instalar dependencias

```bash
npm install
```

### 2. Bajar la encuesta sysarmy

La encuesta más reciente y su dataset se publican en el [blog de sysarmy](https://sysarmy.com/blog/tags/sueldos/)
como Google Sheet. Para la edición 2026.1:

```bash
curl -L 'https://docs.google.com/spreadsheets/d/1PBQxpX3jQtuD92N9BcJtYxzCtPgyY3Y90bVBFPKbUmY/export?format=csv' -o encuesta-2026.1.csv
```

Ediciones viejas (hasta 2021.02) están en [openqube/openqube-sueldos](https://github.com/openqube/openqube-sueldos).

### 3. Correr el pipeline de ingesta

```bash
python3 scripts/ingest_sysarmy.py encuesta-2026.1.csv --survey-month 2026-01 --edition 2026.1 --out data/data.json
```

- `--survey-month YYYY-MM`: mes en que se tomó la encuesta; el script baja el MEP histórico de ese mes.
- `--mep-rate N`: alternativa para fijar el tipo de cambio a mano.

El `data/data.json` del repo tiene los datos reales de la encuesta **2026.1** (MEP enero 2026: 1476,1).

**Empresas:** sysarmy no publica el nombre de la empresa de cada respondente, así que el ranking
de empresas queda vacío con datos reales. El pipeline lo arma solo si el CSV trae esa columna.

### 4. Correr localmente

```bash
npm run dev
```

La app queda disponible en `http://localhost:3000` y el MCP server en `http://localhost:3000/mcp`.
Es un server Node sin dependencias (`scripts/dev-server.js`) que replica los rewrites de `vercel.json`;
no requiere cuenta de Vercel. Para usar otro puerto: `PORT=4000 npm run dev`.

Alternativa con el runtime real de Vercel (requiere Node 20+ y `vercel login`): `npx vercel dev`.

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
- **Licencia de los datos**: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)

## Licencia

Código: MIT. Datos: CC BY-NC-SA 4.0 (sysarmy).

Citación sugerida: *Argentina Top Tech Companies (Encuesta sysarmy), CC BY-NC-SA 4.0.*
