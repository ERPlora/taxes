// The jurisdiction is FILTERED the way it is created: chosen, not typed (taxes#48).
//
// taxes#41/#46 closed the domain of `country_code` — `schemas/rule_create.json` carries the 249
// ISO 3166-1 alpha-2 codes as an `enum`, and the create form picks from them. The filter box of the
// same column stayed a free-text input, which is the last place the old habit survives: a box that
// invites `es`, `esp`, `Spain` and answers all three with an empty table and no explanation.
//
// WHY THE OPTIONS ARE NOT THE 249. `ok-data-table` paints `filterType: 'select'` as an `ion-select`
// with no search box (`outfitkit/src/components/ok-data-table/ok-data-table.ts`, `renderFilterControl`).
// Handing it the whole enum would rebuild exactly the control this module already rejected one
// element away, in the create form: «Combo y no ion-select porque son 249». And a filter is not a
// create form — its job is to narrow what is on the table, so 247 of those 249 could only ever
// answer with an empty list. The options are therefore the countries the hub HAS rules for, which
// is what the column next to it already does (`tax_category_key` → `this.categories`) and what
// `ok-data-table` itself does when a select column brings none (`distinctValues` over the rows).
//
// `region_code` is NOT the same case and deliberately stays a text box — see the last block.
import { beforeEach, describe, expect, it } from 'vitest';
import { countryOptions } from '../../lib/countries';

const CATEGORIES = [{ id: 'c1', key: 'restaurant.food', name: 'Comida' }];

/** A rule per country, so «what the hub has» is not «what ISO has». */
const RULES = [
  { id: 'r1', country_code: 'ES', region_code: '', tax_category_key: 'restaurant.food', rate_pct: '10.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
  { id: 'r2', country_code: 'PT', region_code: '', tax_category_key: 'restaurant.food', rate_pct: '23.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
  { id: 'r3', country_code: 'ES', region_code: 'ES-CN', tax_category_key: 'restaurant.food', rate_pct: '7.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
];

/** What `queryAll('taxes.rules.list')` answers — swapped per test. */
let allRules: Record<string, unknown>[] = RULES;
/** What the visible page carries — swapped per test. */
let pageRows: Record<string, unknown>[] = RULES;

beforeEach(() => {
  allRules = RULES;
  pageRows = RULES;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : allRules),
    queryPage: async () => ({ rows: pageRows, total: pageRows.length }),
    command: async () => ({}),
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function mount() {
  await import('./erp-taxes-rules');
  const el = document.createElement('erp-taxes-rules');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Col = { key: string; filterable?: boolean; filterType?: string; options?: { value: string; label: string }[] };
const column = (el: HTMLElement, key: string): Col | undefined =>
  (el as unknown as { columns: Col[] }).columns.find((c) => c.key === key);

describe('the country column is filtered by CHOOSING (taxes#48)', () => {
  it('paints a select, not a free-text box', async () => {
    const el = await mount();
    expect(
      column(el, 'country_code')?.filterType,
      'the domain of `country_code` is a closed list since taxes#41: a text box invites a fragment the server can only answer with an empty table',
    ).toBe('select');
  });

  it('offers the countries the hub HAS rules for, and only those', async () => {
    const el = await mount();
    const values = (column(el, 'country_code')?.options ?? []).map((o) => o.value);
    expect(values.sort()).toEqual(['ES', 'PT']);
  });

  it('does not offer a country with no rules — it could only empty the table', async () => {
    const el = await mount();
    const values = (column(el, 'country_code')?.options ?? []).map((o) => o.value);
    // The positive control of the one above: `FR` is a perfectly valid ISO code and IS in the enum
    // the create form offers, so a build that hands the filter the whole enum passes the test
    // before this one and fails here.
    expect(values, 'the filter is offering countries the hub has no rule for').not.toContain('FR');
    expect(values.length, 'the whole ISO enum in a searchless `ion-select` is the scroll taxes#41 refused').toBeLessThan(10);
  });

  it('names them the way the create picker names them (name + code, reader’s language)', async () => {
    const el = await mount();
    const options = column(el, 'country_code')?.options ?? [];
    const fromPicker = new Map(countryOptions('es').map((o) => [o.value, o.label]));
    expect(options.map((o) => o.label)).toEqual(options.map((o) => fromPicker.get(o.value)));
    // Not a tautology over an empty list: the labels are real names, not bare codes.
    expect(options.find((o) => o.value === 'ES')?.label).toMatch(/\(ES\)$/);
  });

  it('keeps a legacy country the enum no longer admits, so its rules stay reachable', async () => {
    // `ZZ` is what taxes#41 found in the wild: ISO leaves it unassigned, the schema now refuses it,
    // but rows created before that fix still exist and still show in this table. Dropping it from
    // the options would leave a visible rule that cannot be filtered for.
    allRules = [...RULES, { ...RULES[0], id: 'r9', country_code: 'ZZ' }];
    pageRows = allRules;
    const el = await mount();
    const options = column(el, 'country_code')?.options ?? [];
    expect(options.map((o) => o.value)).toContain('ZZ');
    expect(options.find((o) => o.value === 'ZZ')?.label, 'an unnamed code is shown as the code').toBe('ZZ');
  });

  it('falls back to the visible page when the full list of rules could not be loaded', async () => {
    // `loadAllRules` is best-effort (it feeds the parent picker and swallows its errors). Without
    // this the filter would be an empty dropdown sitting on top of a table full of rows.
    allRules = [];
    const el = await mount();
    const values = (column(el, 'country_code')?.options ?? []).map((o) => o.value);
    expect(values.sort()).toEqual(['ES', 'PT']);
  });

  it('offers no options when the hub has no rules at all', async () => {
    allRules = [];
    pageRows = [];
    const el = await mount();
    expect(column(el, 'country_code')?.options).toEqual([]);
  });
});

describe('the region column stays a text box, and that is a decision (taxes#48)', () => {
  it('is filtered by typing a fragment', async () => {
    const el = await mount();
    // `schemas/rule_create.json` gives `region_code` a `pattern`, not an `enum`: ISO 3166-2 is a
    // SHAPE here, not a closed list, and there is no platform source for the subdivisions the way
    // `Intl.DisplayNames` names the countries. On top of that a select cannot express «no region»
    // — `ok-data-table` reads the empty value as «clear the filter» — and no region is the normal
    // case (`region_code` null = the whole country). So the honest box is the one that takes a
    // fragment, and `module.json` keeps `op: like` for it.
    expect(column(el, 'region_code')?.filterType).toBe('text');
  });

  it('is still filterable — the decision is the control, not dropping the box', async () => {
    const el = await mount();
    expect(column(el, 'region_code')?.filterable).toBe(true);
  });
});
