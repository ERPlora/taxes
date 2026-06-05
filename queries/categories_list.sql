-- Categorías fiscales activas del hub. Runtime inyecta :hub_id.
-- Portado de TaxService.list_categories (active_only por defecto, orden por code).
SELECT id, code, name, description, is_active
FROM taxes_category
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
ORDER BY code ASC;
