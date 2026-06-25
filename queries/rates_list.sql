-- Tipos fiscales activos del hub (con filtros opcionales). Runtime inyecta :hub_id.
-- Portado de TaxService.list_rates. El filtro as_of_date (vigencia por fechas) y los
-- filtros opcionales por país/categoría los aplica el SDK/UI; aquí devolvemos los activos.
-- (Los binds :country_code y :category_id deben pasarse: '' = sin filtro.)
SELECT id, code, name, category_id, parent_id, country_code, region_code,
       rate_pct, tax_type, applies_from, applies_until, is_active
FROM taxes_rate
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
