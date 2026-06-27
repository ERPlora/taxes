-- Taxes · esquema inicial (SQLite). Modelo ADR-0085 (supersede ADR-0066/0069-link).
-- El impuesto se enlaza por CATEGORÍA FISCAL (`tax_category_key`), no por un "tipo" país-
-- específico. El % vive en `taxes_rule` resuelto por (país+región+categoría+fecha). Los
-- componentes (multi-impuesto: IVA + Recargo de equivalencia) son filas hijas de una regla.
-- Contrato de fila estándar de hub (§2.5): hub_id + soft-delete + auditoría.

-- ── Catálogo canónico de categorías fiscales (ADR-0085) ───────────────────────
-- La CLAVE ENLAZABLE es `key` (string canónico estable, p. ej. 'restaurant.food'): producto/
-- servicio guardan `tax_category_key` con FK a esta tabla (NO string libre — mismo patrón que
-- country_code/currency_code/language). Se conserva un `id` surrogate por el contrato de fila
-- del hub (auditoría/soft-delete); la identidad enlazable es `key` (UNIQUE por hub).
-- Defaults canónicos del módulo (is_system=1, sembrados al instalar/seed por país):
--   restaurant.food, restaurant.drink, restaurant.alcohol, restaurant.delivery,
--   service.generic, product.generic — extensible por el hub (is_system=0).
CREATE TABLE IF NOT EXISTS taxes_category (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    key         TEXT NOT NULL,                 -- ADR-0085: clave canónica enlazable (FK target)
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_system   INTEGER NOT NULL DEFAULT 0,    -- 1 = canónica del módulo (no borrable por el usuario)
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
-- (hub_id, key) UNIQUE: es el target de las FK de inventory/services/taxes_rule/alias.
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_cat_hub_key    ON taxes_category (hub_id, key);
CREATE INDEX        IF NOT EXISTS ix_tax_cat_hub_active ON taxes_category (hub_id, is_active);
CREATE INDEX        IF NOT EXISTS idx_taxes_category_hub ON taxes_category (hub_id, is_deleted);

-- ── Regla de tipo: el % por jurisdicción + categoría (ADR-0085) ───────────────
-- El % se resuelve por (country_code, region_code, tax_category_key, fecha). Varios países
-- coexisten sin conflicto (la clave de búsqueda incluye el país). region_code es NULLABLE
-- (NULL = aplica a todo el país; un valor 'ES-CN'… afina por región).
-- COMPONENTES (ADR-0085, decisión humano 2026-06-27 — multi-impuesto sin `taxes_rate`):
--   Una regla raíz (parent_id NULL) es el tipo principal (p. ej. IVA 21). Sus COMPONENTES
--   adicionales (Recargo de equivalencia 5,2) son filas con parent_id = id_de_la_regla_raíz.
--   El handler resuelve la regla raíz por país+región+categoría+fecha y aplica la raíz + sus
--   componentes sobre la misma base; congela el desglose en la línea (snapshot ADR-0085).
--   `component_label` da nombre al componente ('IVA', 'Recargo de equivalencia') para el desglose.
CREATE TABLE IF NOT EXISTS taxes_rule (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    country_code     TEXT NOT NULL,
    region_code      TEXT,                          -- NULLABLE (ADR-0085): NULL = todo el país
    tax_category_key TEXT NOT NULL,                 -- FK → taxes_category(hub_id, key)
    rate_pct         REAL NOT NULL DEFAULT 0,       -- tasa % de ESTA regla/componente (no es dinero)
    tax_type         TEXT NOT NULL DEFAULT 'vat',   -- vat|surcharge|sales_tax|withholding|excise|import_duty
    parent_id        TEXT,                          -- NULLABLE auto-ref: componente de una regla raíz
    component_label  TEXT,                          -- nombre del componente ('IVA','Recargo de equivalencia')
    valid_from       TEXT,                          -- ISO YYYY-MM-DD o NULL (histórico abierto)
    valid_to         TEXT,                          -- ISO YYYY-MM-DD o NULL
    is_active        INTEGER NOT NULL DEFAULT 1,
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TEXT,
    created_by       TEXT,
    updated_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT,
    FOREIGN KEY (hub_id, tax_category_key) REFERENCES taxes_category (hub_id, key) ON DELETE RESTRICT,
    FOREIGN KEY (parent_id)                REFERENCES taxes_rule (id)               ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_tax_rule_lookup ON taxes_rule (hub_id, country_code, tax_category_key, region_code);
CREATE INDEX IF NOT EXISTS ix_tax_rule_parent ON taxes_rule (hub_id, parent_id);
CREATE INDEX IF NOT EXISTS ix_tax_rule_active ON taxes_rule (hub_id, is_active);
CREATE INDEX IF NOT EXISTS idx_taxes_rule_hub ON taxes_rule (hub_id, is_deleted);

-- ── Alias de categoría (ADR-0085): normaliza texto externo → key canónica ──────
-- El importador CSV resuelve cualquier representación externa ('prepared_food'/'food'/'pizza'/
-- 'meal' → 'restaurant.food') por esta capa antes de escribir la FK. `alias` se normaliza en
-- minúsculas/trim. `source`: 'shipped' (de fábrica) | 'learned' (aprendido en un import).
CREATE TABLE IF NOT EXISTS taxes_category_alias (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    alias            TEXT NOT NULL,                 -- texto externo normalizado (lower/trim)
    tax_category_key TEXT NOT NULL,                 -- FK → taxes_category(hub_id, key)
    source           TEXT NOT NULL DEFAULT 'learned', -- shipped|learned
    is_active        INTEGER NOT NULL DEFAULT 1,
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TEXT,
    created_by       TEXT,
    updated_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT,
    FOREIGN KEY (hub_id, tax_category_key) REFERENCES taxes_category (hub_id, key) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_alias_hub_alias ON taxes_category_alias (hub_id, alias);
CREATE INDEX        IF NOT EXISTS idx_taxes_alias_hub    ON taxes_category_alias (hub_id, is_deleted);
