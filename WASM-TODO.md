# taxes — handler Rust→WASM (Tier 2)

El CRUD de categorías, tipos (rates) y reglas está en SQL declarativo Tier 0
(`commands/*.sql`, `queries/*.sql`). El **motor de cálculo de impuestos**
(`calculate_tax`, command `taxes.calculate`) está **construido** en
`handler/src/lib.rs` → `dist/handler.wasm` (2026-06-11, issue taxes#1).

> Regla hub: el WASM **nunca toca la BD**. Recibe el payload + las filas que el runtime
> lea (vía queries declarativas) y devuelve *intenciones*/resultado que el host valida.

## `calculate_tax` (command `taxes.calculate`) — IMPLEMENTADO
Origen: `TaxService.calculate_tax`. Motor de resolución de tipo + cálculo.
- Entrada (payload): `{ amount, country_code, region_code?, category_id?|category_code?,
  tax_included?, date?, allow_missing_rate? }`.
- Filas candidatas (tipos y reglas): el guest las lee de
  `context.reads["taxes.rates.by_country"]` / `context.reads["taxes.rules.list"]`
  (punto de inyección futuro del host) con **fallback a `payload.rates` / `payload.rules`**
  (hoy las aporta el caller vía las queries públicas del módulo). El WASM NO hace SELECT.
- **Resolución del tipo aplicable** (precedencia): reglas `taxes_rule` activas por
  `priority` asc (primera cuyas `conditions` matcheen el payload y cuyo `tax_rate_id`
  resuelva a un tipo activo y vigente) → país+región+categoría → sin región+categoría →
  región sin categoría → fallback país (prefiere code `default`/`standard`). Solo tipos
  `is_active=1` y vigentes (`applies_from`/`applies_until` vs. `payload.date` o
  `context.now`). Sin match → error `no_rate`, o tipo 0% si `allow_missing_rate`.
- **Cálculo**: si `tax_included` → `base = amount / (1 + rate)`, `tax = total - base`;
  si no → `tax = amount * rate`. Redondeo **HALF_UP a 2 decimales** (paridad
  SQLite↔Postgres).
- Salida: `{ base, tax, total, rate_pct, rate_id, rate_code, tax_type, tax_included,
  source }` en el campo **`result`** del output del guest. Cálculo puro: `operations`
  y `events` vacíos.

## PENDIENTE (host / runtime — decisión humana, NO de este módulo)
El contrato host↔guest actual (`erplora-guest-sdk::Output`) solo transporta
`operations` + `events`; `execute_command` devuelve `{ok, operations}` al caller:

1. **Pre-carga de lecturas** (`context.reads`): el runtime debería ejecutar
   `taxes.rates.by_country` / `taxes.rules.list` por `hub_id` e inyectar las filas
   antes de invocar el guest. Hoy el caller debe pasar `payload.rates`/`payload.rules`.
2. **Canal de resultado**: el host ignora el campo extra `result` del guest
   (forward-compatible). Hasta que `Output` gane `result` y `execute_command` lo
   devuelva, el desglose no llega al caller vía `execute_command("taxes.calculate")`.

Build: `cd handler && cargo build --release --target wasm32-unknown-unknown --features guest`
y copiar `target/wasm32-unknown-unknown/release/taxes_handler.wasm` → `dist/handler.wasm`.
