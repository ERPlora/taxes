// Contrato de la BARRA de las reglas de aplicación (taxes.rules).
//
// El alta de una regla vive DENTRO de `ok-data-table`, detrás del «+» de su barra (panel
// `slot="create"`), igual que /employees del core y el CRUD de productos de `inventory`: ningún
// formulario suelto encima de la tabla, ningún título propio (lo pinta el topbar del shell).
//
// MODELO (ADR-0085): una regla es país + región + CATEGORÍA fiscal (`tax_category_key`) → `rate_pct`.
// `taxes.rates` / `tax_rate_id` están RETIRADOS. La categoría es dominio cerrado —la FK (hub_id,
// tax_category_key) → taxes_category la valida— así que se ELIGE con un `select`, tanto en el alta
// como en el filtro (el servidor la declara `op: eq` en module.json, así que el filtro es real).
// Lo que el servidor NO declara como filtro (la vigencia) no se pinta filtrable: un filtro muerto
// —que el servidor ignora en silencio— es peor que ningún filtro.
//
// El payload de `taxes.rules.create` (decide qué % de IVA se aplica → AEAT) es intocable: se
// comprueba aquí.
import { beforeEach, describe, expect, it } from 'vitest';

const CATEGORIAS = [
  { id: 'c1', key: 'restaurant.food', name: 'Comida' },
  { id: 'c2', key: 'standard', name: 'IVA general' },
];

const REGLA = {
  id: 'u1',
  country_code: 'ES',
  region_code: '',
  tax_category_key: 'restaurant.food',
  rate_pct: '10.00',
  tax_type: 'vat',
  parent_id: '',
  component_label: '',
  valid_from: '',
  valid_to: '',
  is_active: 1,
};

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => (name === 'taxes.categories.list' ? CATEGORIAS : []),
    queryPage: async () => ({ rows: [REGLA], total: 1 }),
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

type Tabla = HTMLElement & { addable: boolean; fill: boolean; close: () => void };
const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as Tabla | null;

type Col = { key: string; filterable?: boolean; filterType?: string; options?: { value: string; label: string }[] };
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

describe('filtros: los de dominio cerrado son `select`; los que el servidor no soporta, no se declaran', () => {
  it('«activa» se filtra con un select sí/no', async () => {
    const el = await montar();
    const activa = columnas(el).find((c) => c.key === 'is_active');
    expect(activa?.filterType).toBe('select');
    expect(activa?.options?.map((o) => o.value)).toEqual(['1', '0']);
  });

  it('la categoría se filtra con un select poblado con las categorías reales, no tecleando la clave', async () => {
    const el = await montar();
    const cat = columnas(el).find((c) => c.key === 'tax_category_key');
    expect(cat?.filterType).toBe('select');
    expect(cat?.options?.map((o) => o.value)).toEqual(['restaurant.food', 'standard']);
  });

  it('la vigencia NO se declara filtrable: module.json no la declara y el servidor la ignoraría', async () => {
    const el = await montar();
    for (const key of ['valid_from', 'valid_to']) {
      const col = columnas(el).find((c) => c.key === key);
      expect(col, `la columna ${key} ha desaparecido`).toBeTruthy();
      expect(col?.filterable, `filtro muerto: module.json no declara un filtro para ${key}`).toBeFalsy();
    }
  });
});

describe('el alta sigue funcionando desde el panel, sin tocar el payload fiscal', () => {
  it('el alta elige la categoría con un select poblado con las categorías reales', async () => {
    const el = await montar();
    const opciones = [
      ...el.shadowRoot.querySelectorAll('form[slot="create"] ion-select[label="ui.colCategory"] ion-select-option'),
    ];
    expect(opciones.length, 'el alta no ofrece las categorías fiscales existentes').toBe(CATEGORIAS.length);
  });

  it('crear una regla manda taxes.rules.create (país+categoría+%) y cierra el panel', async () => {
    const el = await montar();
    const t = tabla(el)!;
    let cerrado = false;
    t.close = () => {
      cerrado = true;
    };

    const wc = el as unknown as {
      newCountry: string;
      newCategoryKey: string;
      newRatePct: string;
      newTaxType: string;
      createRule: (ev: Event) => Promise<void>;
    };
    wc.newCountry = 'es';
    wc.newCategoryKey = 'restaurant.food';
    wc.newRatePct = '10';
    wc.newTaxType = 'vat';
    await wc.createRule(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'taxes.rules.create');
    expect(alta, 'no se mandó el alta de la regla fiscal').toBeTruthy();
    expect(alta!.payload).toEqual({
      country_code: 'ES', // el país viaja normalizado: el schema exige ISO-2 en mayúsculas
      tax_category_key: 'restaurant.food',
      rate_pct: 10,
      tax_type: 'vat',
    });
    expect(cerrado, 'el panel de alta se queda abierto tras crear').toBe(true);
  });

  it('sin categoría no se manda nada y el panel NO se cierra', async () => {
    const el = await montar();
    const t = tabla(el)!;
    let cerrado = false;
    t.close = () => {
      cerrado = true;
    };

    const wc = el as unknown as {
      newCountry: string;
      newCategoryKey: string;
      newRatePct: string;
      createRule: (ev: Event) => Promise<void>;
    };
    wc.newCountry = 'ES';
    wc.newCategoryKey = ''; // la FK la rechazaría: mejor no mandarla
    wc.newRatePct = '10';
    await wc.createRule(new Event('submit'));

    expect(comandos, 'se mandó una regla sin categoría fiscal').toEqual([]);
    expect(cerrado, 'se cerró el panel escondiendo el error de validación').toBe(false);
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
