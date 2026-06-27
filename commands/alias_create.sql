-- Persiste un alias de categoría (ADR-0085): texto externo (:alias normalizado lower/trim) → key
-- canónica. El importador lo llama cuando aprende un alias nuevo (source='learned') o al sembrar
-- los de fábrica (source='shipped'). El importador comprueba antes con taxes.aliases.resolve que
-- no exista (índice ix_tax_alias_hub_alias evita duplicados). Runtime inyecta :new_id, :hub_id…
INSERT INTO taxes_category_alias
  (id, hub_id, alias, tax_category_key, source, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :alias, :tax_category_key, COALESCE(:source, 'learned'), 1,
   0, :current_user_id, :current_user_id, :now, :now);
