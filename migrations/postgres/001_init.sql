-- Taxes · esquema inicial (Postgres / Aurora cloud). Equivalente a
-- migrations/sqlite/001_init.sql — mismas tablas, índices, FK y contrato de fila del
-- hub (§2.5): hub_id + soft-delete + auditoría. Generado por paridad mecánica.
--
-- Tipos: subconjunto portable "ERPlora SQL" (ADR-0007):
--   * ids/refs → TEXT (UUIDs del runtime como texto);
--   * flags 0/1 → INTEGER (los commands bindean 0/1; Postgres no castea entero→bool);
--   * importes → NUMERIC;
--   * FECHAS → TEXT ISO-8601 (NO TIMESTAMPTZ): el motor de sync (ADR-0031) compara
--     updated_at como string lexicográfico; timestamptz rompería el LWW entre dialectos.

CREATE TABLE IF NOT EXISTS taxes_category (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_cat_hub_code   ON taxes_category (hub_id, code);
CREATE INDEX        IF NOT EXISTS ix_tax_cat_hub_active ON taxes_category (hub_id, is_active);
CREATE INDEX        IF NOT EXISTS idx_taxes_category_hub ON taxes_category (hub_id, is_deleted);

-- Tipo fiscal concreto: % aplicable en un país/región para una categoría.
-- code es único por (hub, country_code). applies_from/applies_until permiten histórico.
CREATE TABLE IF NOT EXISTS taxes_rate (
    id            TEXT PRIMARY KEY,
    hub_id        TEXT NOT NULL,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    category_id   TEXT NOT NULL,
    country_code  TEXT NOT NULL,
    region_code   TEXT NOT NULL DEFAULT '',
    rate_pct      NUMERIC NOT NULL DEFAULT 0,
    tax_type      TEXT NOT NULL DEFAULT 'vat',   -- vat|sales_tax|withholding|excise|import_duty
    applies_from  TEXT,                          -- ISO YYYY-MM-DD o NULL
    applies_until TEXT,                          -- ISO YYYY-MM-DD o NULL
    is_active     INTEGER NOT NULL DEFAULT 1,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    deleted_at    TEXT,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    FOREIGN KEY (category_id) REFERENCES taxes_category (id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_rate_hub_country_code ON taxes_rate (hub_id, country_code, code);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_country      ON taxes_rate (hub_id, country_code);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_category     ON taxes_rate (hub_id, category_id);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_active       ON taxes_rate (hub_id, is_active);
CREATE INDEX        IF NOT EXISTS idx_taxes_rate_hub           ON taxes_rate (hub_id, is_deleted);

-- Regla declarativa: mapea un conjunto de condiciones (JSON) a una TaxRate concreta.
-- Se evalúan por priority ascendente (menor gana). conditions es JSON libre.
CREATE TABLE IF NOT EXISTS taxes_rule (
    id           TEXT PRIMARY KEY,
    hub_id       TEXT NOT NULL,
    code         TEXT NOT NULL,
    name         TEXT NOT NULL,
    conditions   TEXT NOT NULL DEFAULT '{}',     -- JSON con country_code/product_category/customer_segment...
    tax_rate_id  TEXT NOT NULL,
    priority     INTEGER NOT NULL DEFAULT 100,
    is_active    INTEGER NOT NULL DEFAULT 1,
    is_deleted   INTEGER NOT NULL DEFAULT 0,
    deleted_at   TEXT,
    created_by   TEXT,
    updated_by   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT,
    FOREIGN KEY (tax_rate_id) REFERENCES taxes_rate (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_rule_hub_code     ON taxes_rule (hub_id, code);
CREATE INDEX        IF NOT EXISTS ix_tax_rule_hub_priority ON taxes_rule (hub_id, priority);
CREATE INDEX        IF NOT EXISTS ix_tax_rule_hub_active   ON taxes_rule (hub_id, is_active);
CREATE INDEX        IF NOT EXISTS idx_taxes_rule_hub       ON taxes_rule (hub_id, is_deleted);