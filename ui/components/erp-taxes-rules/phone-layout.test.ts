// The rules screen on a phone (taxes#67).
//
// Recorded on a hub at 390 px: the cards scrolled inside a 376 px box while the «10 records» footer
// stayed pinned under it, so the owner scrolled one card at a time through a slot — and every card
// said its category twice, `product.generic` as the title and again as the first field.
//
//  - The LIST. On a phone the table does not fill the screen (`fill` pins the footer and scrolls the
//    rows inside): the page scrolls as one, and the footer follows the last card — the way Shopify,
//    Square and Odoo lay a list out on a phone. A desktop keeps `fill`: a fixed pager there is right.
//  - The CARD. Titled by the category's readable name, and the category row is not repeated under it.
//
// happy-dom does not lay out: this pins the contract; the bench screenshots in the PR prove the layout.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'lit';

const CATEGORIES = [{ id: 'c1', key: 'product.generic', name: 'Product — generic', display_name: 'Producto — general' }];

const rule = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'product.generic',
  tax_category_display_name: 'Producto — general',
  rate_pct: '21.00',
  tax_type: 'vat',
  operation_class: 'subject',
  parent_id: '',
  component_label: '',
  valid_from: '2012-09-01',
  valid_to: '',
  is_active: 1,
  is_incoherent: 0,
  overlaps: 0,
  ...over,
});

const ROOT = rule('r-root');
const SURCHARGE = rule('r-re', { parent_id: 'r-root', component_label: 'RE', rate_pct: '5.20', tax_type: 'surcharge' });

// A controllable `(max-width: 834px)`: the phone breakpoint the screen already opens cards at.
let phone = false;
let listeners: { query: string; l: (e: { matches: boolean }) => void }[] = [];
const PHONE_QUERY = '(max-width: 834px)';
const realMatchMedia = window.matchMedia;

function setPhone(on: boolean): void {
  phone = on;
  for (const { l } of listeners) l({ matches: on });
}

beforeEach(() => {
  phone = false;
  listeners = [];
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    media: query,
    get matches() {
      return /max-width/.test(query) ? phone : false;
    },
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push({ query, l }),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => {
      listeners = listeners.filter((x) => x.l !== l);
    },
  });
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : [ROOT, SURCHARGE]),
    queryPage: async () => ({ rows: [ROOT, SURCHARGE], total: 2 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  window.matchMedia = realMatchMedia;
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
  fill: boolean;
  columns: { key: string; header: string }[];
  cardTitle?: (row: Record<string, unknown>) => unknown;
  renderCard?: (row: Record<string, unknown>) => unknown;
};
const table = (el: El) => el.shadowRoot.querySelector('ok-data-table') as Table;

/** What a card's body paints for `row`, as text rows `«header» «value»`. */
function cardRows(el: El, row: Record<string, unknown>): string[] {
  const t = table(el);
  expect(t.renderCard, 'no card body of its own: ok-data-table lists every column, the category included').toBeTypeOf('function');
  const host = document.createElement('div');
  render(t.renderCard!(row), host);
  const text = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return [...host.querySelectorAll('.rrow')].map((r) => `${text(r.querySelector('.rk'))} ${text(r.querySelector('.rv'))}`);
}

describe('on a phone the rules list scrolls as one page, footer after the last card (taxes#67)', () => {
  it('the table does not fill the screen on a phone, so its footer is not pinned under a scrolling box', async () => {
    phone = true;
    const el = await mount();
    expect(table(el).fill, 'fill on a phone: the rows scroll inside a slot and «N records» stays pinned').toBe(false);
  });

  it('a desktop keeps the table filling the screen with its pager fixed', async () => {
    const el = await mount();
    expect(table(el).fill).toBe(true);
  });

  it('turning the device across the breakpoint switches it, both ways', async () => {
    const el = await mount();
    setPhone(true);
    await settle(el);
    expect(table(el).fill, 'narrowed to a phone, still filling').toBe(false);
    setPhone(false);
    await settle(el);
    expect(table(el).fill, 'widened to a desktop, still flowing').toBe(true);
  });

  it('stops listening once it leaves the page', async () => {
    const el = await mount();
    const mine = () => listeners.filter((x) => x.query === PHONE_QUERY);
    expect(mine()).toHaveLength(1);
    el.remove();
    expect(mine(), 'a removed screen still listens to the viewport').toHaveLength(0);
  });

  it('a table that does not fill keeps its full height instead of shrinking under the page', async () => {
    // Inside the scrolling `.page` (taxes#68) a flex item with `flex-shrink:1` is squeezed down to its
    // `min-height` floor, and the cards below it spill over the footer. Only the filling table shrinks.
    await import('./erp-taxes-rules');
    const Ctor = customElements.get('erp-taxes-rules') as unknown as { styles: { cssText: string } };
    const css = Ctor.styles.cssText.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.page > ok-data-table:not\(\[fill\]\) \{[^}]*flex: ?0 0 auto/);
  });
});

describe('a rule card says each thing once (taxes#67)', () => {
  it('its title is the category name a person reads, not the key', async () => {
    const el = await mount();
    expect(String(table(el).cardTitle?.(ROOT))).toBe('Producto — general');
  });

  it('a component card names its root category and its own label', async () => {
    const el = await mount();
    const title = String(table(el).cardTitle?.(SURCHARGE));
    expect(title).toContain('Producto — general');
    expect(title).toContain('RE');
  });

  it('a rule read without the resolved name still gets a title: its key', async () => {
    const el = await mount();
    expect(String(table(el).cardTitle?.(rule('r-x', { tax_category_display_name: undefined })))).toBe('product.generic');
  });

  it('the body does not repeat the category, and shows every other field once', async () => {
    const el = await mount();
    const rows = cardRows(el, ROOT);
    expect(rows.some((r) => r.startsWith('ui.colCategory')), 'the category is repeated under the title').toBe(false);
    expect(rows.join(' | ')).not.toContain('product.generic');
    const others = table(el).columns.filter((c) => c.key !== 'tax_category_key').map((c) => c.header);
    expect(rows.map((r) => r.split(' ')[0])).toEqual(others);
    expect(rows).toContain('ui.colCountry ES');
    expect(rows).toContain('ui.colRate 21.00%');
  });

  it('the body leaves out the columns the person hid with the column picker, as the default card does', async () => {
    // ok-data-table's own card body paints only its visible columns; a custom body that painted
    // every column would bring a hidden field back the moment the view switches to cards.
    const el = await mount();
    const visible = table(el).columns.map((c) => c.key).filter((k) => k !== 'region_code');
    table(el).dispatchEvent(new CustomEvent('columnsChange', { detail: { visible } }));
    await settle(el);
    const rows = cardRows(el, ROOT);
    expect(rows.some((r) => r.startsWith('ui.colRegion')), 'a hidden column is back on the card').toBe(false);
    expect(rows).toContain('ui.colCountry ES');
  });

  it('the body keeps the warning marks of the table cells (taxes#63, taxes#68)', async () => {
    const el = await mount();
    const host = document.createElement('div');
    render(table(el).renderCard!(rule('r-o', { overlaps: 1 })), host);
    expect(host.querySelector('[data-testid="taxes-rules-overlap-mark"]')).not.toBeNull();
  });
});
