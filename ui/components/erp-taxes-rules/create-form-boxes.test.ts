// taxes#73 — every field of the "new rule" form shows its BOX.
//
// The Hub shell pins `mode: 'ios'` (ADR-0143), and there Ionic never paints `fill` on
// ion-input/ion-select/ion-textarea: a control with no `fill` renders as loose text with no border
// (the «%» rate and «Calificación» were exactly that, next to boxed siblings), and a `fill` alone is
// only rescued by the shell's registration shim (hub#1060). The combination that paints on its own
// is `fill="outline" mode="md"`, the convention of the shell (hub#760) and of the modules swept by
// ERPlora/pm#152 — and the one the module-toolkit ratchet asks for.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIES = [{ id: 'c1', key: 'product.generic', name: 'Generic product' }];

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIES : []),
    queryPage: async () => ({ rows: [], total: 0 }),
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale: 'en',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

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
const fieldsOf = (el: Wc) => [...form(el).querySelectorAll('ion-input, ion-select, ion-textarea')];

function expectBox(f: Element): void {
  const id = f.getAttribute('data-testid') ?? f.tagName;
  expect(f.getAttribute('fill'), `${id}: no fill → no box in ios mode`).toBe('outline');
  expect(f.getAttribute('mode'), `${id}: fill without mode="md" never paints in ios mode`).toBe('md');
}

describe('new rule form: every field has its box in ios mode (taxes#73)', () => {
  it('the rate and the fiscal qualification are boxed', async () => {
    const el = await mount();
    for (const id of ['taxes-rules-rate', 'taxes-rules-operation-class']) {
      const f = form(el).querySelector(`[data-testid="${id}"]`);
      expect(f, `${id} is in the form`).not.toBeNull();
      expectBox(f!);
    }
  });

  it('every control of the form, including the exempt reason shown for exempt rules', async () => {
    const el = await mount();
    const select = form(el).querySelector('[data-testid="taxes-rules-operation-class"]') as HTMLElement & { value: string };
    select.value = 'exempt';
    select.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'exempt' } }));
    await el.updateComplete;
    const fields = fieldsOf(el);
    expect(fields.map((f) => f.getAttribute('data-testid'))).toContain('taxes-rules-exempt-reason');
    for (const f of fields) expectBox(f);
  });
});
