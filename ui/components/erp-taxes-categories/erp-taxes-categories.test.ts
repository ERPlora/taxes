// Contrato de la BARRA de las categorías fiscales (taxes.categories).
//
// El alta de una categoría vive DENTRO de `ok-data-table`, detrás del «+» de su barra (panel
// `slot="create"`), igual que /employees del core y el CRUD de productos de `inventory`: ningún
// formulario suelto encima de la tabla, ningún título propio (lo pinta el topbar del shell).
//
// El único campo de dominio cerrado de esta tabla es «Activa» (sí/no) y ya se filtra con un
// `select`; aquí se blinda para que no vuelva a ser texto libre.
//
// El payload de `taxes.categories.create` es contrato fiscal: se comprueba para que un retoque de
// colocación no lo mueva. La identidad enlazable de una categoría es su `key` canónica (ADR-0085),
// no un `code` libre: `schemas/category_create.json` exige `key` y es `additionalProperties:false`.
import { beforeEach, describe, expect, it } from 'vitest';

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({
      rows: [{ id: 'k1', key: 'standard', name: 'IVA general', description: '', is_system: 1, is_active: 1 }],
      total: 1,
    }),
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
  await import('./erp-taxes-categories');
  const el = document.createElement('erp-taxes-categories');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Tabla = HTMLElement & { addable: boolean; fill: boolean; close: () => void };
const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as Tabla | null;

type Col = { key: string; filterType?: string; options?: { value: string; label: string }[] };
const columnas = (el: HTMLElement) => (el as unknown as { columns: Col[] }).columns;

describe('el alta vive DENTRO de la tabla (paridad con /employees e inventory)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('la tabla llena el alto (`fill`): scroll interno, pie fijo', async () => {
    const el = await montar();
    expect(tabla(el)?.fill).toBe(true);
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

  it('el título lo pinta el topbar del shell: la vista no repite su <h2>', async () => {
    const el = await montar();
    expect(el.shadowRoot.querySelector('h2'), 'la vista pinta un título duplicado').toBeNull();
  });
});

describe('los filtros de dominio cerrado son `select`', () => {
  it('«activa» se filtra con un select sí/no, no tecleando 1 o 0', async () => {
    const el = await montar();
    const activa = columnas(el).find((c) => c.key === 'is_active');
    expect(activa?.filterType).toBe('select');
    expect(activa?.options?.map((o) => o.value)).toEqual(['1', '0']);
  });
});

describe('el alta sigue funcionando desde el panel, sin tocar el payload fiscal', () => {
  it('crear una categoría manda taxes.categories.create y cierra el panel', async () => {
    const el = await montar();
    const t = tabla(el)!;
    let cerrado = false;
    t.close = () => {
      cerrado = true;
    };

    const wc = el as unknown as {
      newKey: string;
      newName: string;
      newDescription: string;
      createCategory: (ev: Event) => Promise<void>;
    };
    wc.newKey = 'restaurant.food';
    wc.newName = 'IVA reducido';
    wc.newDescription = 'Alimentación';
    await wc.createCategory(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'taxes.categories.create');
    expect(alta, 'no se mandó el alta de la categoría fiscal').toBeTruthy();
    expect(alta!.payload).toEqual({ key: 'restaurant.food', name: 'IVA reducido', description: 'Alimentación' });
    expect(cerrado, 'el panel de alta se queda abierto tras crear').toBe(true);
  });
});

describe('la tabla manda el tamaño de página', () => {
  it('pageSizeChange llega al controlador de lista', async () => {
    const el = await montar();
    tabla(el)!.dispatchEvent(new CustomEvent('pageSizeChange', { detail: 25 }));
    const ctrl = (el as unknown as { ctrl: { state: { pageSize: number } } }).ctrl;
    expect(ctrl.state.pageSize, 'la tabla no propaga el tamaño de página').toBe(25);
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
