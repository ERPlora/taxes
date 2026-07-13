-- Resuelve un texto externo normalizado (:alias en minúsculas/trim) → key canónica de categoría
-- (ADR-0085). Vacío = alias desconocido (el importador pregunta y persiste). Runtime inyecta :hub_id.
SELECT tax_category_key
FROM taxes_category_alias
WHERE hub_id = :hub_id AND alias = :alias AND is_deleted = 0 AND is_active = 1
LIMIT 1
