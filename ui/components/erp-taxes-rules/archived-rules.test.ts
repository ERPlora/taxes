// A deactivated rule has to be REACHABLE and it has to be able to come BACK (taxes#52).
//
// taxes#50 took the «Active» filter away, and it was right to: `queries/rules_list.sql` ended in
// `AND r.is_active = 1`, so the «No» option could only ever answer with an empty table. But taking
// the filter away left the real defect standing and made it quieter — the screen deactivates a rule
// with one tap, the row vanishes, and there is no surface anywhere in the product that brings it
// back. The only way home was the database.
//
// So the filter comes back, and this time with the two halves the market always ships together:
//
//  - The SCOPE. Picking «No» is not one more filter: the archived rules are not in the default
//    answer of `taxes.rules.list` AT ALL (the keystone of ADR-0069 pre-loads that very read for
//    `sales.complete_sale`), so narrowing to them has to WIDEN the scope as well. The widening
//    travels as `include_archived`, an OPTIONAL bind — a caller that never heard of it, the
//    keystone included, keeps getting exactly the rows it got yesterday.
//  - The WAY BACK. While the archived ones are on screen the row offers `restore` instead of
//    `deactivate`: offering «deactivate» on something already deactivated is an offer to do
//    nothing. That is Square's `Unarchive` and Fresha's row menu, and it is what this codebase
//    already does one module away — `services` (services#44), whose shape this file follows on
//    purpose so the two screens do not drift.
//
// The server half of this contract is proved against a real Postgres in
// `tests/deactivated_rules_are_visible_and_can_be_reactivated.postgres.test.py`. This file proves
// the screen half: that the scope travels, that the action flips, and that neither a missing
// permission nor a failing command ends in silence.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIES = [{ id: 'c1', key: 'restaurant.food', name: 'Comida' }];

const rule = (id: string, is_active: number) => ({
  id,
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'restaurant.food',
  rate_pct: '10.00',
  tax_type: 'vat',
  operation_class: 'subject',
  parent_id: '',
  component_label: '',
  valid_from: '',
  valid_to: '',
  is_active,
});

const ACTIVE = [rule('r-es-2026', 1)];
const ARCHIVED = [rule('r-es-2025', 0)];

/** Whether the signed-in user holds `taxes.manage_tax` — swapped per test. */
let permitted = true;
/** The params of the LAST `queryPage`, i.e. what actually travelled to the hub. */
let lastParams: Record<string, unknown> = {};
/** How many reads the screen has asked for, so a reload can be told from a no-op. */
let pageCalls = 0;
/** Every command the screen fired, in order. */
let sent: { name: string; payload?: Record<string, unknown> }[] = [];
/** What `erplora.command` does — swapped for the failure case. */
let commandImpl: (name: string, payload?: Record<string, unknown>) => Promise<unknown> = async () => ({});

const scopeOf = (p: Record<string, unknown>): Record<string, unknown> =>
  (p.params as Record<string, unknown>) ?? {};
const filtersOf = (p: Record<string, unknown>): Record<string, unknown> =>
  (p.filters as Record<string, unknown>) ?? {};

beforeEach(() => {
  permitted = true;
  lastParams = {};
  pageCalls = 0;
  sent = [];
  commandImpl = async () => ({});
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : ACTIVE),
    // A faithful miniature of the manifest + the SQL: the archived rows exist, but they only come
    // out when the scope was widened, and `f_is_active` narrows whatever the scope let through.
    queryPage: async (_name: string, params: Record<string, unknown>) => {
      lastParams = params;
      pageCalls += 1;
      const widened = String(scopeOf(params).include_archived ?? '') !== '';
      let rows = widened ? [...ACTIVE, ...ARCHIVED] : ACTIVE;
      const wanted = filtersOf(params).is_active;
      if (wanted !== undefined) rows = rows.filter((r) => String(r.is_active) === String(wanted));
      return { rows, total: rows.length };
    },
    command: async (name: string, payload?: Record<string, unknown>) => {
      sent.push({ name, payload });
      return commandImpl(name, payload);
    },
    on: () => () => {},
    hasPermission: (p: string) => (p === 'taxes.manage_tax' ? permitted : true),
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

type Table = HTMLElement & { actions: { id: string }[] };
const table = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as Table;

/** Picks a value in the column's filter box, the way `ok-data-table` announces it. */
async function filterBy(el: HTMLElement & { shadowRoot: ShadowRoot }, col: string, value: unknown) {
  table(el).dispatchEvent(new CustomEvent('filterChange', { detail: { col, value } }));
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

/** Fires a row action, forged or not — the screen must decide, not the table. */
async function rowAction(el: HTMLElement & { shadowRoot: ShadowRoot }, actionId: string, row: unknown) {
  table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId, row } }));
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

