-- Desactivación lógica de una regla de tipo (NO borra: la saca de futuras resoluciones).
-- Una factura ya emitida conserva su snapshot (ADR-0085), así que esto no la altera.
UPDATE taxes_rule
SET is_active = 0,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :rule_id AND hub_id = :hub_id AND is_deleted = 0;
