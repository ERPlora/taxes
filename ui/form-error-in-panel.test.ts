// pm#513 (out of pm#478) — on a phone or a tablet, a refused «Add» in Categories, Tax rules or
// Aliases showed NOTHING: the person pressed «Add» and the sheet stayed as it was.
//
// The refusal did arrive; it was painted in the wrong place. Each form lives in the `create` panel
// of the `ok-data-table`, and under 834 px that panel is a FULL-SCREEN sheet (outfitkit#75). The
// notice was a child of the PAGE, so on a phone it sat under the sheet, out of sight (bench:
// hub:stable 1.1.30, 390 and 820 px, ios and md: 12 of 18 hidden across the three screens). On a
// desktop the panel sits beside the table and the notice happened to be visible.
//
// The rule, the same one customers#97 / tables#93 / reservations#73 / tasks#47 / tickets#43 /
// cart_checkout#31 follow:
//
//   · what goes wrong while SAVING a form is painted INSIDE that form, above the button that was
//     pressed, and scrolled into view once — not again on every keystroke (rv-reservations-73);
//   · what goes wrong OUTSIDE the save stays on the PAGE: a refused row action on a rule
//     («Restore», «Deactivate», «Set end date», «Repair») and a list that does not load. No panel
//     is open then, and a notice inside a closed panel is just as invisible (rv-appointments-227).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataTableShowsLoadError } from '@erplora/module-sdk';

const CATEGORY = { id: 'tc1', key: 'standard', name: 'Standard', description: '', is_system: 0, is_active: 1 };
const RULE = {
  id: 'r-es',
  country_code: 'ES',
  region_code: null,
  tax_category_key: 'standard',
  rate_pct: 21,
  tax_type: 'vat',
  operation_class: 'subject',
  valid_from: '2020-01-01',
  valid_to: null,
  parent_id: null,
  is_active: 1,
};
const ALIAS = { id: 'a1', alias: 'IVA 21', tax_category_key: 'standard', source: 'learned', is_active: 1 };

const REFUSAL = 'A manager has to approve this.';

let refuse: string | null = null;
/** When set, the next command waits on it: lets a test look at the screen while a save is in flight. */
let hold: Promise<void> | null = null;
let loadFails = false;
/** How many times each list was read (paged and whole): an action that goes through reloads them. */
let pageReads: Record<string, number> = {};
let allReads: Record<string, number> = {};
let commands: string[] = [];
/** Every element the component scrolled into view. */
let revealed: Element[] = [];
/** Whether each revealed element had already painted itself when it was scrolled to. */
let paintedWhenRevealed: boolean[] = [];

const ROWS: Record<string, unknown[]> = {
  'taxes.categories.list': [CATEGORY],
  'taxes.rules.list': [RULE],
  'taxes.aliases.list': [ALIAS],
};

