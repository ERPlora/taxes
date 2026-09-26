// A rule saved with a rate on a class that charges no tax is MARKED, and the owner can repair it
// from the row (taxes#63, out of taxes#59).
//
// taxes#62 refuses such a rule on create, but the ones saved before that guard are still there: the
// till charges them and the invoice refuses to seal the sale (`invoice.quota_on_non_subject_class`),
// so the sale stays charged without invoice. The error surfaced at the till, never here, and the
// screen offered no way out. Now:
//
//  - The SIGNAL. `taxes.rules.list` returns `is_incoherent`; the rate of such a row carries a warning
//    and a banner above the table counts them — whatever page the table is on (Odoo and Business
//    Central warn about a misconfigured tax where it is configured, not where it breaks).
//  - The WAY OUT. The row offers «Repair», which asks which of the two readings of the mistake the
//    owner meant: «Charge no tax (0 %)» (`mode: no_tax`) or «Keep the rate and charge the tax»
//    (`mode: charge_tax`, only when the rule's OWN class is the problem). One confirmation, because
//    it rewrites how future sales are taxed.
//
// The server half is proved in `tests/incoherent_rules_are_flagged_and_repairable.postgres.test.py`.
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'lit';

const CATEGORIES = [{ id: 'c1', key: 'product.generic', name: 'Generic' }];

const rule = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'product.generic',
  rate_pct: '21.00',
  tax_type: 'vat',
  operation_class: 'subject',
  parent_id: '',
  component_label: '',
  valid_from: '',
  valid_to: '',
  is_active: 1,
  is_incoherent: 0,
  ...over,
});

const FINE = rule('r-fine');
const BAD_ROOT = rule('r-bad', { operation_class: 'exempt', exempt_reason: 'E1', valid_from: '2026-02-01', is_incoherent: 1 });
// A subject surcharge under a tax-free root: only the rate can be the mistake here.
const BAD_COMPONENT = rule('r-bad-comp', {
  parent_id: 'r-zero-exempt',
  component_label: 'RE',
  tax_type: 'surcharge',
  rate_pct: '1.40',
  is_incoherent: 1,
});

let permitted = true;
/** What `queryPage` returns (the visible page). */
let pageRows: Record<string, unknown>[] = [];
/** What `queryAll` returns (every active rule of the hub). */
let allRows: Record<string, unknown>[] = [];
let pageCalls = 0;
let sent: { name: string; payload?: Record<string, unknown> }[] = [];
let commandImpl: (name: string, payload?: Record<string, unknown>) => Promise<unknown> = async () => ({});
let listeners: Record<string, () => void> = {};

beforeEach(() => {
  permitted = true;
  pageRows = [FINE, BAD_ROOT];
  allRows = [FINE, BAD_ROOT];
  pageCalls = 0;
  sent = [];
  listeners = {};
  commandImpl = async () => ({});
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : allRows),
    queryPage: async () => {
      pageCalls += 1;
      return { rows: pageRows, total: pageRows.length };
    },
    command: async (name: string, payload?: Record<string, unknown>) => {
      sent.push({ name, payload });
      return commandImpl(name, payload);
    },
    on: (event: string, cb: () => void) => {
      listeners[event] = cb;
      return () => {};
    },
    hasPermission: (p: string) => (p === 'taxes.manage_tax' ? permitted : true),
    locale: 'es',
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      params ? `${key}${JSON.stringify(params)}` : key,
  };
});

type El = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: El) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(): Promise<El> {
  await import('./erp-taxes-rules');
  const el = document.createElement('erp-taxes-rules') as El;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

type Action = { id: string; disabled?: (row: Record<string, unknown>) => boolean };
type Table = HTMLElement & { actions: Action[]; columns: { key: string; format?: (r: Record<string, unknown>) => string; render?: (r: Record<string, unknown>) => unknown }[] };
const table = (el: El) => el.shadowRoot.querySelector('ok-data-table') as Table;
type Alert = HTMLElement & { isOpen: boolean; buttons: { text: string; role: string }[] };
const repairAlert = (el: El) => el.shadowRoot.querySelector('[data-testid="taxes-rules-repair-confirm"]') as Alert | null;

async function rowAction(el: El, actionId: string, row: unknown) {
  table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId, row } }));
  await settle(el);
}

