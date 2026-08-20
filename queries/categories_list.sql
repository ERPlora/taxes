-- Categorías fiscales canónicas/activas del hub (ADR-0085). Runtime inyecta :hub_id y
-- :current_user_id.
--
-- La identidad enlazable es `key`; `is_system`=1 marca las canónicas del módulo.
--
-- `display_name`/`display_description` son el nombre PRESENTABLE, ya resuelto al idioma de quien
-- pregunta (taxes#38). Viajan aquí porque la categoría se elige sobre todo FUERA de este módulo
-- —`inventory`, `sales`— y ningún módulo puede importar el código ni el catálogo i18n de otro
-- (ADR-0043): la query es la única puerta que cruza el límite. El consumidor pinta `display_name`
-- y guarda `key`, que es lo que no cambia; `name` sigue viajando intacto para quien quiera el dato
-- crudo. Las etiquetas viven en UNA lista, `taxes_category_label` (migración 005), y una categoría
-- que creó el dueño no tiene fila allí: sale con su propio texto, que es suyo.
--
-- El idioma se resuelve como lo hace el shell (`apps/web/src/i18n/index.ts#bootHubLanguage`):
-- override personal (`hub_user_pref`) → idioma del hub (`hub_settings.language`) → inglés, que es
-- el idioma FUENTE (ADR-0055). Las dos tablas son del CORE, no de este módulo, y el runtime no
-- bincula ningún `:locale`, así que se leen aquí — igual que `setup_status.sql` lee el país.
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
WHERE c.hub_id = :hub_id AND c.is_deleted = 0 AND c.is_active = 1
