// Un hub en español NO enseña «Product — generic» en ninguna de las tres pantallas (taxes#30).
//
// Las 10 categorías canónicas se siembran con el nombre en inglés (ADR-0055: el dato nace en el
// idioma fuente). Sin capa de presentación, ese literal salía tal cual en /m/taxes/categories, en
// el filtro y el alta de reglas y en el alta de alias — y, por la misma puerta, en el selector
// «Departamento (IVA)» del TPV, en la línea del carrito y en el TIQUE IMPRESO del cliente.
//
// Estos tests montan los tres componentes con el catálogo REAL del módulo (no con el `t` de juguete
// que devuelve la clave: con ése el fallback al `name` del dato es correcto y no probaría nada) y
// comprueban que el literal inglés no aparece por ninguna parte. El control de positivo va incluido:
// con `locale: 'en'` el mismo texto SÍ aparece, así que la comprobación detecta lo que busca.
//
// Lo que se deja pasar tal cual: las categorías que crea el usuario. No tienen clave canónica, su
// texto es suyo y ni se traduce ni se toca.
import { beforeEach, describe, expect, it } from 'vitest';
import enLocale from '../../locales/en.json';
import esLocale from '../../locales/es.json';

const CATALOG: Record<string, unknown> = { en: enLocale, es: esLocale };

/** Las de sistema tal y como salen del seed, más una del usuario que NO se debe tocar. */
const CATEGORIES = [
  { id: 'c1', key: 'product.generic', name: 'Product — generic', description: '', is_system: 1, is_active: 1 },
  { id: 'c2', key: 'restaurant.alcohol', name: 'Restaurant — alcohol', description: '', is_system: 1, is_active: 1 },
  {
    id: 'c3',
    key: 'service.education',
    name: 'Service — education (VAT exempt)',
    description: 'Regulated teaching and training — art. 20.Uno.9 (ES)',
    is_system: 1,
    is_active: 1,
  },
  { id: 'c4', key: 'catering_bodas', name: 'Catering de bodas', description: 'Solo banquetes', is_system: 0, is_active: 1 },
];

const RULES = [
  { id: 'r1', country_code: 'ES', region_code: '', tax_category_key: 'product.generic', rate_pct: '21.00', tax_type: 'vat', parent_id: '', component_label: '', valid_from: '', valid_to: '', is_active: 1 },
];

const ALIASES = [
  { id: 'a1', alias: 'IVA 21', tax_category_key: 'product.generic', source: 'learned', is_active: 1 },
];

/** El literal inglés del seed que el cliente NO debe leer en un hub español. */
const INGLES_DEL_SEED = 'Product — generic';

function stubShell(locale: 'es' | 'en') {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryAll: async (name: string) => {
      if (name === 'taxes.categories.list') return CATEGORIES;
      if (name === 'taxes.rules.list') return RULES;
      return [];
    },
    queryPage: async (name: string) => {
      if (name === 'taxes.categories.list') return { rows: CATEGORIES, total: CATEGORIES.length };
      if (name === 'taxes.rules.list') return { rows: RULES, total: RULES.length };
      return { rows: ALIASES, total: ALIASES.length };
    },
    command: async () => ({}),
    on: () => () => {},
    hasPermission: () => true,
    locale,
    // El `t` de verdad del shell: baja por el catálogo partiendo la clave por puntos.
    t: (catalog: Record<string, unknown>, key: string) => {
      const dict = (catalog[locale] ?? catalog.en ?? {}) as Record<string, unknown>;
      let cur: unknown = dict;
      for (const part of key.split('.')) {
        cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
      }
      return typeof cur === 'string' ? cur : key;
    },
  };
}

