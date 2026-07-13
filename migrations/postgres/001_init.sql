-- Taxes · esquema inicial (Postgres / Aurora cloud). Equivalente a
-- migrations/sqlite/001_init.sql — mismas tablas, índices, FK y contrato de fila del hub.
-- Modelo ADR-0085 (supersede ADR-0066/0069-link): enlace por `tax_category_key`, el % vive
-- en `taxes_rule (país+región+categoría+fecha)`, componentes multi-impuesto como filas hijas.
--
-- Tipos: subconjunto portable "ERPlora SQL" (ADR-0007):
--   * ids/refs → TEXT; flags 0/1 → INTEGER; importes → INTEGER céntimos; tasas % → REAL;
--   * FECHAS → TEXT ISO-8601 (NO TIMESTAMPTZ): comparación lexicográfica entre dialectos.

CREATE TABLE IF NOT EXISTS taxes_category (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    key         TEXT NOT NULL,                 -- ADR-0085: clave canónica enlazable (FK target)
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_system   INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
-- (hub_id, key) UNIQUE: target de las FK de inventory/services/taxes_rule/alias (composite FK
-- requiere índice UNIQUE en Postgres — debe ser UNIQUE CONSTRAINT/INDEX, lo es).
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_cat_hub_key    ON taxes_category (hub_id, key);
CREATE INDEX        IF NOT EXISTS ix_tax_cat_hub_active ON taxes_category (hub_id, is_active);
CREATE INDEX        IF NOT EXISTS idx_taxes_category_hub ON taxes_category (hub_id, is_deleted);

CREATE TABLE IF NOT EXISTS taxes_rule (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    country_code     TEXT NOT NULL,
    region_code      TEXT,                          -- NULLABLE (ADR-0085): NULL = todo el país
    tax_category_key TEXT NOT NULL,                 -- FK → taxes_category(hub_id, key)
    rate_pct         REAL NOT NULL DEFAULT 0,
    tax_type         TEXT NOT NULL DEFAULT 'vat',   -- vat|surcharge|sales_tax|withholding|excise|import_duty
    parent_id        TEXT,                          -- NULLABLE auto-ref: componente de una regla raíz
    component_label  TEXT,
    valid_from       TEXT,
    valid_to         TEXT,
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

CREATE TABLE IF NOT EXISTS taxes_category_alias (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    alias            TEXT NOT NULL,
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
