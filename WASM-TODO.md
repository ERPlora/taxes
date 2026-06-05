# taxes — lógica para handler Rust→WASM (Tier 2)

Fuente legacy: `old_modules/m_taxes/services.py` (`TaxService.calculate_tax`). El CRUD de
categorías, tipos (rates) y reglas ya está en SQL declarativo Tier 0 (`commands/*.sql`,
`queries/*.sql`). Lo que sigue es el **motor de cálculo de impuestos**, reutilizable desde
otros módulos (POS, facturas, compras), que no cabe en una sentencia SQL y debe convertirse
en handler WASM (`handler/src/lib.rs` → `dist/handler.wasm`).

> Regla hub-next: el WASM **nunca toca la BD**. Recibe el payload + las filas que el runtime
> lea (vía queries declarativas) y devuelve *intenciones*/resultado que el runtime valida.

## `calculate_tax`  (command `taxes.calculate`)
Origen: `TaxService.calculate_tax`. Motor de resolución de tipo + cálculo.
- Entrada (payload): `{ amount, country_code, region_code?, category_id?, tax_included? }`.
- El runtime aporta las filas candidatas leyendo las queries públicas del módulo
  (`taxes.rates.by_country` / `taxes.rules.list`) por `hub_id`; el WASM NO hace SELECT.
- **Resolución del tipo aplicable** (precedencia): coincidencia exacta
  `country_code` + `region_code` + `category_id` → luego sin región → luego sin categoría
  → fallback al tipo `default`/`standard` del país. Solo tipos `is_active=1` y vigentes
  (`applies_from`/`applies_until` vs. fecha del host). Si no hay match → tipo 0% o error
  `no_rate` según config.
- **Cálculo**: si `tax_included` → desglosar la base imponible del importe bruto
  (`base = amount / (1 + rate)`, `tax = amount - base`); si no → `tax = amount * rate`.
  Aritmética decimal de precisión fija con redondeo HALF_UP (paridad SQLite↔Postgres),
  cuantizado a 2 decimales (o los decimales de la divisa).
- Salida: `{ base, tax, total, rate_pct, rate_id, tax_type }`. Sin escritura: es un cálculo
  puro consumido por POS/invoice/purchase_orders vía el contrato `taxes.calculate`.
