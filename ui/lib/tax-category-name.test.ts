// El nombre VISIBLE de una categoría fiscal llega YA RESUELTO desde la query (taxes#38).
//
// taxes#30 lo traducía aquí, en el cliente, sobre la clave canónica y contra `locales/*.json`. Eso
// arreglaba las tres pantallas de ESTE módulo y ninguna más: la categoría se elige sobre todo
// FUERA —`inventory` (alta de producto, importador CSV) y `sales` (el «Departamento (IVA)» del TPV,
// la línea del carrito y el TIQUE IMPRESO)— y allí seguía saliendo el literal inglés del seed.
//
// Y no se puede arreglar en el consumidor: ningún módulo importa el código de otro (ADR-0043) y el
// catálogo i18n tampoco viaja (`t()` resuelve contra el JSON que su propio WC inlinea). Copiar el
// mapa clave→etiqueta en cada consumidor dejaría N listas de las claves canónicas en N repos, y la
// siguiente categoría que se añadiera aquí volvería a salir en inglés allí, en silencio.
//
// Por eso la etiqueta sale por la única puerta que cruza el límite de un módulo: la QUERY.
// `taxes.categories.list`/`.get` devuelven `display_name`/`display_description` ya resueltos al
// idioma de quien pregunta, y la lista de etiquetas vive en UN sitio (`taxes_category_label`,
// migración 005). El idioma se prueba donde ahora se decide —contra Postgres, en
// `tests/category-display-name.postgres.test.sh`—; lo que se prueba aquí es lo único que le queda
// al cliente: PINTAR lo que llega, sin inventarse nada.
import { describe, expect, it } from 'vitest';
import { taxCategoryDisplayDescription, taxCategoryDisplayName } from './tax-category-name';

/** Una categoría canónica tal y como la devuelve hoy la query en un hub en español. */
const CANONICA = {
  key: 'product.generic',
  name: 'Product — generic',
  display_name: 'Producto — general',
  description: '',
  display_description: '',
};

/** Una exenta: su descripción LEGAL también viene resuelta, con la cita del artículo intacta. */
const EXENTA = {
  key: 'service.health',
  name: 'Service — healthcare (VAT exempt)',
  display_name: 'Servicio — sanitario (exento de IVA)',
  description: 'Assistance provided by medical or health professionals — art. 20.Uno.3 (ES)',
  display_description: 'Asistencia prestada por profesionales médicos o sanitarios — art. 20.Uno.3 (ES)',
};

describe('taxCategoryDisplayName', () => {
  it('pinta el nombre que resolvió la query, no el literal inglés del seed', () => {
    expect(taxCategoryDisplayName(CANONICA)).toBe('Producto — general');
    expect(taxCategoryDisplayName(EXENTA)).toBe('Servicio — sanitario (exento de IVA)');
  });

  it('el hub en inglés recibe el inglés por la misma columna: aquí no se decide idioma', () => {
    expect(taxCategoryDisplayName({ ...CANONICA, display_name: 'Product — generic' }))
      .toBe('Product — generic');
  });

  it('una categoría del USUARIO no tiene etiqueta que resolver: manda su nombre', () => {
    expect(taxCategoryDisplayName({ key: 'catering_bodas', name: 'Catering de bodas', display_name: 'Catering de bodas' }))
      .toBe('Catering de bodas');
  });

  it('sin `display_name` —una lectura que no pasó por la query— cae al nombre del dato', () => {
    expect(taxCategoryDisplayName({ key: 'product.generic', name: 'Product — generic' }))
      .toBe('Product — generic');
    expect(taxCategoryDisplayName({ key: 'product.generic', name: 'Product — generic', display_name: '  ' }))
      .toBe('Product — generic');
  });

  it('nunca devuelve vacío teniendo clave: una opción muda no se puede elegir', () => {
    expect(taxCategoryDisplayName({ key: 'sin_nombre', name: '' })).toBe('sin_nombre');
    expect(taxCategoryDisplayName({ key: '', name: '' })).toBe('');
  });
});

describe('taxCategoryDisplayDescription', () => {
  it('pinta la descripción resuelta, con la cita del artículo (que es lo que la hace útil)', () => {
    const shown = taxCategoryDisplayDescription(EXENTA);
    expect(shown).not.toContain('Assistance provided');
    expect(shown).toContain('art. 20.Uno.3');
  });

  it('sin descripción resuelta cae a la del dato, y sin ninguna devuelve vacío', () => {
    expect(taxCategoryDisplayDescription({ key: 'catering_bodas', description: 'Solo banquetes' }))
      .toBe('Solo banquetes');
    expect(taxCategoryDisplayDescription({ key: 'restaurant.food', description: '' })).toBe('');
    expect(taxCategoryDisplayDescription({ key: 'catering_bodas' })).toBe('');
  });
});
