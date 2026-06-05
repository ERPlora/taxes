-- Reglas fiscales declarativas activas, ordenadas por prioridad asc (menor gana).
-- Portado de TaxService.list_rules.
SELECT id, code, name, conditions, tax_rate_id, priority, is_active
FROM taxes_rule
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
ORDER BY priority ASC;
