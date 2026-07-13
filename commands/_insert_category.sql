-- Inserción privada de categoría (la usa el handler de seed/bulk). El handler aporta :id (de
-- context.new_ids); el runtime inyecta :hub_id, :current_user_id, :now. Mismas columnas que
-- category_create.sql.
INSERT INTO taxes_category
  (id, hub_id, key, name, description, is_system, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:id, :hub_id, :key, :name, COALESCE(:description, ''), COALESCE(:is_system, 0), 1,
   0, :current_user_id, :current_user_id, :now, :now);