beforeEach(() => {
  refuse = null;
  hold = null;
  loadFails = false;
  pageReads = {};
  allReads = {};
  commands = [];
  revealed = [];
  paintedWhenRevealed = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    revealed.push(this);
    // ok-inline-feedback lays itself out in its own update: scrolled to before it, a phone scrolls to
    // an empty, zero-height box and the notice ends up off the sheet anyway (online_booking#33).
    paintedWhenRevealed.push((this as unknown as { hasUpdated?: boolean }).hasUpdated !== false);
  });
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => {
      allReads[name] = (allReads[name] ?? 0) + 1;
      return ROWS[name] ?? [];
    },
    queryPage: async (name: string) => {
      pageReads[name] = (pageReads[name] ?? 0) + 1;
      if (loadFails) throw new Error(REFUSAL);
      const rows = ROWS[name] ?? [];
      return { rows, total: rows.length };
    },
    command: async (name: string) => {
      commands.push(name);
      const wait = hold;
      if (wait) await wait;
      if (refuse) throw new Error(refuse);
      return {};
    },
    on: () => () => {},
    hasPermission: () => true,
    locale: 'es',
    t: (_c: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, any>;

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const submitEvent = (): Event => new Event('submit', { cancelable: true });

const CREATE = 'form[slot="create"]';

/** The notice inside `scope`, or null. */
const inside = (el: Wc, scope: string, testid: string): Element | null =>
  el.shadowRoot.querySelector(`${scope} [data-testid="${testid}"]`);

/** Every place a notice with `text` is painted in, by where it sits. */
function whereIs(el: Wc, text: string): string[] {
  return [...el.shadowRoot.querySelectorAll('ok-inline-feedback')]
    .filter((n) => n.textContent?.trim() === text)
    .map((n) => (n.closest(CREATE) ? 'panel' : 'page'));
}

/** The notice sits above the button of its form. */
function aboveTheButton(form: Element, testid: string): boolean {
  const kids = [...form.children];
  const notice = kids.findIndex((k) => k.getAttribute('data-testid') === testid);
  const button = kids.findIndex((k) => k.tagName === 'ION-BUTTON' && k.getAttribute('type') === 'submit');
  return notice >= 0 && button >= 0 && notice < button;
}

interface Screen {
  name: string;
  tag: string;
  path: string;
  formError: string;
  loadError: string;
  /** Fills the form with what the save needs and returns the save. */
  save: (el: Wc) => Promise<unknown>;
  /** Edits one field of the form, as a keystroke would. */
  edit: (el: Wc, n: number) => void;
}

const SCREENS: Screen[] = [
  {
    name: 'Categories',
    tag: 'erp-taxes-categories',
    path: './components/erp-taxes-categories/erp-taxes-categories',
    formError: 'taxes-categories-form-error',
    loadError: 'taxes-categories-load-error',
    save: (el) => {
      el.newKey = 'restaurant.food';
      el.newName = 'Food';
      return el.createCategory(submitEvent());
    },
    edit: (el, n) => (el.newName = `Food ${n}`),
  },
  {
    name: 'Tax rules',
    tag: 'erp-taxes-rules',
    path: './components/erp-taxes-rules/erp-taxes-rules',
    formError: 'taxes-rules-form-error',
    loadError: 'taxes-rules-load-error',
    save: (el) => {
      el.newCountry = 'PT';
      el.newCategoryKey = 'standard';
      el.newRatePct = '23';
      return el.createRule(submitEvent());
    },
    edit: (el, n) => (el.newRatePct = String(20 + n)),
  },
  {
    name: 'Aliases',
    tag: 'erp-taxes-aliases',
    path: './components/erp-taxes-aliases/erp-taxes-aliases',
    formError: 'taxes-aliases-form-error',
    loadError: 'taxes-aliases-load-error',
    save: (el) => {
      el.newAlias = 'IVA 10';
      el.newCategoryKey = 'standard';
      return el.createAlias(submitEvent());
    },
    edit: (el, n) => (el.newAlias = `IVA ${n}`),
  },
];

async function mount(s: Screen): Promise<Wc> {
  await import(/* @vite-ignore */ s.path);
  const el = document.createElement(s.tag) as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

async function refusedSave(s: Screen, el: Wc): Promise<void> {
  refuse = REFUSAL;
  await s.save(el);
  await settle(el);
}

describe.each(SCREENS)('pm#513 · $name: a refused «Add» is shown INSIDE the panel form', (s) => {
  it('lands in the form, with its text, painted and scrolled into view — nothing on the page under the sheet', async () => {
    const el = await mount(s);
    await refusedSave(s, el);
    const notice = inside(el, CREATE, s.formError);
    expect(notice, 'on a phone the panel covers the page: the refusal has to travel with the form').not.toBeNull();
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(revealed, 'and it is scrolled into view').toEqual([notice]);
    expect(paintedWhenRevealed, 'once it has painted itself').toEqual([true]);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('sits above the «Add» button that was pressed', async () => {
    const el = await mount(s);
    await refusedSave(s, el);
    expect(aboveTheButton(el.shadowRoot.querySelector(CREATE)!, s.formError)).toBe(true);
  });

  it('is revealed once, not again on every keystroke while the person corrects the form', async () => {
    const el = await mount(s);
    await refusedSave(s, el);
    revealed = [];
    s.edit(el, 1);
    await settle(el);
    s.edit(el, 2);
    await settle(el);
    expect(inside(el, CREATE, s.formError), 'the refusal is still there').not.toBeNull();
    expect(revealed, 'but the sheet stays where the person is typing').toEqual([]);
  });

  it('a second refusal with a different reason is revealed again', async () => {
    const el = await mount(s);
    await refusedSave(s, el);
    revealed = [];
    refuse = 'That one already exists.';
    await s.save(el);
    await settle(el);
    expect(revealed).toEqual([inside(el, CREATE, s.formError)]);
  });

  it('while the new attempt is being saved, the previous refusal is already gone', async () => {
    const el = await mount(s);
    await refusedSave(s, el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const attempt = s.save(el);
    await settle(el);
    expect(inside(el, CREATE, s.formError)).toBeNull();
    release();
    await attempt;
  });

  it('a list that does not load is shown on the page, not in the form', async () => {
    loadFails = true;
    const el = await mount(s);
    // pm#533: an OutfitKit whose table paints the load error itself gets the reason there, and the
    // page adds no notice of its own; an older one keeps the notice on the page.
    if (dataTableShowsLoadError()) {
      expect((el.shadowRoot.querySelector('ok-data-table') as unknown as { error?: string }).error).toBe(REFUSAL);
      expect(inside(el, '.page', s.loadError), 'the reason would be said twice').toBeNull();
    } else {
      expect(inside(el, '.page', s.loadError)?.textContent?.trim()).toBe(REFUSAL);
      expect(whereIs(el, REFUSAL)).toEqual(['page']);
    }
    expect(inside(el, CREATE, s.formError)).toBeNull();
  });
});

// Tax rules is the only screen with row actions: each one is answered with no panel open.
const RULES = SCREENS[1];

type RowAction = { id: string; command: string; run: (el: Wc) => Promise<unknown> };

const ROW_ACTIONS: RowAction[] = [
  { id: 'restore', command: 'taxes.rules.activate', run: (el) => el.restoreRule({ ...RULE, is_active: 0 }) },
  {
    id: 'deactivate',
    command: 'taxes.rules.deactivate',
    run: (el) => {
      el.pendingDeactivate = RULE;
      return el.onDeactivateDismiss(new CustomEvent('ionAlertDidDismiss', { detail: { role: 'confirm' } }));
    },
  },
  {
    id: 'end',
    command: 'taxes.rules.end',
    run: (el) => {
      el.pendingEnd = RULE;
      return el.onEndDismiss(
        new CustomEvent('ionAlertDidDismiss', { detail: { role: 'confirm', data: { values: { valid_to: '2026-12-31' } } } }),
      );
    },
  },
  {
    id: 'repair',
    command: 'taxes.rules.repair',
    run: (el) => {
      el.pendingRepair = RULE;
      return el.onRepairDismiss(new CustomEvent('ionAlertDidDismiss', { detail: { role: 'no_tax' } }));
    },
  },
];

async function rowAction(el: Wc, a: RowAction): Promise<void> {
  await a.run(el);
  await settle(el);
}

describe.each(ROW_ACTIONS)('pm#513 · Tax rules: a refused «$id» from a row stays on the page (rv-appointments-227)', (a) => {
  it('is shown on the page, not in the (closed) panel', async () => {
    const el = await mount(RULES);
    refuse = REFUSAL;
    await rowAction(el, a);
    expect(commands).toEqual([a.command]);
    const notice = inside(el, '.page', 'taxes-rules-error');
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(inside(el, CREATE, RULES.formError)).toBeNull();
    // Above the list, where it was before: under a long list of cards on a phone it is never seen.
    const table = el.shadowRoot.querySelector('ok-data-table')!;
    expect(notice!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING, 'the refusal sits above the rules').toBeTruthy();
  });

  it('a new row action clears the previous refusal while it runs', async () => {
    const el = await mount(RULES);
    refuse = REFUSAL;
    await rowAction(el, a);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const action = a.run(el);
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
    release();
    await action;
  });

  it('does not wipe a refusal the person is still reading in the form', async () => {
    const el = await mount(RULES);
    await refusedSave(RULES, el);
    refuse = null;
    await rowAction(el, a);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('when it goes through, it reloads the page of rules and the whole hub (the banners count every rule)', async () => {
    const el = await mount(RULES);
    const page = pageReads['taxes.rules.list'] ?? 0;
    const all = allReads['taxes.rules.list'] ?? 0;
    await rowAction(el, a);
    expect(pageReads['taxes.rules.list'], 'the rule would keep its old state in the table').toBe(page + 1);
    expect(allReads['taxes.rules.list'], 'the overlap/incoherence banners would keep counting it').toBe(all + 1);
  });
});

describe('pm#513 · Tax rules: page and form notices do not leak into each other', () => {
  it('a save that goes through also clears the page notice of an earlier refused row action (staff#75)', async () => {
    const el = await mount(RULES);
    refuse = REFUSAL;
    await rowAction(el, ROW_ACTIONS[0]);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    refuse = null;
    await RULES.save(el);
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
  });
});
