// Rules that ALREADY overlapped before taxes#66 are MARKED, and the owner can resolve them from the
// row (taxes#68).
//
// taxes#66 refuses any write that would leave two active rules of the same country, region and
// category in force on the same day, but pairs saved before that guard are still there: both listed
// as in force, and the till charges whichever starts later without the owner ever seeing it.
//
//  - The SIGNAL. `taxes.rules.list` returns `overlaps`; the «Valid from» of such a row carries a
//    warning and a banner above the table counts them — whatever page the table is on (the same
//    treatment taxes#63 gives an incoherent rule).
//  - The WAY OUT. «Set end date» and «Deactivate» are already on every active row (taxes#66); the
//    marked row keeps both, and resolving it re-reads the list so the mark goes away.
//
// The server half is proved in `tests/overlapping_rules_are_flagged.postgres.test.py`.
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
  overlaps: 0,
  ...over,
});

const OLD = rule('r-old', { overlaps: 1 });
const NEW = rule('r-new', { rate_pct: '23.00', valid_from: '2027-01-01', overlaps: 1 });
const FINE = rule('r-fine', { country_code: 'PT', rate_pct: '23.00' });

let permitted = true;
let pageRows: Record<string, unknown>[] = [];
let allRows: Record<string, unknown>[] = [];
let pageCalls = 0;
let allCalls = 0;
let sent: { name: string; payload?: Record<string, unknown> }[] = [];
let lastFilters: Record<string, unknown> = {};

beforeEach(() => {
  permitted = true;
  pageRows = [OLD, NEW, FINE];
  allRows = [OLD, NEW, FINE];
  pageCalls = 0;
  allCalls = 0;
  sent = [];
  lastFilters = {};
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => {
      if (name === 'taxes.categories.list') return CATEGORIES;
      allCalls += 1;
      return allRows;
    },
    queryPage: async (_name: string, params: { filters?: Record<string, unknown> }) => {
      pageCalls += 1;
      lastFilters = { ...(params?.filters ?? {}) };
      return { rows: pageRows, total: pageRows.length };
    },
    command: async (name: string, payload?: Record<string, unknown>) => {
      sent.push({ name, payload });
      return {};
    },
    on: () => () => {},
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

type Table = HTMLElement & {
  actions: { id: string; disabled?: (row: Record<string, unknown>) => boolean }[];
  columns: { key: string; format?: (r: Record<string, unknown>) => string; render?: (r: Record<string, unknown>) => unknown }[];
};
const table = (el: El) => el.shadowRoot.querySelector('ok-data-table') as Table;
const banner = (el: El) => el.shadowRoot.querySelector('[data-testid="taxes-rules-overlap-warning"]');
const validFrom = (el: El, row: Record<string, unknown>) =>
  table(el).columns.find((c) => c.key === 'valid_from')?.format?.(row) ?? '';
// What the table actually paints in the cell: `render` wins over `format` in ok-data-table.
const validFromCell = (el: El, row: Record<string, unknown>) => {
  const cell = document.createElement('div');
  const col = table(el).columns.find((c) => c.key === 'valid_from');
  render(col?.render ? col.render(row) : col?.format?.(row) ?? '', cell);
  return cell;
};
const filterButton = (el: El) => el.shadowRoot.querySelector('[data-testid="taxes-rules-overlap-filter"]') as HTMLElement | null;

describe('a rule that overlaps another is visible where it is configured (taxes#68)', () => {
  it('its «Valid from» carries the warning, and the date stays readable; a fine rule has none', async () => {
    const el = await mount();
    expect(validFrom(el, NEW)).toContain('ui.overlapBadge');
    expect(validFrom(el, NEW), 'the date itself must still be readable').toContain('2027-01-01');
    expect(validFrom(el, OLD), 'an open start is still shown as a dash').toContain('—');
    expect(validFrom(el, OLD)).toContain('ui.overlapBadge');
    expect(validFrom(el, FINE)).not.toContain('ui.overlapBadge');
  });

  it('the warning sits on its own line under the date, so a narrow column cannot cut it off', async () => {
    // ok-data-table ellipsises a plain `format` string in one line: «2012-09-01 …» was all the
    // owner saw at 1280 px. A `render` cell wraps, and the mark is its own element.
    const el = await mount();
    const marked = validFromCell(el, NEW);
    const mark = marked.querySelector('[data-testid="taxes-rules-overlap-mark"]');
    expect(mark, 'the overlap mark is not a separate, wrappable element').toBeTruthy();
    expect(mark?.textContent).toContain('ui.overlapBadge');
    // ok-data-table styles `.gcell > span` with nowrap + ellipsis: a <span> root is cut all the same.
    expect(marked.firstElementChild?.tagName, 'the cell root is a <span>, which the table clips to one line').not.toBe('SPAN');
    expect(marked.textContent).toContain('2027-01-01');
    expect(validFromCell(el, OLD).textContent).toContain('—');
    const fine = validFromCell(el, FINE);
    expect(fine.querySelector('[data-testid="taxes-rules-overlap-mark"]')).toBeNull();
    expect(fine.textContent).not.toContain('ui.overlapBadge');
  });

  it('a banner counts them across the WHOLE hub, not just the visible page', async () => {
    pageRows = [FINE];
    const el = await mount();
    expect(banner(el), 'two rules in force on the same days and no word about it on screen').toBeTruthy();
    expect(banner(el)?.getAttribute('tone')).toBe('warning');
    expect(banner(el)?.textContent).toContain('ui.overlapWarning{"count":2}');
  });

  it('no banner when no rule overlaps', async () => {
    pageRows = [FINE];
    allRows = [FINE];
    const el = await mount();
    expect(banner(el)).toBeNull();
  });

  it('a viewer sees the signal too (they can tell the manager)', async () => {
    permitted = false;
    const el = await mount();
    expect(banner(el)).toBeTruthy();
  });
});

describe('the owner finds them wherever they are in the list (taxes#68)', () => {
  it('the banner shows only the overlapping rules, and back to all of them', async () => {
    const el = await mount();
    expect(filterButton(el), 'the banner points at rows the owner may have to hunt for page by page').toBeTruthy();
    expect(filterButton(el)?.textContent).toContain('ui.overlapShow');
    filterButton(el)?.click();
    await settle(el);
    expect(lastFilters.overlaps, 'the table was not narrowed to the overlapping rules').toBe('1');
    expect(filterButton(el)?.textContent).toContain('ui.overlapShowAll');
    filterButton(el)?.click();
    await settle(el);
    expect(lastFilters.overlaps, 'the owner cannot get back to the full list').toBeUndefined();
  });

  it('once the last overlap is resolved, the list is not left filtered to nothing', async () => {
    const el = await mount();
    filterButton(el)?.click();
    await settle(el);
    expect(lastFilters.overlaps).toBe('1');
    table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'deactivate', row: NEW } }));
    await settle(el);
    allRows = [rule('r-old'), FINE];
    pageRows = [];
    const alert = el.shadowRoot.querySelector('[data-testid="taxes-rules-deactivate-confirm"]');
    alert?.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { detail: { role: 'confirm' } }));
    await settle(el);
    await settle(el);
    await settle(el);
    expect(banner(el)).toBeNull();
    expect(lastFilters.overlaps, 'banner gone, filter still on: an empty table and no way to tell why').toBeUndefined();
  });
});

