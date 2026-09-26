// taxes#66 — once two active rules of the same slot can no longer overlap, the only legal way to
// schedule a rate change is to END the rule in force the day before the new one starts. Without a
// way to set that end date from the screen the guard would make the change impossible, so each
// active rule offers «Set end date» in its row, the way Oracle E-Business Tax and Dynamics 365 let
// the owner end-date the current rate before adding the next one.
//
// The command side (`taxes.rules.end`: stored end date, refused before the rule's start, refused
// when it pushes into the next rule, other hubs cannot touch it) lives in
// tests/overlapping_rules_are_refused.postgres.test.py.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const RULE = { id: 'r-pt', country_code: 'PT', tax_category_key: 'general', rate_pct: 23, valid_from: '2020-01-01', valid_to: null, is_active: 1 };

let commandImpl: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
let allowed = true;
const sent: { name: string; payload: Record<string, unknown> }[] = [];

class RuntimeRefusal extends Error {
  constructor(readonly code: string) {
    super(`refused: ${code}`);
  }
}

beforeEach(() => {
  sent.length = 0;
  allowed = true;
  commandImpl = async () => ({});
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async () => [],
    queryPage: async () => ({ rows: [RULE], total: 1 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      sent.push({ name, payload });
      return commandImpl(name, payload);
    },
    on: () => () => {},
    hasPermission: () => allowed,
    locale: 'en',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };
type Table = HTMLElement & { actions: { id: string }[] };
type Alert = HTMLElement & { isOpen: boolean; inputs: { name: string; type: string; value?: unknown }[] };

async function settle(el: Wc): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(): Promise<Wc> {
  await import('./erp-taxes-rules');
  const el = document.createElement('erp-taxes-rules') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await settle(el);
  return el;
}

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;
const endAlert = (el: Wc) => el.shadowRoot.querySelector('[data-testid="taxes-rules-end-confirm"]') as Alert | null;

async function rowAction(el: Wc, actionId: string, row: unknown): Promise<void> {
  table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId, row } }));
  await settle(el);
}

async function dismiss(el: Wc, role: string, validTo?: string): Promise<void> {
  endAlert(el)?.dispatchEvent(
    new CustomEvent('ionAlertDidDismiss', { detail: { role, data: { values: { valid_to: validTo } } } }),
  );
  await settle(el);
  await settle(el);
}

describe('an active rule can be given an end date (taxes#66)', () => {
  it('each active rule offers «Set end date» next to «Deactivate»', async () => {
    const el = await mount();
    expect(table(el).actions.map((a) => a.id)).toEqual(['end', 'deactivate']);
  });

  it('a viewer without the manage permission is not offered it', async () => {
    allowed = false;
    const el = await mount();
    expect(table(el).actions).toEqual([]);
  });

  it('the action asks for the date, then sends `taxes.rules.end` with it', async () => {
    const el = await mount();
    await rowAction(el, 'end', RULE);
    const alert = endAlert(el);
    expect(alert, 'there is no dialog to pick the end date').toBeTruthy();
    expect(alert?.isOpen).toBe(true);
    expect(alert?.inputs.map((i) => [i.name, i.type])).toEqual([['valid_to', 'date']]);
    await dismiss(el, 'confirm', '2026-12-31');
    expect(sent).toContainEqual({ name: 'taxes.rules.end', payload: { rule_id: 'r-pt', valid_to: '2026-12-31' } });
  });

  it('cancelling, or confirming without a date, sends nothing', async () => {
    const el = await mount();
    await rowAction(el, 'end', RULE);
    await dismiss(el, 'cancel', '2026-12-31');
    await rowAction(el, 'end', RULE);
    await dismiss(el, 'confirm', '');
    expect(sent.filter((s) => s.name === 'taxes.rules.end')).toEqual([]);
  });

  it('a forged action from a viewer sends nothing', async () => {
    allowed = false;
    const el = await mount();
    await rowAction(el, 'end', RULE);
    await dismiss(el, 'confirm', '2026-12-31');
    expect(sent.filter((s) => s.name === 'taxes.rules.end')).toEqual([]);
  });

  it('a refusal is shown to the owner, with the overlap in its own words', async () => {
    commandImpl = async (name) => {
      if (name === 'taxes.rules.end') throw new RuntimeRefusal('taxes.rule_overlaps');
      return {};
    };
    const el = await mount();
    await rowAction(el, 'end', RULE);
    await dismiss(el, 'confirm', '2027-06-30');
    const banner = el.shadowRoot.querySelector('[data-testid="taxes-rules-form-error"]');
    expect(banner, 'the refusal went silent').toBeTruthy();
    expect(banner?.textContent).toContain('ui.errRuleOverlaps');
  });

  it('every new sentence exists in English and in Spanish', () => {
    for (const lang of ['en', 'es']) {
      const catalog = JSON.parse(readFileSync(join(ROOT, `locales/${lang}.json`), 'utf8')) as { ui: Record<string, string> };
      for (const key of ['actionEndRule', 'endRuleTitle', 'endRuleMessage', 'endRuleAction', 'errEndRule']) {
        expect(catalog.ui[key]?.trim(), `ui.${key} missing in ${lang}`).toBeTruthy();
      }
    }
  });
});
