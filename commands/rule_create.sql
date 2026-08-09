-- Alta de una regla fiscal. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Una regla RAÍZ lleva :parent_id NULL; un COMPONENTE (recargo de equivalencia, p. ej.) cuelga de
-- su raíz por :parent_id.
--
-- EL INSERT ES CONDICIONAL (taxes#9). Antes metía el `:parent_id` que llegara, sin comprobar nada:
-- ni que el padre existiera, ni que fuera de este hub, ni que fuera una RAÍZ, ni que compartiera
-- jurisdicción y categoría con el hijo.
--
-- Y eso no es cosmético: la tasa combinada es la SUMA de los componentes de la raíz resuelta
-- (`rule_components`). Un componente colgado de una raíz de otra jurisdicción **suma sus puntos a un
-- impuesto que no es el suyo**, y esa tasa combinada es la que se cobra y la que se declara.
--
-- Es la otra mitad de hub#600: aquel cerró el lado de la LECTURA (el SDK ya no resuelve la regla de
-- otra región cuando no hay ninguna aplicable). Este cierra el de la ESCRITURA — construir a mano
-- una jerarquía incoherente.
--
-- Cuatro condiciones, y las tres primeras solo aplican si hay padre:
--   1. el padre existe, es de ESTE hub y está vivo;
--   2. el padre es una RAÍZ (`parent_id` vacío) — un componente de un componente sumaría dos veces
--      y anida una jerarquía que el resolutor no modela: solo mira un nivel;
--   3. comparte `country_code`, `region_code` y `tax_category_key` con él;
--   4. y, con o sin padre, la vigencia no puede ir hacia atrás.
--
-- Si algo de eso falla, el SELECT no devuelve fila y el INSERT afecta 0. El command declara
-- `expect_rows: {op: min, n: 1}`, así que eso NO es un éxito silencioso: revierte la transacción y
-- devuelve `taxes.rule_incoherent`.
INSERT INTO taxes_rule
  (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type,
   operation_class, exempt_reason, regime_key,
   parent_id, component_label, valid_from, valid_to, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id, :country_code, :region_code, :tax_category_key, :rate_pct, COALESCE(:tax_type, 'vat'),
  COALESCE(:operation_class, 'subject'), :exempt_reason, :regime_key,
  :parent_id, :component_label, :valid_from, :valid_to, 1,
  0, :current_user_id, :current_user_id, :now, :now
WHERE
  -- La vigencia, si viene entera, tiene que ir hacia delante. Las fechas son ISO, así que comparan
  -- como texto (ADR-0007 §1).
  (COALESCE(:valid_from, '') = '' OR COALESCE(:valid_to, '') = '' OR :valid_from <= :valid_to)
  AND (
    -- Raíz: no hay padre que comprobar. Es el caso normal.
    COALESCE(NULLIF(:parent_id, ''), '') = ''
    -- Componente: el padre manda, y tiene que ser coherente.
    OR EXISTS (
         SELECT 1 FROM taxes_rule p
         WHERE p.id = :parent_id
           AND p.hub_id = :hub_id
           AND p.is_deleted = 0
           AND COALESCE(NULLIF(p.parent_id, ''), '') = ''
           AND p.country_code = :country_code
           AND COALESCE(p.region_code, '') = COALESCE(:region_code, '')
           AND p.tax_category_key = :tax_category_key
       )
  );
