// taxes#22 — the fiscal QUALIFICATION of a rule (ADR-0186) is editable from the screen.
//
// `taxes.rules.create` accepts `operation_class` / `exempt_reason` / `regime_key` and the `igic` /
// `ipsi` tax types since v2.2.0, but the browser could not send them: a business with its own
// exemptions (medical, education…) or a Canary Islands / Ceuta / Melilla hub could not serve itself.
// Market pattern (Odoo l10n_es «exempt reason» on the tax, Business Central VAT clause per posting
// setup, Holded «tipo de IVA: exento» + motivo): a select for the class, the reason only when it is
// exempt, an optional regime, and the class visible in the list.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIES = [{ id: 'c1', key: 'health.treatment', name: 'Medical treatment' }];

const RULE = {
  id: 'r1',
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'health.treatment',
  rate_pct: '0.00',
  tax_type: 'vat',
  operation_class: 'exempt',
  exempt_reason: 'E1',
  regime_key: '',
  parent_id: '',
  component_label: '',
  valid_from: '',
  valid_to: '',
  is_active: 1,
};

const commands: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  commands.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : name === 'taxes.rules.list' ? [RULE] : []),
    queryPage: async () => ({ rows: [RULE], total: 1 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'en',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  newCountry: string;
  newCategoryKey: string;
  newRatePct: string;
  newTaxType: string;
  newOperationClass: string;
  newExemptReason: string;
  newRegimeKey: string;
  createRule: (ev: Event) => Promise<void>;
  columns: { key: string; filterType?: string; options?: { value: string }[]; format?: (r: Record<string, unknown>) => string }[];
};

async function mount(): Promise<Wc> {
  await import('./erp-taxes-rules');
  const el = document.createElement('erp-taxes-rules') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const form = (el: Wc) => el.shadowRoot.querySelector('form[slot="create"]')!;

describe('the create panel exposes the fiscal qualification (taxes#22)', () => {
  it('offers igic and ipsi as tax types (a Canary Islands hub does not charge VAT)', async () => {
    const el = await mount();
    const values = [...form(el).querySelectorAll('ion-select[label="ui.colType"] ion-select-option')].map((o) => (o as HTMLElement & { value: string }).value);
    expect(values).toContain('igic');
    expect(values).toContain('ipsi');
  });

  it('has a select for the operation class with the five ADR-0186 values, default subject', async () => {
    const el = await mount();
    const select = form(el).querySelector('ion-select[label="ui.colOperationClass"]') as (HTMLElement & { value: string }) | null;
    expect(select, 'no operation class select').toBeTruthy();
    const values = [...select!.querySelectorAll('ion-select-option')].map((o) => (o as HTMLElement & { value: string }).value);
    expect(values).toEqual(['subject', 'subject_reverse', 'exempt', 'not_subject', 'not_subject_location']);
    expect(el.newOperationClass).toBe('subject');
  });

  it('the exemption reason only shows up when the class is exempt', async () => {
    const el = await mount();
    expect(form(el).querySelector('ion-input[label="ui.colExemptReason"]')).toBeNull();
    el.newOperationClass = 'exempt';
    await el.updateComplete;
    expect(form(el).querySelector('ion-input[label="ui.colExemptReason"]'), 'no reason field for an exempt rule').toBeTruthy();
  });

  it('a subject rule with no regime sends the same payload as before (defaults stay implicit)', async () => {
    const el = await mount();
    el.newCountry = 'ES';
    el.newCategoryKey = 'health.treatment';
    el.newRatePct = '21';
    await el.createRule(new Event('submit'));
    expect(commands[0].payload).toEqual({ country_code: 'ES', tax_category_key: 'health.treatment', rate_pct: 21, tax_type: 'vat' });
  });

  it('an exempt rule sends operation_class + exempt_reason (+ regime_key when given)', async () => {
    const el = await mount();
    el.newCountry = 'ES';
    el.newCategoryKey = 'health.treatment';
    el.newRatePct = '0';
    el.newOperationClass = 'exempt';
    el.newExemptReason = 'e1';
    el.newRegimeKey = '01';
    await el.createRule(new Event('submit'));
    expect(commands[0].payload).toEqual({
      country_code: 'ES',
      tax_category_key: 'health.treatment',
      rate_pct: 0,
      tax_type: 'vat',
      operation_class: 'exempt',
      exempt_reason: 'E1', // opaque jurisdiction code, normalised upper-case like the country
      regime_key: '01',
    });
  });

  it('a non-exempt class never leaks a stale exempt_reason', async () => {
    const el = await mount();
    el.newCountry = 'ES';
    el.newCategoryKey = 'health.treatment';
    el.newRatePct = '21';
    el.newOperationClass = 'subject_reverse';
    el.newExemptReason = 'E1'; // typed while it was exempt, then the class changed
    await el.createRule(new Event('submit'));
    // rate_pct 0, not the 21 typed: a reverse-charge rule carries no quota (taxes#59).
    expect(commands[0].payload).toEqual({ country_code: 'ES', tax_category_key: 'health.treatment', rate_pct: 0, tax_type: 'vat', operation_class: 'subject_reverse' });
  });
});

describe('the list shows the qualification (taxes#22)', () => {
  it('has an operation_class column, filterable by select (module.json declares op eq)', async () => {
    const el = await mount();
    const col = el.columns.find((c) => c.key === 'operation_class');
    expect(col, 'no operation class column').toBeTruthy();
    expect(col?.filterType).toBe('select');
    expect(col?.options?.map((o) => o.value)).toEqual(['subject', 'subject_reverse', 'exempt', 'not_subject', 'not_subject_location']);
  });

  it('formats an exempt rule with its reason', async () => {
    const el = await mount();
    const col = el.columns.find((c) => c.key === 'operation_class')!;
    expect(col.format!(RULE)).toBe('ui.opClass_exempt · E1');
    expect(col.format!({ ...RULE, operation_class: 'subject', exempt_reason: '' })).toBe('ui.opClass_subject');
  });
});
