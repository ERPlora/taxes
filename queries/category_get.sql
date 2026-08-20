-- Una categoría por su `key` (scope hub_id). La usa el importador para validar la FK antes de
-- escribir `tax_category_key` en producto/servicio (ADR-0085). Runtime inyecta :hub_id y
-- :current_user_id.
--
-- Devuelve el mismo `display_name`/`display_description` que `taxes.categories.list` (taxes#38):
-- quien valida la FK suele ser justo quien tiene que ENSEÑAR la categoría a continuación (el modal
-- del importador de `inventory`), y obligarle a una segunda llamada para el texto sería el mismo
-- problema con un paso más. Detalle del idioma y de la lista única de etiquetas: ver
-- `queries/categories_list.sql`.
WITH caller_lang AS (
    SELECT COALESCE(
        NULLIF((SELECT TRIM(p.language) FROM hub_user_pref p
                 WHERE p.hub_id = :hub_id AND p.user_id = CAST(:current_user_id AS TEXT)), ''),
        NULLIF((SELECT TRIM(s.value) FROM hub_settings s
                 WHERE s.hub_id = :hub_id AND s.key = 'language'), ''),
        'en') AS lang
)
SELECT c.id, c.key, c.name, c.description, c.is_system, c.is_active,
       COALESCE(NULLIF(l.label, ''), NULLIF(len.label, ''), c.name)                AS display_name,
       COALESCE(NULLIF(l.description, ''), NULLIF(len.description, ''), c.description) AS display_description
FROM taxes_category c
LEFT JOIN taxes_category_label l   ON l.key   = c.key AND l.lang   = (SELECT lang FROM caller_lang)
LEFT JOIN taxes_category_label len ON len.key = c.key AND len.lang = 'en'
WHERE c.hub_id = :hub_id AND c.key = :key AND c.is_deleted = 0
