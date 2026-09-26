// taxes#66 — a rule whose dates overlap another active rule of the same slot is refused, and the
// screen says so ON THE DATE FIELD.
//
// The command refuses it with `taxes.rule_overlaps` (tests/overlapping_rules_are_refused.postgres
// .test.py). A refusal that only lands in the generic banner above the table leaves the owner
// guessing which of the twelve fields was wrong; the date is the one to change, so that is where the
// error goes — the way Odoo and Business Central mark the offending field of a form.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const CATEGORIES = [{ id: 'c1', key: 'general', name: 'General' }];

let commandImpl: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
const sent: { name: string; payload: Record<string, unknown> }[] = [];

class RuntimeRefusal extends Error {
  constructor(readonly code: string) {
    super(`refused: ${code}`);
  }
}

beforeEach(() => {
  sent.length = 0;
  commandImpl = async () => ({});
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : []),
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      sent.push({ name, payload });
      return commandImpl(name, payload);
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
  newValidFrom: string;
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

const validFrom = (el: Wc) =>
  el.shadowRoot.querySelector('form[slot="create"] [data-testid="taxes-rules-valid-from"]') as HTMLElement & { value: string };

async function submitOverlapping(el: Wc): Promise<void> {
  el.newCountry = 'PT';
  el.newCategoryKey = 'general';
  el.newRatePct = '25';
  el.newValidFrom = '2027-01-01';
  await el.createRule(new Event('submit'));
  await el.updateComplete;
}

describe('an overlapping rule is refused on the date field (taxes#66)', () => {
  it('the refusal marks «Valid from» with its own sentence', async () => {
    commandImpl = async () => {
      throw new RuntimeRefusal('taxes.rule_overlaps');
    };
    const el = await mount();
    await submitOverlapping(el);
    const field = validFrom(el);
    expect(field.getAttribute('error-text'), 'the date field does not say what is wrong').toBe('ui.errRuleOverlaps');
    expect(field.classList.contains('ion-invalid'), 'the field is not painted as invalid').toBe(true);
    expect(field.classList.contains('ion-touched'), 'Ionic only shows error-text on a touched field').toBe(true);
  });

  it('what the owner typed stays in the form, so only the date has to change', async () => {
    commandImpl = async () => {
      throw new RuntimeRefusal('taxes.rule_overlaps');
    };
    const el = await mount();
    await submitOverlapping(el);
    expect([el.newCountry, el.newCategoryKey, el.newRatePct, el.newValidFrom]).toEqual(['PT', 'general', '25', '2027-01-01']);
  });

  it('changing the date clears the mark', async () => {
    commandImpl = async () => {
      throw new RuntimeRefusal('taxes.rule_overlaps');
    };
    const el = await mount();
    await submitOverlapping(el);
    const field = validFrom(el);
    field.value = '2028-01-01';
    field.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '2028-01-01' } }));
    await el.updateComplete;
    expect(validFrom(el).getAttribute('error-text')).toBeNull();
    expect(validFrom(el).classList.contains('ion-invalid')).toBe(false);
  });

  it('the control: any other refusal does not blame the date', async () => {
    commandImpl = async () => {
      throw new RuntimeRefusal('taxes.rule_incoherent');
    };
    const el = await mount();
    await submitOverlapping(el);
    expect(validFrom(el).getAttribute('error-text')).toBeNull();
    expect(el.shadowRoot.querySelector('[data-testid="taxes-rules-form-error"]'), 'the other refusal went silent').toBeTruthy();
  });

  it('the sentence exists in English and in Spanish', () => {
    for (const lang of ['en', 'es']) {
      const catalog = JSON.parse(readFileSync(join(ROOT, `locales/${lang}.json`), 'utf8')) as { ui: Record<string, string> };
      expect(catalog.ui.errRuleOverlaps?.trim(), `ui.errRuleOverlaps missing in ${lang}`).toBeTruthy();
    }
  });
});
