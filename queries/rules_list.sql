-- TODAS las reglas de tipo activas del hub, INCLUIDOS los componentes (parent_id != NULL).
-- Es la lectura que el keystone (ADR-0069) pre-carga para `sales.complete_sale`/`taxes.calculate`:
-- el handler resuelve la regla raíz por país+región+categoría+fecha y expande sus componentes.
-- Runtime inyecta :hub_id y :current_user_id.
--
-- `tax_category_display_name` es el nombre PRESENTABLE de la categoría de la regla, ya resuelto al
-- idioma de quien pregunta (taxes#38). Va aquí porque hay consumidores que solo leen reglas —
-- `inventory` enseña «Producto — general · 21 %» para que la opción sea decidible— y pedirles una
-- segunda query solo para el texto es lo que empuja a copiarse el mapa de etiquetas, que es
-- justamente lo que no puede pasar: sería una lista de las claves canónicas por repo. Detalle del
-- idioma y de la lista única de etiquetas: ver `queries/categories_list.sql`.
--
-- Aditivo: las columnas que ya viajaban siguen igual y en el mismo orden, y el join no puede
-- duplicar filas (`taxes_category_label` tiene PK `(key, lang)`), así que el handler que consume
-- esta lectura no se entera.
WITH caller_lang AS (
    SELECT COALESCE(
        NULLIF((SELECT TRIM(p.language) FROM hub_user_pref p
                 WHERE p.hub_id = :hub_id AND p.user_id = CAST(:current_user_id AS TEXT)), ''),
        NULLIF((SELECT TRIM(s.value) FROM hub_settings s
                 WHERE s.hub_id = :hub_id AND s.key = 'language'), ''),
        'en') AS lang
)
SELECT r.id, r.country_code, r.region_code, r.tax_category_key, r.rate_pct, r.tax_type,
       r.operation_class, r.exempt_reason, r.regime_key,
       r.parent_id, r.component_label, r.valid_from, r.valid_to, r.is_active,
       COALESCE(NULLIF(l.label, ''), NULLIF(len.label, ''), NULLIF(c.name, ''), r.tax_category_key)
           AS tax_category_display_name
FROM taxes_rule r
LEFT JOIN taxes_category c ON c.hub_id = r.hub_id AND c.key = r.tax_category_key AND c.is_deleted = 0
LEFT JOIN taxes_category_label l   ON l.key   = r.tax_category_key AND l.lang   = (SELECT lang FROM caller_lang)
LEFT JOIN taxes_category_label len ON len.key = r.tax_category_key AND len.lang = 'en'
WHERE r.hub_id = :hub_id AND r.is_deleted = 0 AND r.is_active = 1
