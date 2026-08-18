// Contrato de la BARRA de la lista de alias fiscales (ADR-0085).
//
// Un alias mapea un texto libre (la columna de un CSV de import) a una `tax_category_key` canónica:
// si el mapeo se da de alta mal, el import mete el IVA equivocado y eso acaba en la AEAT. Por eso el
// alta va donde va el resto del Hub —DENTRO de `ok-data-table`, detrás del «+» de su barra, en el
// panel `slot="create"`— y no en un formulario suelto flotando encima de la tabla: en el panel el
// campo se ve entero, y la categoría se ELIGE de las reales del hub en vez de teclear la key a mano.
//
// El dominio de `tax_category_key` es cerrado (son las categorías fiscales del hub) y el servidor lo
// filtra por `eq` (`module.json` → `taxes.aliases.list.filters`), así que el filtro es un `select`
// poblado con las categorías reales, no un campo de texto.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIAS = [
  { id: 'tc1', key: 'standard', name: 'IVA general' },
  { id: 'tc2', key: 'reduced', name: 'IVA reducido' },
];

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async (name: string) =>
      name === 'taxes.categories.list'
        ? { rows: CATEGORIAS, total: CATEGORIAS.length }
        : {
            rows: [{ id: 'a1', alias: 'IVA 21', tax_category_key: 'standard', source: 'learned', is_active: 1 }],
            total: 1,
          },
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
  await import('./erp-taxes-aliases');
  const el = document.createElement('erp-taxes-aliases');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as (HTMLElement & { addable: boolean }) | null;

describe('el alta de alias vive DENTRO de la tabla (paridad con el resto del Hub)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('el formulario de alta se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de alta no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario de alta cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN control de alta suelto fuera de la tabla', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('form, ion-input, ion-select, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'hay controles de alta fuera de la tabla').toEqual([]);
  });
});

describe('la categoría fiscal se ELIGE, no se teclea', () => {
  it('el filtro de categoría es un select poblado con las categorías reales del hub', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; filterType?: string; options?: { value: string }[] }[] }).columns;
    const cat = cols.find((c) => c.key === 'tax_category_key');
    expect(cat?.filterType, 'la key fiscal se filtra tecleando texto libre').toBe('select');
    expect(cat?.options?.map((o) => o.value), 'el select no ofrece las categorías reales').toEqual(['standard', 'reduced']);
  });
});

describe('el alta sigue mandando el comando correcto', () => {
  it('crear un alias manda taxes.aliases.create con alias, key y origen', async () => {
    const el = await montar();
    const wc = el as unknown as { newAlias: string; newCategoryKey: string; newSource: string;
                                  createAlias: (ev: Event) => Promise<void> };
    wc.newAlias = 'IVA 21';
    wc.newCategoryKey = 'standard';
    wc.newSource = 'learned';
    await wc.createAlias(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'taxes.aliases.create');
    expect(alta, 'no se mandó el alta del alias').toBeTruthy();
    expect(alta!.payload).toMatchObject({ alias: 'IVA 21', tax_category_key: 'standard', source: 'learned' });
  });
});

// taxes#11 — the «+» follows the effective permission (`erplora.hasPermission`, same pattern as
// customers/inventory): a viewer (taxes.view_tax only) gets a read-only table.
describe('effective permission (taxes#11)', () => {
  it('hides the «+» when the user cannot manage taxes', async () => {
    (globalThis as Record<string, any>).erplora.hasPermission = () => false;
    const el = await montar();
    expect(tabla(el)?.addable, 'a viewer still sees the «+»').toBe(false);
  });

  it('keeps the «+» when the user can manage taxes', async () => {
    (globalThis as Record<string, any>).erplora.hasPermission = (p: string) => p === 'taxes.manage_tax';
    const el = await montar();
    expect(tabla(el)?.addable).toBe(true);
  });
});
