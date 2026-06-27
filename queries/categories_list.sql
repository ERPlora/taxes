-- Categorías fiscales canónicas/activas del hub (ADR-0085). Runtime inyecta :hub_id.
-- La identidad enlazable es `key`; `is_system`=1 marca las canónicas del módulo.
SELECT id, key, name, description, is_system, is_active
FROM taxes_category
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
