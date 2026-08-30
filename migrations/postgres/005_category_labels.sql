-- Taxes · the presentable name of a canonical category becomes DATA, so it can cross a module
-- boundary (taxes#38).
--
-- WHY IT CANNOT STAY IN THE WEB COMPONENT. taxes#30 translated the category name in presentation,
-- over the canonical key, inside `ui/lib/tax-category-name.ts`. That covered the three screens of
-- THIS module and nothing else — and the category is chosen mostly outside it: `inventory` (product
-- form, CSV importer) and `sales` (the "Departamento (IVA)" selector of the till, the cart line and
-- the PRINTED receipt) kept showing the seeded English name. The consumer cannot fix it either: a
-- module is its own repo and its own bundle, no module imports another's code (ADR-0043), and the
-- i18n catalogue does not travel — `t()` resolves against the JSON its own WC inlines. Copying the
-- key→label map into each consumer would leave N lists of the canonical keys in N repos, and the
-- next category added here would come out in English over there, silently.
--
-- So the label leaves through the only door that crosses a module boundary: the QUERY. And to be
-- projected by SQL it has to BE SQL. This table is that single list; `queries/categories_list.sql`,
-- `queries/category_get.sql` and `queries/rules_list.sql` join it.
--
-- WHAT THIS IS NOT. It is not per-hub business data: there is no `hub_id` and no audit columns on
-- purpose. It is module reference data — the same rows in every hub, owned by the module version,
-- never edited by a user (there is no command that writes here). Correcting a translation is a new
-- migration, exactly like correcting any other shipped constant. The categories the OWNER creates
-- have no row here and keep their own text: they are hers.
--
-- ADR-0055 is respected, not bent: the datum still NAMES itself in English (`taxes_category.name`
-- is untouched and still travels in the same row) and the translation is still presentation — only
-- resolved one layer earlier, by the module that owns the key, instead of by a catalogue that
-- cannot reach the caller.
--
-- The 10 canonical keys are the ones the seed plants (6) plus the ones `003_backfill_es_vat_
-- baseline.sql` adds (4). `tests/category-display-name.postgres.test.sh` fails if a canonical
-- category ever comes out untranslated, which is what keeps this list and the seed together.

CREATE TABLE IF NOT EXISTS taxes_category_label (
  key         TEXT NOT NULL,
  lang        TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (key, lang)
);

-- English is the SOURCE language (ADR-0055): it repeats the seeded `name` on purpose, so that a
-- hub in English resolves through the same join as any other and a missing translation degrades to
-- English instead of to nothing.
INSERT INTO taxes_category_label (key, lang, label, description) VALUES
  ('restaurant.food',       'en', 'Restaurant — food',       ''),
  ('restaurant.drink',      'en', 'Restaurant — drink',      ''),
  ('restaurant.alcohol',    'en', 'Restaurant — alcohol',    ''),
  ('restaurant.delivery',   'en', 'Restaurant — delivery',   ''),
  ('service.generic',       'en', 'Service — generic',       ''),
  ('service.health',        'en', 'Service — healthcare (VAT exempt)', 'Assistance provided by medical or health professionals — art. 20.Uno.3 (ES)'),
  ('service.education',     'en', 'Service — education (VAT exempt)',  'Regulated teaching and training — art. 20.Uno.9 (ES)'),
  ('product.generic',       'en', 'Product — generic',       ''),
  ('product.reduced',       'en', 'Product — reduced (food staples, pharmacy)',      ''),
  ('product.super_reduced', 'en', 'Product — super-reduced (bread, books, basics)',  ''),
  ('restaurant.food',       'es', 'Restauración — comida',   ''),
  ('restaurant.drink',      'es', 'Restauración — bebida',   ''),
  ('restaurant.alcohol',    'es', 'Restauración — alcohol',  ''),
  ('restaurant.delivery',   'es', 'Restauración — reparto a domicilio', ''),
  ('service.generic',       'es', 'Servicio — general',      ''),
  ('service.health',        'es', 'Servicio — sanitario (exento de IVA)',  'Asistencia prestada por profesionales médicos o sanitarios — art. 20.Uno.3 (ES)'),
  ('service.education',     'es', 'Servicio — enseñanza (exento de IVA)',  'Enseñanza y formación regladas — art. 20.Uno.9 (ES)'),
  ('product.generic',       'es', 'Producto — general',      ''),
  ('product.reduced',       'es', 'Producto — reducido (alimentos básicos, farmacia)',   ''),
  ('product.super_reduced', 'es', 'Producto — superreducido (pan, libros, básicos)',     '')
-- `DO NOTHING` y no un upsert: la tabla nace en esta misma migración, así que el conflicto solo
-- puede venir de re-aplicarla. Corregir una etiqueta será una migración nueva, como cualquier otra
-- constante que se envía. (Además, `DO UPDATE SET` hace que el validador del toolkit lea `set` como
-- una tabla ajena al módulo y rechace la migración — module-toolkit#72.)
ON CONFLICT (key, lang) DO NOTHING;
