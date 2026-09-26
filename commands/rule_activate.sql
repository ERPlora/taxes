-- Devolver a la vida una regla de tipo desactivada (taxes#52): deshace exactamente lo que hizo
-- `commands/rule_deactivate.sql`, y nada más. El % , la jurisdicción, la categoría, la vigencia y
-- sus componentes siguen donde estaban, porque desactivar nunca los tocó.
--
-- Hace falta un command PROPIO: no hay ninguna otra puerta que ponga `is_active` a 1 —el alta
-- inserta un literal— así que sin esto una regla desactivada solo volvía por la base de datos.
--
-- `AND is_active = 0` es lo que hace honesto el `expect_rows` del manifest: reactivar algo que ya
-- estaba activo toca 0 filas y sale como `taxes.rule_not_deactivated`, nunca como un OK silencioso
-- sobre una fila que no se movió. Lo mismo para una regla de OTRO hub: el `hub_id` no casa.
--
-- It cannot collide on its natural key coming back: `ix_tax_rule_root_natural` (migration 004) is
-- UNIQUE over (hub_id, country_code, tax_category_key, region_code, valid_from) WITHOUT
-- `is_active`, so the deactivated rule never stopped occupying its natural key — reactivating it
-- does not create a duplicate that did not already exist.
--
-- It CAN still collide on OVERLAP, though (taxes#66): the natural key says nothing about another
-- ACTIVE root rule that already covers these dates under a DIFFERENT `valid_from`. That is what
-- the later `commands/_rule_overlap_assert.sql` statement of this same command refuses, with
-- `taxes.rule_overlaps`.
UPDATE taxes_rule
SET is_active = 1,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :rule_id AND hub_id = :hub_id AND is_deleted = 0 AND is_active = 0;
