-- Alta de categoría fiscal. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de TaxService.create_category (code único por hub — lo garantiza el índice).
INSERT INTO taxes_category
  (id, hub_id, code, name, description, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :code, :name, :description, 1,
   0, :current_user_id, :current_user_id, :now, :now);
