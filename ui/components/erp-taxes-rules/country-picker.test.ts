// The country of a rule is CHOSEN, never typed (taxes#41).
//
// The box was an `ion-input maxlength="2"`, so `ZZ` was two keystrokes away — and `ZZ` is not a
// country: ISO 3166-1 leaves it unassigned. The rule was created, appeared in the list, satisfied
// the setup checklist, and never matched anything, because `taxes.calculate` resolves by
// `country + region + category` (ADR-0085) against the hub's own fiscal identity. Nothing failed,
// which is why nobody found out.
//
// `schemas/rule_create.json` now refuses it with `422 invalid_payload`. But a refusal is the wrong
// place to learn that Zamzibar does not exist: the form has to offer the 249 that do, the way the
// category next to it has been chosen from a closed list since taxes#11. Same reason, same shape.
//
// It is a COMBO, not an `ion-select`: 249 options in a plain select is a scroll nobody finishes,
// and `ok-combo` is the searchable one OutfitKit already ships — no new component for this.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNTRY_CODES } from '../../lib/countries';

const ROOT = join(__dirname, '../../..');
const source = readFileSync(join(__dirname, 'erp-taxes-rules.ts'), 'utf8');
// The catalogues are nested (`{ ui: { colCountry: … } }`); the component addresses them as `ui.*`.
const read = (f: string) => (JSON.parse(readFileSync(join(ROOT, 'locales', f), 'utf8')) as { ui: Record<string, string> }).ui;
const en = read('en.json');
const es = read('es.json');

const CATEGORIAS = [{ id: 'c1', key: 'restaurant.food', name: 'Comida' }];
const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIAS : []),
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function montar() {
  await import('./erp-taxes-rules');
  const el = document.createElement('erp-taxes-rules');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Combo = HTMLElement & { options: { value: string; label: string }[]; value: string };
const combo = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('form[slot="create"] ok-combo') as Combo | null;

describe('the country is picked from a closed list', () => {
  it('the create form carries an ok-combo for the country', async () => {
    const el = await montar();
    expect(combo(el), 'the country is still a free-text box: `ZZ` is two keystrokes away').toBeTruthy();
  });

  it('and no free-text two-character country box is left behind', () => {
    expect(source, 'a `maxlength="2"` input is the old country box').not.toMatch(/maxlength="2"[^>]*colCountry|colCountry[^>]*maxlength="2"/);
  });

  // The SET, not the order: the list is sorted by the name the reader sees (`countries.test.ts`
  // pins that), which is not code order — Alemania comes before Bélgica.
  it('it offers the 249 codes the command accepts, and not one more', async () => {
    const el = await montar();
    const offered = combo(el)?.options.map((o) => o.value) ?? [];
    expect(offered).toHaveLength(COUNTRY_CODES.length);
    expect([...offered].sort()).toEqual([...COUNTRY_CODES].sort());
  });

  it('`ZZ` — the code taxes#41 was filed with — is not among them', async () => {
    const el = await montar();
    const values = combo(el)?.options.map((o) => o.value) ?? [];
    expect(values).not.toContain('ZZ');
    expect(values).toContain('ES');
  });

  it('choosing one sends it uppercased in the payload, as the schema demands', async () => {
    const el = await montar();
    combo(el)!.dispatchEvent(new CustomEvent('ok-change', { detail: { value: 'PT', label: 'Portugal (PT)' } }));
    const wc = el as unknown as {
      newCategoryKey: string;
      newRatePct: string;
      createRule: (ev: Event) => Promise<void>;
    };
    wc.newCategoryKey = 'restaurant.food';
    wc.newRatePct = '23';
    await wc.createRule(new Event('submit'));
    expect(comandos.find((c) => c.name === 'taxes.rules.create')?.payload).toMatchObject({ country_code: 'PT' });
  });

  it('and with no country chosen nothing is sent — the panel keeps the error visible', async () => {
    const el = await montar();
    const wc = el as unknown as { newCategoryKey: string; newRatePct: string; createRule: (ev: Event) => Promise<void> };
    wc.newCategoryKey = 'restaurant.food';
    wc.newRatePct = '21';
    await wc.createRule(new Event('submit'));
    expect(comandos, 'a rule was created without a jurisdiction').toEqual([]);
  });
});

describe('the region says what shape it wants (ISO 3166-2, the core’s own)', () => {
  // `crates/runtime/src/settings.rs::validate_region` takes `ES-CN`, and so does the schema now.
  // A person typing «Canarias» — or the bare «CN» — writes a region no hub can hold: the same
  // silence as `ZZ`, one field to the right. The placeholder is what stops that before the 422.
  it('the placeholder shows a real subdivision', () => {
    expect(String(es.phRegion ?? ''), 'the Spanish hint does not show the ES-CN shape').toContain('ES-CN');
    expect(String(en.phRegion ?? ''), 'the English hint does not show the ES-CN shape').toContain('ES-CN');
  });
});

describe('every string the picker adds is translated (ADR-0055)', () => {
  it('has its `en` source and its `es` translation', () => {
    const keys = [...source.matchAll(/t\('(ui\.[A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
    const bare = [...new Set(keys)].map((k) => k.slice('ui.'.length));
    const missingEn = bare.filter((k) => !(k in en));
    const missingEs = bare.filter((k) => !(k in es));
    expect(missingEn, 'keys with no English source').toEqual([]);
    expect(missingEs, 'keys with no Spanish translation').toEqual([]);
  });
});