async function montar(tag: 'erp-taxes-categories' | 'erp-taxes-rules' | 'erp-taxes-aliases') {
  if (tag === 'erp-taxes-categories') await import('./erp-taxes-categories/erp-taxes-categories');
  else if (tag === 'erp-taxes-rules') await import('./erp-taxes-rules/erp-taxes-rules');
  else await import('./erp-taxes-aliases/erp-taxes-aliases');
  const el = document.createElement(tag);
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Col = { key: string; options?: { value: string; label: string }[]; format?: (r: Record<string, unknown>) => string };
const columnas = (el: HTMLElement) => (el as unknown as { columns: Col[] }).columns;

/** Todo el texto pintado por el componente + las etiquetas de sus columnas y filtros: la tabla es
 *  un WC de OutfitKit (no renderiza aquí), así que su contenido hay que leerlo de las props. */
function textoVisible(el: HTMLElement & { shadowRoot: ShadowRoot }): string {
  const cols = columnas(el) ?? [];
  const deColumnas = cols.flatMap((c) => [
    ...(c.options ?? []).map((o) => o.label),
    ...CATEGORIES.map((row) => {
      try {
        return c.format ? c.format(row as unknown as Record<string, unknown>) : String((row as Record<string, unknown>)[c.key] ?? '');
      } catch {
        return '';
      }
    }),
  ]);
  return [el.shadowRoot.textContent ?? '', ...deColumnas].join('\n');
}

describe('/m/taxes/categories — la tabla de categorías', () => {
  beforeEach(() => stubShell('es'));

  it('no pinta el nombre inglés del seed en la columna «Nombre»', async () => {
    const el = await montar('erp-taxes-categories');
    const col = columnas(el).find((c) => c.key === 'name')!;
    expect(col.format, 'la columna «Nombre» pinta el dato crudo: no tiene capa de presentación').toBeTruthy();
    expect(col.format!(CATEGORIES[0] as unknown as Record<string, unknown>)).toBe('Producto — general');
    expect(col.format!(CATEGORIES[1] as unknown as Record<string, unknown>)).toBe('Restauración — alcohol');
  });

  it('traduce también la descripción LEGAL de las exentas', async () => {
    const el = await montar('erp-taxes-categories');
    const col = columnas(el).find((c) => c.key === 'description')!;
    const shown = col.format!(CATEGORIES[2] as unknown as Record<string, unknown>);
    expect(shown, 'la descripción legal sigue en inglés').not.toContain('Regulated teaching');
    expect(shown, 'se perdió la cita del artículo, que es lo que la hace útil').toContain('art. 20.Uno.9');
  });

  it('la VISTA DE TARJETAS (móvil) tampoco: el título de la tarjeta es el mismo nombre traducido', async () => {
    const el = await montar('erp-taxes-categories');
    const cardTitle = (el.shadowRoot.querySelector('ok-data-table') as unknown as {
      cardTitle: (row: Record<string, unknown>) => string;
    }).cardTitle;
    expect(cardTitle(CATEGORIES[0] as unknown as Record<string, unknown>)).toBe('Producto — general');
    expect(cardTitle(CATEGORIES[3] as unknown as Record<string, unknown>)).toBe('Catering de bodas');
  });

  it('la categoría del USUARIO sale con su texto tal cual, sin inventarle traducción', async () => {
    const el = await montar('erp-taxes-categories');
    const nombre = columnas(el).find((c) => c.key === 'name')!;
    const desc = columnas(el).find((c) => c.key === 'description')!;
    expect(nombre.format!(CATEGORIES[3] as unknown as Record<string, unknown>)).toBe('Catering de bodas');
    expect(desc.format!(CATEGORIES[3] as unknown as Record<string, unknown>)).toBe('Solo banquetes');
  });
});

describe('/m/taxes/rules — filtro y alta de reglas', () => {
  beforeEach(() => stubShell('es'));

  it('ni el filtro por categoría ni el desplegable del alta llevan el literal inglés', async () => {
    const el = await montar('erp-taxes-rules');
    expect(textoVisible(el)).not.toContain(INGLES_DEL_SEED);
    const filtro = columnas(el).find((c) => c.key === 'tax_category_key')!;
    expect(filtro.options?.map((o) => o.label).join(' ')).toContain('Producto — general');
  });
});

describe('/m/taxes/aliases — alta de alias', () => {
  beforeEach(() => stubShell('es'));

  it('el desplegable de categoría no lleva el literal inglés', async () => {
    const el = await montar('erp-taxes-aliases');
    expect(textoVisible(el)).not.toContain(INGLES_DEL_SEED);
  });
});

describe('control de positivo: en INGLÉS el mismo texto sí sale', () => {
  it('con `locale: en` la tabla de categorías devuelve el nombre fuente — la comprobación detecta lo que busca', async () => {
    stubShell('en');
    const el = await montar('erp-taxes-categories');
    const col = columnas(el).find((c) => c.key === 'name')!;
    expect(col.format!(CATEGORIES[0] as unknown as Record<string, unknown>)).toBe(INGLES_DEL_SEED);
  });
});
