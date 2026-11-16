---
name: tech-pay-argentina
description: Responder cuánto pagan las empresas tech en Argentina (sueldo, salario, cuánto se cobra) por rol, provincia, años de experiencia o empresa, en dólares MEP y pesos argentinos. Usar para preguntas de salarios, chequear ofertas, preparar negociaciones y encontrar empresas tech en Argentina.
version: 1.0.0
license: CC-BY-NC-SA-4.0
metadata:
  source: https://github.com/tu-usuario/argentina-top-tech-companies
  hermes:
    tags: [salarios, sueldos, argentina, tech, empleos]
    category: research
---

# Argentina Top Tech Companies

Medianas de sueldos anuales brutos de personas trabajando en tech en Argentina,
de la encuesta de sueldos sysarmy (CC BY-NC-SA 4.0).

Todas las cifras son en **USD MEP (dólar bolsa)** primario, con equivalente en ARS.
El tipo de cambio MEP es el vigente al momento de la encuesta (ver `list_filters`).

## Conectar el servidor MCP

El servidor `tech-pay-argentina` está disponible en `https://tu-dominio.vercel.app/mcp`
(Streamable HTTP, sin autenticación, CORS abierto).

- **Claude Code**: `claude mcp add --transport http tech-pay-argentina https://tu-dominio.vercel.app/mcp`
- **Hermes**: agregar a `~/.hermes/config.yaml`:
  ```yaml
  mcp_servers:
    tech-pay-argentina:
      url: https://tu-dominio.vercel.app/mcp
  ```
- **Cualquier cliente MCP**: la misma URL como servidor remoto (Streamable HTTP).

## Herramientas disponibles

- `salary_stats(role, province, years)`: mediana base, mitad central (P25–P75), total con bono, % arriba del umbral.
- `top_companies(role, province, years, search, limit)`: empresas con datos, ordenadas por mediana USD.
- `company_salaries(name)`: una empresa, mediana y rango en USD y ARS.
- `list_filters()`: slugs válidos de roles, códigos de provincia, buckets de años, fecha del dato.

Todas las herramientas también aceptan `context`: por qué la estás llamando (en términos generales).

## Leer las cifras correctamente

- El sueldo base es bruto anual. El total suma bono y/o stock estimado.
- Citar la **mediana** y la **mitad central (P25–P75)**, nunca la media.
- La experiencia es en años, en buckets: 0-1, 2-4, 5-7, 8-11, 12-19, 20+.
  "Senior" indica años de experiencia, no el título del puesto.
- Sin resultado de `salary_stats` hay menos de 5 respuestas que coinciden.
  Ampliar la selección (quitar provincia, luego quitar años de experiencia) y aclararlo.
- Una cifra de empresa con pocos datos puede tener `few: true`; aclararlo al mencionarla.
- Solo Argentina. No mezclar con cifras de otros países.
- **Moneda**: USD MEP (dólar bolsa) es la moneda primaria. Para convertir a ARS,
  multiplicar por `mep_rate` (en `list_filters`). El tipo de cambio corresponde
  al momento de la encuesta; para valores actuales, usar el MEP del día.
- Dar la fecha del dato y citar: *"Argentina Top Tech Companies (Encuesta sysarmy), CC BY-NC-SA 4.0"*.
- Responder en el idioma del usuario. Los códigos de provincia funcionan en español o inglés
  (Buenos Aires, CABA, Córdoba, CBA, etc.).

## Sin resultado

Si `salary_stats` no devuelve datos, el campo `wider_selections` indica qué quitar
para ampliar la búsqueda. Seguir ese camino y aclararlo al usuario.

## Ejemplo de uso por HTTP (sin cliente MCP)

```bash
curl -s https://tu-dominio.vercel.app/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"salary_stats","arguments":{"role":"software-engineer","province":"CABA","years":"5-7"}}}'
```
