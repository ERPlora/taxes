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
-- The language is resolved the way the shell does (`apps/web/src/i18n/index.ts#bootHubLanguage`):
-- personal override (`hub_user_pref`) → the hub's language (`hub_settings.language`) → `es`. Both
-- tables belong to the CORE, not to this module, and the runtime binds no `:locale`, so they are
-- read here — the same way `setup_status.sql` reads the country.
--
-- WHY THE LAST STEP IS `es` AND NOT `en` (taxes#40). `language` is a core setting WITH A DEFAULT,
-- and that default is `es` (`hub/crates/runtime/src/settings.rs`). The settings layer applies it
-- when READING: no row exists in `hub_settings` until somebody saves a language explicitly, so a
-- hub that was just provisioned has none. Ending in `en` made this query the only voice in the
-- product answering English for that hub — Settings → General reads «Idioma del negocio: Español»,
-- `GET /api/hub/context` answers `"language":"es"`, and the shell falls back to `es` as well. The
-- result was a Spanish hub with an English fiscal catalogue: here, and through this very column, in
-- `inventory` and `sales` too. It reproduced in EVERY new hub and in none of the old ones, which is
-- why it got past taxes#38 — anybody who had ever saved the language had the row.
--
-- ADR-0055 is not bent. `en` is still the SOURCE language and still the fallback for a MISSING
-- TRANSLATION — that is the `len` join below, and it is untouched. What ends in `es` is the answer
-- to a different question, «what language is this hub in?», and that one belongs to the core.
--
-- This literal duplicates a core constant, and that is the part that can rot: the day the core
-- changes its default, this line lies again — which is precisely how we got here. The durable fix
-- is the runtime binding the effective language as a system parameter (`:caller_lang`, next to
-- `:business_tax_id` — ADR-0061), resolved by the same layer that already applies the default:
-- ERPlora/hub#1098. Until that lands, agreeing with the core beats disagreeing with it.
WITH caller_lang AS (
    SELECT COALESCE(
        NULLIF((SELECT TRIM(p.language) FROM hub_user_pref p
                 WHERE p.hub_id = :hub_id AND p.user_id = CAST(:current_user_id AS TEXT)), ''),
        NULLIF((SELECT TRIM(s.value) FROM hub_settings s
                 WHERE s.hub_id = :hub_id AND s.key = 'language'), ''),
        -- The CORE's default for `language`, not the source language. See the note above (taxes#40).
        'es') AS lang
)
SELECT c.id, c.key, c.name, c.description, c.is_system, c.is_active,
       COALESCE(NULLIF(l.label, ''), NULLIF(len.label, ''), c.name)                AS display_name,
       COALESCE(NULLIF(l.description, ''), NULLIF(len.description, ''), c.description) AS display_description
FROM taxes_category c
LEFT JOIN taxes_category_label l   ON l.key   = c.key AND l.lang   = (SELECT lang FROM caller_lang)
LEFT JOIN taxes_category_label len ON len.key = c.key AND len.lang = 'en'
WHERE c.hub_id = :hub_id AND c.is_deleted = 0 AND c.is_active = 1