describe('the deactivated rules can be asked for (taxes#52)', () => {
  it('«Active» is filterable again, by choosing yes or no', async () => {
    const el = await mount();
    const col = column(el, 'is_active');
    expect(col, 'the is_active column disappeared').toBeTruthy();
    expect(
      col?.filterable,
      'the filter is what taxes#50 removed because the server could not honour it; the server can now',
    ).toBe(true);
    expect(col?.filterType, 'a closed two-value domain is chosen, never typed').toBe('select');
    expect(col?.options).toEqual([
      { value: '1', label: 'ui.optYes' },
      { value: '0', label: 'ui.optNo' },
    ]);
  });

  it('asking for the deactivated ones WIDENS the scope, not just the filter', async () => {
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    expect(
      scopeOf(lastParams).include_archived,
      'without widening the scope the query never returns a deactivated rule: the filter would be the dead box taxes#50 removed',
    ).toBe(1);
    expect(filtersOf(lastParams).is_active, 'the column filter still travels').toBe('0');
  });

  it('and the deactivated rule really lands on the table', async () => {
    const el = await mount();
    expect((table(el) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual(['r-es-2026']);
    await filterBy(el, 'is_active', '0');
    expect(
      (table(el) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id),
      'the screen asked for the archived ones and got an empty table',
    ).toEqual(['r-es-2025']);
  });

  it('going back to the active ones narrows the scope again', async () => {
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    await filterBy(el, 'is_active', '1');
    expect(
      scopeOf(lastParams).include_archived,
      'the widened scope stuck: the keystone-shaped default read is no longer the default',
    ).toBeUndefined();
    expect(filtersOf(lastParams).is_active).toBe('1');
  });

  it('clearing the filter goes back to the default scope too', async () => {
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    await filterBy(el, 'is_active', '');
    expect(scopeOf(lastParams).include_archived).toBeUndefined();
    expect(filtersOf(lastParams).is_active, 'an empty value removes the filter').toBeUndefined();
  });

  it('any other column leaves the scope alone', async () => {
    const el = await mount();
    await filterBy(el, 'country_code', 'ES');
    expect(
      scopeOf(lastParams).include_archived,
      'narrowing by country quietly started showing deactivated rules',
    ).toBeUndefined();
    expect(filtersOf(lastParams).country_code).toBe('ES');
  });
});

describe('a deactivated rule can come back (taxes#52)', () => {
  it('the row offers the way back instead of an offer to do nothing', async () => {
    const el = await mount();
    expect(table(el).actions.map((a) => a.id)).toEqual(['end', 'deactivate']);
    await filterBy(el, 'is_active', '0');
    expect(
      table(el).actions.map((a) => a.id),
      'the archived row still offers «deactivate», which would do nothing at all',
    ).toEqual(['restore']);
  });

  it('restoring fires `taxes.rules.activate` and re-reads the list', async () => {
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    const before = pageCalls;
    await rowAction(el, 'restore', ARCHIVED[0]);
    expect(sent).toEqual([{ name: 'taxes.rules.activate', payload: { rule_id: 'r-es-2025' } }]);
    expect(pageCalls, 'the rule came back but the table kept showing the stale answer').toBeGreaterThan(before);
  });

  it('restoring asks for no confirmation — it undoes a destructive step, it is not one', async () => {
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    await rowAction(el, 'restore', ARCHIVED[0]);
    const alert = el.shadowRoot.querySelector('ion-alert') as (HTMLElement & { isOpen: boolean }) | null;
    expect(alert?.isOpen ?? false, 'a confirmation on «undo» is the extra tap the market does not ask for').toBe(false);
  });

  it('a viewer gets no way back, and a forged action does not open one', async () => {
    permitted = false;
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    expect(table(el).actions, 'a viewer is being offered to reactivate rules').toEqual([]);
    await rowAction(el, 'restore', ARCHIVED[0]);
    expect(sent, 'the permission is decided by the table instead of by the screen').toEqual([]);
  });

  it('a failing restore is VISIBLE, never a row that silently stays put', async () => {
    commandImpl = async () => {
      throw new Error('taxes.rule_not_deactivated');
    };
    const el = await mount();
    await filterBy(el, 'is_active', '0');
    await rowAction(el, 'restore', ARCHIVED[0]);
    const feedback = el.shadowRoot.querySelector('ok-inline-feedback[tone="danger"]');
    expect(feedback, 'the command failed and the screen said nothing').toBeTruthy();
    expect(feedback?.textContent).toContain('taxes.rule_not_deactivated');
  });
});
