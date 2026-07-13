-- Una categoría por su `key` (scope hub_id). La usa el importador para validar la FK antes de
-- escribir `tax_category_key` en producto/servicio (ADR-0085). Runtime inyecta :hub_id.
SELECT id, key, name, description, is_system, is_active
FROM taxes_category
WHERE hub_id = :hub_id AND key = :key AND is_deleted = 0
