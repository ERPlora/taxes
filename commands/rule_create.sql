-- Alta de regla fiscal declarativa. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de TaxService.create_rule. :conditions es JSON serializado. La comprobación de
-- que tax_rate_id existe y está activa (invariant tax_rule.references_existing_active_rate)
-- va a runtime — ver WASM-TODO. code único por hub lo garantiza el índice.
INSERT INTO taxes_rule
  (id, hub_id, code, name, conditions, tax_rate_id, priority, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :code, :name, :conditions, :tax_rate_id, :priority, 1,
   0, :current_user_id, :current_user_id, :now, :now);
