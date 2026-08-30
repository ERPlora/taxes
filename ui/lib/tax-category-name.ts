// tax-category-name — el nombre VISIBLE de una categoría fiscal (taxes#30, reubicado en taxes#38).
//
// El módulo siembra sus 10 categorías canónicas con el nombre en INGLÉS —ADR-0055: el dato nace en
// el idioma fuente y se traduce en presentación—, así que un hub en español leía «Product — generic»
// en la pantalla de categorías, en el selector «Departamento (IVA)» del TPV, en la línea del carrito
// y en el TIQUE IMPRESO del cliente.
//
// taxes#30 lo resolvió AQUÍ, en el cliente, con un mapa clave→etiqueta i18n. Cubría las tres
// pantallas de este módulo y ninguna más, y no había forma de que cubriera el resto: la categoría se
// elige sobre todo en `inventory` y en `sales`, ningún módulo importa el código de otro (ADR-0043) y
// el catálogo i18n tampoco viaja entre bundles. Copiar el mapa en cada consumidor habría dejado N
// listas de las claves canónicas en N repos, y la siguiente categoría nueva habría vuelto a salir en
// inglés allí sin que nadie se enterara.
//
// taxes#38 mueve la resolución a la ÚNICA puerta que cruza el límite de un módulo: la query.
// `taxes.categories.list`/`.get` devuelven `display_name`/`display_description` ya resueltos al
// idioma de quien pregunta (override personal → idioma del hub → inglés), leyendo la lista única de
// etiquetas `taxes_category_label` (migración 005). Aquí ya no se decide idioma: se PINTA lo que
// llegó, con el dato crudo como red por si la lectura no vino por la query.

/** Categoría tal y como la devuelve `taxes.categories.list` / `taxes.categories.get`. */
export interface TaxCategoryLike {
  key?: string;
  name?: string;
  description?: string;
  /** Nombre presentable ya resuelto por la query al idioma del hub/usuario (taxes#38). */
  display_name?: string;
  /** Descripción presentable ya resuelta por la query (taxes#38). */
  display_description?: string;
}

/**
 * Nombre visible de una categoría fiscal: el que resolvió la query y, si esa lectura no lo trae,
 * el nombre del dato. Nunca devuelve vacío teniendo `key`: una opción muda en un `<ion-select>` no
 * se puede elegir.
 */
export function taxCategoryDisplayName(category: TaxCategoryLike): string {
  return (
    (category.display_name || '').trim() ||
    (category.name || '').trim() ||
    (category.key || '').trim()
  );
}

/**
 * Descripción visible. Misma regla que el nombre; sin descripción devuelve cadena vacía (quien la
 * pinta ya decide su propio marcador de «sin dato»).
 */
export function taxCategoryDisplayDescription(category: TaxCategoryLike): string {
  return (category.display_description || '').trim() || (category.description || '').trim();
}
