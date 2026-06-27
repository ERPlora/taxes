-- Alta de categoría fiscal (ADR-0085). Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- `key` es la clave canónica enlazable (única por hub — lo garantiza ix_tax_cat_hub_key).
-- is_system=0 para categorías creadas por el usuario; las canónicas del módulo se siembran con 1.
INSERT INTO taxes_category
  (id, hub_id, key, name, description, is_system, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :key, :name, COALESCE(:description, ''), COALESCE(:is_system, 0), 1,
   0, :current_user_id, :current_user_id, :now, :now);
