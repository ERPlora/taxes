-- Inserción privada de regla de tipo (la usa el handler de seed/bulk). El handler aporta :id (de
-- context.new_ids); el runtime inyecta :hub_id, :current_user_id, :now.
INSERT INTO taxes_rule
  (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type,
   operation_class, exempt_reason, regime_key,
   parent_id, component_label, valid_from, valid_to, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:id, :hub_id, :country_code, :region_code, :tax_category_key, :rate_pct, COALESCE(:tax_type, 'vat'),
   COALESCE(:operation_class, 'subject'), :exempt_reason, :regime_key,
   :parent_id, :component_label, :valid_from, :valid_to, 1,
   0, :current_user_id, :current_user_id, :now, :now);
