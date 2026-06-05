-- Tipos fiscales activos de un país, con el code de su categoría. Runtime inyecta :hub_id.
-- Portado de TaxService.get_country_rates: la UI/SDK colapsa a {category_code: rate_pct}
-- (primer rate por categoría) y filtra por vigencia (is_valid_on) — ver WASM-TODO.
SELECT r.id, r.code, r.rate_pct, r.tax_type, r.applies_from, r.applies_until,
       c.code AS category_code, c.name AS category_name
FROM taxes_rate r
JOIN taxes_category c ON c.id = r.category_id AND c.is_deleted = 0
WHERE r.hub_id = :hub_id AND r.is_deleted = 0 AND r.is_active = 1
  AND r.country_code = :country_code
ORDER BY r.code ASC;