async function dismissRepair(el: El, role: string) {
  repairAlert(el)?.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { detail: { role } }));
  await settle(el);
  await settle(el);
}

const rate = (el: El, row: Record<string, unknown>) =>
  table(el).columns.find((c) => c.key === 'rate_pct')?.format?.(row) ?? '';
// What the table actually paints in the cell: `render` wins over `format` in ok-data-table.
const rateCell = (el: El, row: Record<string, unknown>) => {
  const cell = document.createElement('div');
  const col = table(el).columns.find((c) => c.key === 'rate_pct');
  render(col?.render ? col.render(row) : col?.format?.(row) ?? '', cell);
  return cell;
};

describe('an incoherent rule is visible where it is configured (taxes#63)', () => {
  it('its rate carries the warning; a fine rule does not', async () => {
    const el = await mount();
    expect(rate(el, BAD_ROOT)).toContain('ui.incoherentBadge');
    expect(rate(el, BAD_ROOT), 'the rate itself must still be readable').toContain('21.00%');
    expect(rate(el, FINE)).not.toContain('ui.incoherentBadge');
  });

  it('the warning sits on its own line under the rate, so the narrow % column cannot cut it off', async () => {
    // Found on the real bench for taxes#68: a `format` string is ellipsised to one line by
    // ok-data-table, and «23.00% · d…» was all the owner saw at 1280 px.
    const el = await mount();
    const bad = rateCell(el, BAD_ROOT);
    const mark = bad.querySelector('[data-testid="taxes-rules-incoherent-mark"]');
    expect(mark, 'the incoherent mark is not a separate, wrappable element').toBeTruthy();
    expect(mark?.textContent).toContain('ui.incoherentBadge');
    expect(bad.firstElementChild?.tagName, 'the cell root is a <span>, which the table clips to one line').not.toBe('SPAN');
    expect(bad.textContent).toContain('21.00%');
    const fine = rateCell(el, FINE);
    expect(fine.querySelector('[data-testid="taxes-rules-incoherent-mark"]')).toBeNull();
    expect(fine.textContent).not.toContain('ui.incoherentBadge');
  });

  it('a banner counts them across the WHOLE hub, not just the visible page', async () => {
    pageRows = [FINE];
    allRows = [FINE, BAD_ROOT, BAD_COMPONENT];
    const el = await mount();
    const banner = el.shadowRoot.querySelector('[data-testid="taxes-rules-incoherent-warning"]');
    expect(banner, 'two incoherent rules and no word about it on screen').toBeTruthy();
    expect(banner?.getAttribute('tone')).toBe('warning');
    expect(banner?.textContent).toContain('ui.incoherentWarning{"count":2}');
  });

  it('no banner when every rule is fine', async () => {
    pageRows = [FINE];
    allRows = [FINE];
    const el = await mount();
    expect(el.shadowRoot.querySelector('[data-testid="taxes-rules-incoherent-warning"]')).toBeNull();
  });

  it('a viewer sees the signal too (they can tell the manager)', async () => {
    permitted = false;
    const el = await mount();
    expect(el.shadowRoot.querySelector('[data-testid="taxes-rules-incoherent-warning"]')).toBeTruthy();
  });
});

