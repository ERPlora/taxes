-- Reglas de tipo de un país (con sus componentes). Runtime inyecta :hub_id.
SELECT id, country_code, region_code, tax_category_key, rate_pct, tax_type,
       parent_id, component_label, valid_from, valid_to, is_active
FROM taxes_rule
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
  AND country_code = :country_code
ORDER BY tax_category_key ASC