describe('the owner resolves it from the row (taxes#68)', () => {
  it('the marked row offers «Set end date» and «Deactivate», usable on it', async () => {
    const el = await mount();
    const ids = table(el).actions.map((a) => a.id);
    expect(ids).toContain('end');
    expect(ids).toContain('deactivate');
    for (const a of table(el).actions.filter((x) => x.id === 'end' || x.id === 'deactivate')) {
      expect(a.disabled?.(OLD) ?? false, `«${a.id}» disabled on the row that needs it`).toBe(false);
    }
  });

  it('ending the older rule re-reads the whole hub, so the banner can go away', async () => {
    const el = await mount();
    table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'end', row: OLD } }));
    await settle(el);
    const before = allCalls;
    allRows = [rule('r-old', { valid_to: '2026-12-31' }), rule('r-new', { rate_pct: '23.00', valid_from: '2027-01-01' }), FINE];
    const alert = el.shadowRoot.querySelector('[data-testid="taxes-rules-end-confirm"]');
    alert?.dispatchEvent(
      new CustomEvent('ionAlertDidDismiss', { detail: { role: 'confirm', data: { values: { valid_to: '2026-12-31' } } } }),
    );
    await settle(el);
    await settle(el);
    expect(sent).toEqual([{ name: 'taxes.rules.end', payload: { rule_id: 'r-old', valid_to: '2026-12-31' } }]);
    expect(allCalls, 'resolved, but the banner kept counting the stale rows').toBeGreaterThan(before);
    expect(banner(el)).toBeNull();
  });

  it('deactivating one of them re-reads the whole hub, so the banner can go away', async () => {
    const el = await mount();
    table(el).dispatchEvent(new CustomEvent('rowAction', { detail: { actionId: 'deactivate', row: NEW } }));
    await settle(el);
    const before = allCalls;
    allRows = [rule('r-old'), FINE];
    const alert = el.shadowRoot.querySelector('[data-testid="taxes-rules-deactivate-confirm"]');
    alert?.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { detail: { role: 'confirm' } }));
    await settle(el);
    await settle(el);
    expect(sent).toEqual([{ name: 'taxes.rules.deactivate', payload: { rule_id: 'r-new' } }]);
    expect(allCalls, 'deactivated, but the banner kept counting the stale rows').toBeGreaterThan(before);
    expect(banner(el)).toBeNull();
  });
});

describe('the warnings never squeeze the rules off a phone screen (taxes#68)', () => {
  // Found on the real bench at 390 px: «cannot invoice yet» + the incoherent warning + this one left
  // the table 30 px tall and no card visible. happy-dom does not lay out, so this pins the styles;
  // the bench screenshots in the PR are the proof they work.
  it('the page scrolls and the table keeps a usable height under the banners', async () => {
    await import('./erp-taxes-rules');
    const Ctor = customElements.get('erp-taxes-rules') as unknown as { styles: { cssText: string } };
    const css = Ctor.styles.cssText.replace(/\s+/g, ' ');
    expect(css, 'the page does not scroll: banners push the table out of reach').toMatch(/\.page \{[^}]*overflow-y: ?auto/);
    expect(css, 'the table can shrink to nothing under the banners').toMatch(/\.page > ok-data-table \{[^}]*min-height: ?min\(/);
    expect(css, 'the table shrinks below its minimum').toMatch(/\.page > ok-data-table \{[^}]*flex: ?1 0 auto/);
  });
});
