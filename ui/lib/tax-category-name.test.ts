// El nombre VISIBLE de una categoría fiscal se traduce en PRESENTACIÓN (taxes#30).
//
// Las 10 categorías de sistema se siembran con el nombre en inglés canónico —ADR-0055: el dato
// nace en inglés y la UI lo traduce— así que un hub en español leía «Product — generic» en
// /m/taxes/categories, en el selector «Departamento (IVA)» del TPV, en la línea del carrito y,
// lo que subió esta issue de P2 a P1, **en el tique impreso del cliente**.
//
// El arreglo NO es parchear el seed: hub#945 (paso 4 de hub#576) hace que `taxes` deje de sembrar
// baselines por país cuando los blueprints —que ya llevan `tax_rules`— estén regenerados, así que
// traducir ahí es trabajo que se tira. Tampoco es que el blueprint traiga el nombre ya localizado:
// un hub que cambia de idioma después de instalar se quedaría con el idioma de instalación
// congelado en la columna, y el `.blueprint.zip` es INMUTABLE (ADR-0121) — corregir una traducción
// exigiría republicarlo.
//
// Se traduce la ETIQUETA sobre la CLAVE estable, no el dato. Es el patrón que el módulo hermano ya
// tiene resuelto: `payMethodDisplayName()` en `sales/ui/lib/pay-icons.ts`, que traduce los nombres
// que siembra el seed («Cash», «Card») y deja pasar tal cual los que teclea el dueño.
//
// Diferencia con `sales`, y es a mejor: allí la búsqueda va por el NOMBRE sembrado (si el dueño
// renombra la fila, su texto manda). Aquí va por la `key` canónica, que es identidad de verdad:
// `taxes` no tiene command de update de categorías, así que la fila de sistema NO se puede
// renombrar, y la clave sobrevive a cualquier cosa que le pase al `name`. Las categorías que crea
// el usuario no tienen clave en el mapa y salen con su nombre tal cual: son suyas.
import { describe, expect, it } from 'vitest';
import enLocale from '../../locales/en.json';
import esLocale from '../../locales/es.json';
import {
  SYSTEM_TAX_CATEGORY_KEYS,
  taxCategoryDisplayDescription,
  taxCategoryDisplayName,
} from './tax-category-name';

const CATALOG: Record<string, Record<string, unknown>> = { en: enLocale, es: esLocale };

/** Mismo `t` que el shell (`erplora.t`): baja por el catálogo partiendo la clave por puntos. */
function translator(locale: string) {
  return (key: string): string => {
    const dict = CATALOG[locale] ?? CATALOG.en;
    let cur: unknown = dict;
    for (const part of key.split('.')) {
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
    }
    return typeof cur === 'string' ? cur : key;
  };
}

const es = translator('es');
const en = translator('en');

/** Las 10 categorías que siembran `seed/install.postgres.sql` y el backfill `003_*`. */
const SEEDED: { key: string; name: string; description?: string }[] = [
  { key: 'restaurant.food', name: 'Restaurant — food' },
  { key: 'restaurant.drink', name: 'Restaurant — drink' },
  { key: 'restaurant.alcohol', name: 'Restaurant — alcohol' },
  { key: 'restaurant.delivery', name: 'Restaurant — delivery' },
  { key: 'service.generic', name: 'Service — generic' },
  {
    key: 'service.health',
    name: 'Service — healthcare (VAT exempt)',
    description: 'Assistance provided by medical or health professionals — art. 20.Uno.3 (ES)',
  },
  {
    key: 'service.education',
    name: 'Service — education (VAT exempt)',
    description: 'Regulated teaching and training — art. 20.Uno.9 (ES)',
  },
  { key: 'product.generic', name: 'Product — generic' },
  { key: 'product.reduced', name: 'Product — reduced (food staples, pharmacy)' },
  { key: 'product.super_reduced', name: 'Product — super-reduced (bread, books, basics)' },
];

describe('el mapa cubre EXACTAMENTE lo que siembra el módulo', () => {
  it('las 10 claves de sistema del seed, ni una menos', () => {
    expect([...SYSTEM_TAX_CATEGORY_KEYS].sort()).toEqual(SEEDED.map((c) => c.key).sort());
  });

  it('cada clave tiene etiqueta en `en` (fuente) y en `es` (traducción)', () => {
    for (const { key } of SEEDED) {
      const k = `ui.taxCategory.${key}`;
      expect(en(k), `falta la etiqueta inglesa de ${key}`).not.toBe(k);
      expect(es(k), `falta la traducción española de ${key}`).not.toBe(k);
    }
  });

  it('la traducción española NO es una copia del inglés (si lo fuera, la pantalla seguiría en inglés)', () => {
    for (const { key } of SEEDED) {
      const k = `ui.taxCategory.${key}`;
      expect(es(k), `${key} está «traducido» al mismo texto inglés`).not.toBe(en(k));
    }
  });
});

describe('taxCategoryDisplayName', () => {
  it('traduce las 10 de sistema: ninguna sale con el literal inglés del seed', () => {
    for (const cat of SEEDED) {
      const shown = taxCategoryDisplayName(cat, es);
      expect(shown, `${cat.key} sigue saliendo en inglés`).not.toBe(cat.name);
      expect(shown).toBe(es(`ui.taxCategory.${cat.key}`));
    }
  });

  it('el caso del tique: `product.generic` deja de leerse «Product — generic»', () => {
    expect(taxCategoryDisplayName({ key: 'product.generic', name: 'Product — generic' }, es))
      .toBe('Producto — general');
  });

  it('en inglés devuelve el mismo texto que el seed: la traducción no cambia el idioma fuente', () => {
    for (const cat of SEEDED) {
      expect(taxCategoryDisplayName(cat, en), `${cat.key} cambió en inglés`).toBe(cat.name);
    }
  });

  it('una categoría CREADA POR EL USUARIO pasa tal cual: su texto es suyo', () => {
    expect(taxCategoryDisplayName({ key: 'catering_bodas', name: 'Catering de bodas' }, es))
      .toBe('Catering de bodas');
    expect(taxCategoryDisplayName({ key: 'product.generic_de_la_casa', name: 'Lo de casa' }, es))
      .toBe('Lo de casa');
  });

  it('sin nombre y sin clave conocida devuelve la clave, nunca vacío (una opción muda no se puede elegir)', () => {
    expect(taxCategoryDisplayName({ key: 'sin_nombre', name: '' }, es)).toBe('sin_nombre');
    expect(taxCategoryDisplayName({ key: '', name: '' }, es)).toBe('');
  });
});

describe('taxCategoryDisplayDescription', () => {
  it('traduce las descripciones LEGALES de las dos exentas', () => {
    for (const cat of SEEDED.filter((c) => c.description)) {
      const shown = taxCategoryDisplayDescription(cat, es);
      expect(shown, `la descripción legal de ${cat.key} sigue en inglés`).not.toBe(cat.description);
      expect(shown).toContain('art. 20.Uno'); // el artículo NO se traduce: es la cita legal
    }
  });

  it('una descripción tecleada por el usuario pasa tal cual', () => {
    expect(taxCategoryDisplayDescription({ key: 'catering_bodas', description: 'Solo banquetes' }, es))
      .toBe('Solo banquetes');
  });

  it('sin descripción devuelve cadena vacía (la tabla ya pinta su propio «—»)', () => {
    expect(taxCategoryDisplayDescription({ key: 'restaurant.food', description: '' }, es)).toBe('');
    expect(taxCategoryDisplayDescription({ key: 'catering_bodas' }, es)).toBe('');
  });
});
