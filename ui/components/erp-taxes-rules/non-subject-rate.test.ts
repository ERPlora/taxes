// taxes#59 — a rule that charges no tax cannot carry a rate.
//
// Reverse charge (S2), exempt (E*), not subject (N1) and not subject by place of supply (N2) reach the
// AEAT WITHOUT a quota. The screen let the owner pick one of those classes AND type 21 %: the rule
// saved, the till charged 21 % and the invoice then refused to seal the sale
// (`invoice.quota_on_non_subject_class`). Market pattern (Odoo, Business Central, Holded): an exempt
// or reverse-charge tax is a 0 % tax — the form sets it and says why, instead of failing later.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIES = [{ id: 'c1', key: 'product.generic', name: 'Generic product' }];

const root = (id: string, operation_class: string, rate_pct: string) => ({
  id,
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'product.generic',
  rate_pct,
  tax_type: 'vat',
  operation_class,
  exempt_reason: '',
  regime_key: '',
  parent_id: '',
  component_label: '',
  valid_from: '',
  valid_to: '',
  is_active: 1,
});

const RULES = [root('r-subject', 'subject', '21.00'), root('r-exempt', 'exempt', '0.00')];

const commands: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  commands.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : name === 'taxes.rules.list' ? RULES : []),
    queryPage: async () => ({ rows: RULES, total: RULES.length }),
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
  newOperationClass: string;
  parentCandidates: { id: string }[];
  createRule: (ev: Event) => Promise<void>;
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
const rateInput = (el: Wc) => form(el).querySelector('[data-testid="taxes-rules-rate"]') as HTMLElement & { disabled: boolean; helperText?: string };
const classSelect = (el: Wc) => form(el).querySelector('[data-testid="taxes-rules-operation-class"]') as HTMLElement;

async function pickClass(el: Wc, value: string) {
  // The handler reads `e.target.value`, like every other select of this form.
  (classSelect(el) as HTMLElement & { value: string }).value = value;
  classSelect(el).dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  await el.updateComplete;
}

describe('a class that charges no tax sets the rate to 0 and locks it (taxes#59)', () => {
  it.each(['subject_reverse', 'exempt', 'not_subject', 'not_subject_location'])('%s → rate 0, locked, with a hint', async (cls) => {
    const el = await mount();
    el.newRatePct = '21';
    await el.updateComplete;
    await pickClass(el, cls);
    expect(el.newRatePct).toBe('0');
    expect(rateInput(el).disabled, 'the rate stays editable on a class that charges no tax').toBe(true);
    expect(rateInput(el).getAttribute('helper-text')).toBe('ui.hintRateNoTax');
  });

  it('the control: a subject rule keeps an editable rate and no hint', async () => {
    const el = await mount();
    expect(rateInput(el).disabled).toBe(false);
    expect(rateInput(el).getAttribute('helper-text')).toBeNull();
  });

  it('going back to subject unlocks the rate and asks for it again', async () => {
    const el = await mount();
    await pickClass(el, 'exempt');
    await pickClass(el, 'subject');
    expect(rateInput(el).disabled).toBe(false);
    expect(el.newRatePct).toBe('');
  });

  it('never sends a rate with a class that charges no tax, even if one was set by hand', async () => {
    const el = await mount();
    el.newCountry = 'ES';
    el.newCategoryKey = 'product.generic';
    el.newOperationClass = 'subject_reverse';
    el.newRatePct = '21';
    await el.createRule(new Event('submit'));
    expect(commands[0].payload).toMatchObject({ operation_class: 'subject_reverse', rate_pct: 0 });
  });
});

describe('a component cannot hang from a root that charges no tax (taxes#59)', () => {
  it('only subject roots are offered as parents', async () => {
    const el = await mount();
    el.newCountry = 'ES';
    el.newCategoryKey = 'product.generic';
    await el.updateComplete;
    expect(el.parentCandidates.map((r) => r.id)).toEqual(['r-subject']);
  });
});
