-- Un tipo fiscal por id (scope hub_id). Portado de TaxService.get_rate.
SELECT id, code, name, category_id, country_code, region_code,
       rate_pct, tax_type, applies_from, applies_until, is_active
FROM taxes_rate
WHERE id = :rate_id AND hub_id = :hub_id AND is_deleted = 0;
