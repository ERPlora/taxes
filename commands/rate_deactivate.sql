-- Desactivación lógica de un tipo fiscal (NO borra: solo lo saca de futuras selecciones).
-- Portado de TaxService.deactivate_rate. El invariant que comprueba que el país no se
-- quede sin un rate por categoría obligatoria va a runtime — ver WASM-TODO.
UPDATE taxes_rate
SET is_active = 0,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :rate_id AND hub_id = :hub_id AND is_deleted = 0;
