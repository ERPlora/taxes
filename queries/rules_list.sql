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
        -- The CORE's default for `language`, not the source language. See the note above (taxes#40).
        'es') AS lang
)
SELECT r.id, r.country_code, r.region_code, r.tax_category_key, r.rate_pct, r.tax_type,
       r.operation_class, r.exempt_reason, r.regime_key,
       r.parent_id, r.component_label, r.valid_from, r.valid_to, r.is_active,
       COALESCE(NULLIF(l.label, ''), NULLIF(len.label, ''), NULLIF(c.name, ''), r.tax_category_key)
           AS tax_category_display_name,
       -- `is_incoherent` (taxes#63): a rate on a rule that charges no tax — its own class is not
       -- `subject`, or it is a component hanging from a root whose class is not. taxes#62 refuses
       -- those on create, but rows saved BEFORE that guard still resolve in `sales`, the till charges
       -- them and the invoice refuses to seal the sale (`invoice.quota_on_non_subject_class`). The
       -- screen marks the row with it and `taxes.rules.repair` fixes it; it is never rewritten
       -- blindly. Same conditions as `commands/rule_create.sql` §5 and `commands/rule_repair.sql`.
       CASE WHEN r.rate_pct > 0
                 AND (r.operation_class <> 'subject' OR COALESCE(p.operation_class, 'subject') <> 'subject')
            THEN 1 ELSE 0 END AS is_incoherent
FROM taxes_rule r
-- The root a component hangs from (a root carries an empty `parent_id` and finds nothing). `id` is
-- the key, so the join cannot duplicate rows.
LEFT JOIN taxes_rule p ON p.id = r.parent_id AND p.hub_id = r.hub_id AND p.is_deleted = 0
LEFT JOIN taxes_category c ON c.hub_id = r.hub_id AND c.key = r.tax_category_key AND c.is_deleted = 0
LEFT JOIN taxes_category_label l   ON l.key   = r.tax_category_key AND l.lang   = (SELECT lang FROM caller_lang)
LEFT JOIN taxes_category_label len ON len.key = r.tax_category_key AND len.lang = 'en'
-- Alcance: por DEFECTO solo las activas — es lo que el keystone (ADR-0069) pre-carga y lo que
-- resuelve una venta, y ahí una regla desactivada no puede aparecer nunca.
--
-- `include_archived` amplía ese alcance para que la PANTALLA pueda enseñar las desactivadas y
-- devolverlas a la vida (taxes#52). Antes no había forma: se desactivaba con un toque, la fila
-- desaparecía y el único camino de vuelta era la base de datos. taxes#50 quitó el filtro de la
-- columna precisamente porque esta cola lo hacía imposible de cumplir; ahora se puede.
--
-- La forma `COALESCE(CAST(:x AS TEXT), '0') IN ('1','true')` es el ÚNICO idioma de bind OPCIONAL
-- que el runtime reconoce (hub#1086): quien no lo bindea —el keystone, `taxes.calculate`, el
-- handler— recibe exactamente las filas de ayer, sin enterarse de que el parámetro existe. Y tiene
-- que aparecer UNA sola vez y DENTRO del COALESCE: una segunda aparición fuera lo vuelve
-- obligatorio para TODOS los llamantes y rompe justo a los que no debían enterarse.
WHERE r.hub_id = :hub_id AND r.is_deleted = 0
  AND (r.is_active = 1 OR COALESCE(CAST(:include_archived AS TEXT), '0') IN ('1', 'true'))
