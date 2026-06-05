-- Alta de tipo fiscal. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de TaxService.create_rate. La validación de tax_type, vigencia y el invariant
-- fiscal (tax_class.rates_match_compliance) van a WASM/runtime — ver WASM-TODO.
-- (country_code, code) único por hub lo garantiza el índice ix_tax_rate_hub_country_code.
INSERT INTO taxes_rate
  (id, hub_id, code, name, category_id, country_code, region_code,
   rate_pct, tax_type, applies_from, applies_until, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :code, :name, :category_id, :country_code, :region_code,
   :rate_pct, :tax_type, :applies_from, :applies_until, 1,
   0, :current_user_id, :current_user_id, :now, :now);