describe('the owner can repair it from the row (taxes#63)', () => {
  it('«Repair» is offered, but only usable on an incoherent row', async () => {
    const el = await mount();
    const repair = table(el).actions.find((a) => a.id === 'repair');
    expect(repair, 'an incoherent rule on the page and no way to fix it').toBeTruthy();
    expect(repair?.disabled?.(BAD_ROOT)).toBe(false);
    expect(repair?.disabled?.(FINE), 'a coherent rule has nothing to repair').toBe(true);
    expect(table(el).actions.map((a) => a.id)).toContain('deactivate');
  });

  it('no «Repair» clutter on a page where every rule is fine', async () => {
    pageRows = [FINE];
    allRows = [FINE];
    const el = await mount();
    expect(table(el).actions.map((a) => a.id)).toEqual(['end', 'deactivate']);
  });

  it('it asks which reading of the mistake was meant: no tax, or charge the rate', async () => {
    const el = await mount();
    await rowAction(el, 'repair', BAD_ROOT);
    const alert = repairAlert(el);
    expect(alert?.isOpen, 'repairing rewrites how future sales are taxed: it is confirmed').toBe(true);
    expect(alert?.buttons.map((b) => b.role)).toEqual(['cancel', 'charge_tax', 'no_tax']);
    expect(sent, 'nothing is sent before the owner chooses').toEqual([]);
  });

  it('«charge no tax» sends mode no_tax and re-reads the list', async () => {
    const el = await mount();
    await rowAction(el, 'repair', BAD_ROOT);
    const before = pageCalls;
    await dismissRepair(el, 'no_tax');
    expect(sent).toEqual([{ name: 'taxes.rules.repair', payload: { rule_id: 'r-bad', mode: 'no_tax' } }]);
    expect(pageCalls, 'repaired, but the table kept the stale warning').toBeGreaterThan(before);
  });

  it('«keep the rate» sends mode charge_tax', async () => {
    const el = await mount();
    await rowAction(el, 'repair', BAD_ROOT);
    await dismissRepair(el, 'charge_tax');
    expect(sent).toEqual([{ name: 'taxes.rules.repair', payload: { rule_id: 'r-bad', mode: 'charge_tax' } }]);
  });

  it('a subject component under a tax-free root is only offered «no tax»: changing it cannot fix its root', async () => {
    pageRows = [BAD_COMPONENT];
    allRows = [BAD_COMPONENT];
    const el = await mount();
    await rowAction(el, 'repair', BAD_COMPONENT);
    expect(repairAlert(el)?.buttons.map((b) => b.role)).toEqual(['cancel', 'no_tax']);
  });

  it('cancelling sends nothing', async () => {
    const el = await mount();
    await rowAction(el, 'repair', BAD_ROOT);
    await dismissRepair(el, 'cancel');
    expect(sent).toEqual([]);
  });

  it('a forged repair on a coherent row, or from a viewer, sends nothing', async () => {
    const el = await mount();
    await rowAction(el, 'repair', FINE);
    expect(repairAlert(el)?.isOpen ?? false).toBe(false);
    permitted = false;
    const viewer = await mount();
    expect(table(viewer).actions).toEqual([]);
    await rowAction(viewer, 'repair', BAD_ROOT);
    expect(repairAlert(viewer)?.isOpen ?? false).toBe(false);
    expect(sent).toEqual([]);
  });

  it('a failing repair is VISIBLE', async () => {
    commandImpl = async () => {
      throw new Error('taxes.rule_not_incoherent');
    };
    const el = await mount();
    await rowAction(el, 'repair', BAD_ROOT);
    await dismissRepair(el, 'no_tax');
    const feedback = el.shadowRoot.querySelector('ok-inline-feedback[tone="danger"]');
    expect(feedback, 'the repair failed and the screen said nothing').toBeTruthy();
    expect(feedback?.textContent).toContain('taxes.rule_not_incoherent');
  });

  it('a repair made elsewhere (the assistant) refreshes the screen', async () => {
    const el = await mount();
    const before = pageCalls;
    expect(listeners['taxes.rule.repaired'], 'the screen does not listen for repairs').toBeTruthy();
    listeners['taxes.rule.repaired']?.();
    await settle(el);
    expect(pageCalls).toBeGreaterThan(before);
  });
});
