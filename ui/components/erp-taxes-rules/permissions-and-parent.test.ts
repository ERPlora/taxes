// taxes#11 — two contracts of the rules screen:
//
// 1. PERMISSIONS: the surface adapts to the effective permission (`erplora.hasPermission`, same
//    pattern as customers/inventory/invoice). A user with `taxes.view_tax` only (employee role in
//    module.json) gets a read-only table: no «+» in the bar, no row actions. Whoever has
//    `taxes.manage_tax` keeps everything. Without an SDK that exposes `hasPermission` (preview) the
//    screen stays permissive: the runtime still enforces the permission on every command.
//
// 2. PARENT RULE SELECTOR: a multi-tax component (e.g. equivalence surcharge) hangs from a ROOT rule.
//    Typing its UUID by hand was the door to incoherent links (taxes#9 closed the server side; this is
//    the client side). The parent is now CHOSEN from a select that only offers root rules of this hub
//    compatible with the row being created — same country, region and category, currently valid — so
//    the only options on screen are the ones the server would accept.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIES = [
  { id: 'c1', key: 'restaurant.food', name: 'Food' },
  { id: 'c2', key: 'standard', name: 'Standard VAT' },
];

const today = new Date().toISOString().slice(0, 10);

const RULES = [
  // Root, matching (ES / no region / restaurant.food), open validity → offered.
  { id: 'root-es-food', country_code: 'ES', region_code: '', tax_category_key: 'restaurant.food', rate_pct: '10.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
  // Root, matching but its validity ended yesterday → NOT offered.
  { id: 'root-es-food-old', country_code: 'ES', region_code: '', tax_category_key: 'restaurant.food', rate_pct: '8.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '2000-01-01', valid_to: '2001-01-01', is_active: 1 },
  // Root, other category → NOT offered.
  { id: 'root-es-std', country_code: 'ES', region_code: '', tax_category_key: 'standard', rate_pct: '21.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: today, is_active: 1 },
  // Root, other region (Canary Islands) → NOT offered.
  { id: 'root-es-cn-food', country_code: 'ES', region_code: 'CN', tax_category_key: 'restaurant.food', rate_pct: '7.00', tax_type: 'igic', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
  // Component (already hangs from a root): a component of a component is not allowed → NOT offered.
  { id: 'comp-es-food', country_code: 'ES', region_code: '', tax_category_key: 'restaurant.food', rate_pct: '1.40', tax_type: 'surcharge', parent_id: 'root-es-food', component_label: 'Surcharge', valid_from: '', valid_to: '', is_active: 1 },
];

const commands: { name: string; payload: Record<string, unknown> }[] = [];
let permitted = true;

beforeEach(() => {
  commands.length = 0;
  permitted = true;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => {
      if (name === 'taxes.categories.list') return CATEGORIES;
      if (name === 'taxes.rules.list') return RULES;
      return [];
    },
    queryPage: async () => ({ rows: [RULES[0]], total: 1 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    hasPermission: () => permitted,
    locale: 'en',
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

type Table = HTMLElement & { addable: boolean; actions: unknown[] };
const table = (el: HTMLElement & { shadowRoot: ShadowRoot }) => el.shadowRoot.querySelector('ok-data-table') as Table | null;

describe('the surface follows the effective permission (taxes#11)', () => {
  it('with taxes.manage_tax the «+» and the deactivate action are there', async () => {
    const el = await mount();
    expect(table(el)?.addable).toBe(true);
    expect(table(el)?.actions.length).toBeGreaterThan(0);
  });

  it('with view-only permission the table is read-only: no «+», no row actions', async () => {
    permitted = false;
    const el = await mount();
    expect(table(el)?.addable, 'a viewer still sees the «+» to create rules').toBe(false);
    expect(table(el)?.actions, 'a viewer still gets the deactivate action').toEqual([]);
  });

  it('a viewer cannot deactivate even if the action event is forged', async () => {
    permitted = false;
    const el = await mount();
    table(el)!.dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'deactivate', row: RULES[0] } }));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const alert = el.shadowRoot.querySelector('ion-alert') as HTMLElement & { isOpen: boolean };
    expect(alert.isOpen).toBe(false);
  });

  it('a viewer gets an accessible reason for the read-only surface', async () => {
    permitted = false;
    const el = await mount();
    const hint = el.shadowRoot.querySelector('ok-inline-feedback[tone="info"]');
    expect(hint?.textContent).toContain('ui.readOnlyHint');
  });

  it('without hasPermission in the SDK (preview) the screen stays permissive', async () => {
    delete (globalThis as Record<string, any>).erplora.hasPermission;
    const el = await mount();
    expect(table(el)?.addable).toBe(true);
  });
});

describe('the parent rule is CHOSEN among compatible root rules, not typed (taxes#11)', () => {
  type Wc = HTMLElement & { newCountry: string; newRegion: string; newCategoryKey: string; parentCandidates: { id: string }[]; updateComplete: Promise<unknown> };

  it('there is no free-text input for the parent rule id anymore', async () => {
    const el = await mount();
    const free = el.shadowRoot.querySelector('form[slot="create"] ion-input[label="ui.colParentId"]');
    expect(free, 'the parent rule is still a free-text id').toBeNull();
    const select = el.shadowRoot.querySelector('form[slot="create"] ion-select[label="ui.colParentRule"]');
    expect(select, 'no select for the parent rule').toBeTruthy();
  });

  it('offers no candidates until country and category are chosen', async () => {
    const el = (await mount()) as unknown as Wc;
    expect(el.parentCandidates).toEqual([]);
  });

  it('offers only ROOT rules of the same country/region/category that are valid today', async () => {
    const el = (await mount()) as unknown as Wc;
    el.newCountry = 'es';
    el.newCategoryKey = 'restaurant.food';
    await el.updateComplete;
    expect(el.parentCandidates.map((r) => r.id)).toEqual(['root-es-food']);

    el.newRegion = 'CN';
    await el.updateComplete;
    expect(el.parentCandidates.map((r) => r.id)).toEqual(['root-es-cn-food']);
  });

  it('the select paints exactly those candidates as options', async () => {
    const el = (await mount()) as unknown as Wc & { shadowRoot: ShadowRoot };
    el.newCountry = 'ES';
    el.newCategoryKey = 'restaurant.food';
    await el.updateComplete;
    const options = [...el.shadowRoot.querySelectorAll('form[slot="create"] ion-select[label="ui.colParentRule"] ion-select-option')] as (HTMLElement & { value: string })[];
    // First option = «none» (this is a root rule), so a picked parent can be un-picked.
    expect(options.map((o) => o.value)).toEqual(['', 'root-es-food']);
  });

  it('a chosen parent travels as parent_id in taxes.rules.create', async () => {
    const el = (await mount()) as unknown as Wc & { newRatePct: string; newParentId: string; newComponentLabel: string; createRule: (ev: Event) => Promise<void> };
    el.newCountry = 'ES';
    el.newCategoryKey = 'restaurant.food';
    el.newRatePct = '1.4';
    el.newParentId = 'root-es-food';
    el.newComponentLabel = 'Surcharge';
    await el.createRule(new Event('submit'));
    const created = commands.find((c) => c.name === 'taxes.rules.create');
    expect(created?.payload).toMatchObject({ parent_id: 'root-es-food', component_label: 'Surcharge' });
  });
});
