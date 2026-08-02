-- Alta de regla de tipo (ADR-0085): el % por (país+región+categoría+vigencia). Runtime inyecta
-- :new_id, :hub_id, :current_user_id, :now. Una regla RAÍZ lleva :parent_id NULL; un COMPONENTE
-- (recargo de equivalencia) lleva :parent_id = id de la regla raíz. La FK (hub_id,
-- tax_category_key) → taxes_category(hub_id, key) valida que la categoría exista.
INSERT INTO taxes_rule
  (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type,
   operation_class, exempt_reason, regime_key,
   parent_id, component_label, valid_from, valid_to, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :country_code, :region_code, :tax_category_key, :rate_pct, COALESCE(:tax_type, 'vat'),
   COALESCE(:operation_class, 'subject'), :exempt_reason, :regime_key,
   :parent_id, :component_label, :valid_from, :valid_to, 1,
   0, :current_user_id, :current_user_id, :now, :now);
