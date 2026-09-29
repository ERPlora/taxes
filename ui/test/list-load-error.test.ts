// A list that could not load must not read «No …» + «0 records» (pm#533, hub#2328).
//
// The shell's `<ok-data-table>` (OutfitKit ≥ 0.1.113) paints a failed load itself: «could not
// load», the reason and a Retry button. Each taxes list (categories, rules, aliases) hands it its
// controller's `error` and reloads on its `retry` event — and drops its own red banner, which would
// say the same thing twice. But a module paints with the SHELL's OutfitKit (ADR-0451): on a hub
// whose table has no `error` property the banner is the only place the reason is shown, so it stays.
//
// The shell's table is stood in for by a bare element registered BEFORE the screens load (as the
// shell does at boot; the screens' own `define()` then loses, like in the hub). Its `error`
// property is added or removed per test, which is exactly what `dataTableShowsLoadError()` reads.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class ShellTable extends HTMLElement {}
const errors = new WeakMap<HTMLElement, unknown>();

function shellTableKnowsErrors(yes: boolean) {
  if (yes) {
    Object.defineProperty(ShellTable.prototype, 'error', {
      configurable: true,
      get(this: HTMLElement) { return errors.get(this) ?? ''; },
      set(this: HTMLElement, v: unknown) { errors.set(this, v); },
    });
  } else {
    delete (ShellTable.prototype as { error?: unknown }).error;
  }
}

const SCREENS = [
  { tag: 'erp-taxes-categories', list: 'taxes.categories.list', table: 'taxes-categories-table', banner: 'taxes-categories-load-error' },
  { tag: 'erp-taxes-rules', list: 'taxes.rules.list', table: 'taxes-rules-table', banner: 'taxes-rules-load-error' },
  { tag: 'erp-taxes-aliases', list: 'taxes.aliases.list', table: 'taxes-aliases-table', banner: 'taxes-aliases-load-error' },
] as const;

const ROW = { id: 'r1', key: 'standard', name: 'Standard', alias: 'IVA 21', country_code: 'ES', tax_category_key: 'standard', rate: 21, is_active: 1 };

let hubAnswers = false;
/** The list query of the screen under test: the aliases screen also pages the categories for its picker. */
let listQuery = '';
let pageCalls = 0;
let queryCalls: string[] = [];
let commandCalls: string[] = [];

beforeAll(async () => {
  customElements.define('ok-data-table', ShellTable);
  await import('../components/erp-taxes-categories/erp-taxes-categories');
  await import('../components/erp-taxes-rules/erp-taxes-rules');
  await import('../components/erp-taxes-aliases/erp-taxes-aliases');
});

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  hubAnswers = false;
  listQuery = '';
  pageCalls = 0;
  queryCalls = [];
  commandCalls = [];
  const answer = async (name: string) => {
    queryCalls.push(name);
    if (!hubAnswers) throw new Error('The hub is not responding.');
    return [];
  };
  (globalThis as Record<string, unknown>).erplora = {
    query: answer,
    queryAll: answer,
    queryPage: async (name: string) => {
      if (name === listQuery) pageCalls++;
      else queryCalls.push(name);
      if (!hubAnswers) throw new Error('The hub is not responding.');
      return { rows: [ROW], total: 1 };
    },
    command: async (name: string) => {
      commandCalls.push(name);
      return {};
    },
    hasPermission: () => true,
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
  };
});

type Screen = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function mountFailed(tag: string, list: string, testid: string): Promise<{ el: Screen; table: HTMLElement }> {
  listQuery = list;
  const el = document.createElement(tag) as Screen;
  document.body.appendChild(el);
  await vi.waitFor(() => {
    if (pageCalls === 0) throw new Error('the list has not asked for its page yet');
  });
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const table = el.shadowRoot.querySelector<HTMLElement>(`ok-data-table[testid="${testid}"]`);
  expect(table, `${tag} paints its table`).toBeTruthy();
  return { el, table: table! };
}

async function retry(el: Screen, table: HTMLElement): Promise<void> {
  const before = pageCalls;
  hubAnswers = true;
  table.dispatchEvent(new CustomEvent('retry', { detail: {} }));
  await vi.waitFor(() => {
    if (pageCalls === before) throw new Error('Retry did not ask the hub again');
  });
  await vi.waitFor(async () => {
    await el.updateComplete;
    if ((table as unknown as { error: string }).error !== '') throw new Error('the error is still on the table');
  });
  // Retry only reads: it must never repeat a write the person did not ask for (rv-schedules-61).
  expect(commandCalls, 'Retry sent a command').toEqual([]);
}

describe.each(SCREENS)('$tag — a list that could not load (pm#533)', ({ tag, list, table: testid, banner }) => {
  it('hands the reason to the shell table and paints no second banner', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed(tag, list, testid);
    expect((table as unknown as { error: string }).error).toBe('The hub is not responding.');
    expect(el.shadowRoot.querySelector(`[data-testid="${banner}"]`), 'the reason would be said twice').toBeNull();
    // Any notice counts, not only the one with this testid (rv-schedules-61).
    expect(el.shadowRoot.textContent, 'another notice repeats the reason').not.toContain('The hub is not responding.');
  });

  it('Retry on the table asks the hub again and paints the rows that now arrive', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed(tag, list, testid);
    await retry(el, table);
    expect((table as unknown as { rows: unknown[] }).rows).toEqual([ROW]);
  });

  it('on a shell whose table cannot paint the error, keeps its own banner with the reason', async () => {
    shellTableKnowsErrors(false);
    const { el } = await mountFailed(tag, list, testid);
    const node = el.shadowRoot.querySelector(`[data-testid="${banner}"]`);
    expect(node, 'an older hub would show the failure nowhere').toBeTruthy();
    expect(node!.textContent).toContain('The hub is not responding.');
    // On the PAGE, said once: a notice inside the closed «new» panel is invisible (rv-appointments-227).
    expect(node!.closest('[slot="create"]'), 'the notice sits in the «new» panel').toBeNull();
    expect(el.shadowRoot.textContent!.split('The hub is not responding.').length - 1, 'the reason is said once').toBe(1);
  });
});

describe('what Retry asks again besides the list (pm#533)', () => {
  // Read once when the screen opens and silent on failure: after a failed start the category picker
  // of «new rule» / «new alias» was empty and the parent-rule picker and the overlap warning of the
  // rules screen had nothing to read, even once the hub answered. Retry reads them again with the list.
  const count = (query: string) => queryCalls.filter((n) => n === query).length;

  async function retryAsksAgain(tag: string, list: string, testid: string, query: string): Promise<void> {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed(tag, list, testid);
    await vi.waitFor(() => {
      if (count(query) !== 1) throw new Error(`${query} is asked once with the list`);
    });
    await retry(el, table);
    await vi.waitFor(() => {
      if (count(query) < 2) throw new Error(`${query} was not asked again`);
    });
  }

  it.each(['taxes.categories.list', 'taxes.rules.list'])('rules: Retry also asks again for every row of %s', async (query) => {
    await retryAsksAgain('erp-taxes-rules', 'taxes.rules.list', 'taxes-rules-table', query);
  });

  it('aliases: Retry also asks again for the categories of the «new alias» picker', async () => {
    await retryAsksAgain('erp-taxes-aliases', 'taxes.aliases.list', 'taxes-aliases-table', 'taxes.categories.list');
  });
});
