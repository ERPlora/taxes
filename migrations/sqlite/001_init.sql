-- Taxes · esquema inicial (SQLite). Portado fielmente de modules/m_taxes/models.py.
-- Modelos: TaxCategory (agrupación semántica), TaxRate (% por país/región/categoría con
-- vigencia por fechas) y TaxRule (override declarativo que apunta a una TaxRate concreta).
-- Contrato de fila estándar de hub (§2.5): hub_id + soft-delete + auditoría.

-- Categoría fiscal: agrupación semántica de tipos (p.ej. "IVA reducido", "Exento").
-- code es único por hub y es el identificador estable referenciado por otros módulos.
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
-- ADR-0066: la entidad enlazable del IVA es taxes_rate (el "tipo"); category_id es OPCIONAL
-- (nullable) — agrupación reservada al mapeo multi-país (ADR-0061/0062). La FK solo se
-- aplica cuando category_id no es NULL.
-- ADR-0069 (multi-impuesto, tipos "grupo"): tax_type admite además el valor 'group' (no hay
-- constraint: la columna es TEXT libre). Un GRUPO ("IVA 21 + Recargo de equivalencia 5,2") es
-- una fila con tax_type='group'; sus COMPONENTES son filas con parent_id = id_del_grupo. El
-- producto/servicio sigue guardando UN tax_rate_id (que puede apuntar al grupo); el handler
-- calculate_tax expande el grupo a sus componentes. parent_id es nullable (auto-referencia a
-- taxes_rate.id) y solo lo usan los componentes; FK ON DELETE CASCADE (borrar el grupo borra
-- sus componentes).
CREATE TABLE IF NOT EXISTS taxes_rate (
    id            TEXT PRIMARY KEY,
    hub_id        TEXT NOT NULL,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    category_id   TEXT,                          -- ADR-0066: opcional (nullable)
    parent_id     TEXT,                          -- ADR-0069: grupo padre (nullable, auto-ref); solo en componentes
    country_code  TEXT NOT NULL,
    region_code   TEXT NOT NULL DEFAULT '',
    rate_pct      REAL NOT NULL DEFAULT 0,    -- tasa % (no es dinero)
    tax_type      TEXT NOT NULL DEFAULT 'vat',   -- vat|sales_tax|withholding|excise|import_duty|group (ADR-0069)
    applies_from  TEXT,                          -- ISO YYYY-MM-DD o NULL
    applies_until TEXT,                          -- ISO YYYY-MM-DD o NULL
    is_active     INTEGER NOT NULL DEFAULT 1,
    is_deleted    INTEGER NOT NULL DEFAULT 0,
    deleted_at    TEXT,
    created_by    TEXT,
    updated_by    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    FOREIGN KEY (category_id) REFERENCES taxes_category (id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_id)   REFERENCES taxes_rate (id)     ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_rate_hub_country_code ON taxes_rate (hub_id, country_code, code);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_country      ON taxes_rate (hub_id, country_code);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_category     ON taxes_rate (hub_id, category_id);
CREATE INDEX        IF NOT EXISTS ix_tax_rate_hub_parent       ON taxes_rate (hub_id, parent_id);
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
