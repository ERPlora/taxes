# Seed canónico del módulo `taxes` (ADR-0085)

Dos capas, alineadas con ADR-0072 (seed por país, `<país>/<sector>/`):

- **`canonical.json`** — las **categorías fiscales canónicas** del módulo (`is_system=1`) + los
  **alias de fábrica** (`source='shipped'`). Son universales (no dependen del país) y deben
  existir en **todo** hub: es lo que garantiza el contrato `required_tax_categories` del
  `module.json` de otros módulos. Se siembran al instalar `taxes` (o vía el seed por país).
- **`es.json`** — las **reglas de tipo** (`taxes_rule`) de **España** (fase 1, ADR-0072): el
  "IVA por defecto" a nivel de app. Otros países añaden su propio `<cc>.json` (columna humano:
  IVA-por-país más allá de ES está aplazado).

> **Wiring del seed (FLAG, columna humano):** el mecanismo per-hub que aplica estos datos con el
> `hub_id` correcto (install-hook del runtime vs. seed por país desde S3 ADR-0072) **no está
> cableado** en este cambio. Los datos están listos; falta el conector. En los tests E2E se
> siembra vía los comandos `taxes.categories.create` / `taxes.rules.create` (camino verificado).
