-- Inserción privada de un tipo fiscal (taxes_rate), usada por el handler WASM batch
-- `bulk_create_rates` (ADR-0066). El handler aporta :id (de context.new_ids) y los campos
-- del tipo; el runtime inyecta :hub_id, :current_user_id, :now (no falsificables). Mismas
-- columnas que commands/rate_create.sql. category_id es OPCIONAL (ADR-0066): si el handler
-- no lo aporta, se bindea NULL (la FK → taxes_category solo aplica cuando no es NULL).
-- (country_code, code) único por hub lo garantiza el índice ix_tax_rate_hub_country_code.
INSERT INTO taxes_rate
  (id, hub_id, code, name, category_id, country_code, region_code,
   rate_pct, tax_type, applies_from, applies_until, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:id, :hub_id, :code, COALESCE(:name, ''), :category_id, :country_code, COALESCE(:region_code, ''),
   :rate_pct, COALESCE(:tax_type, 'vat'), :applies_from, :applies_until, 1,
   0, :current_user_id, :current_user_id, :now, :now);
