// tax-category-name — el nombre VISIBLE de una categoría fiscal (taxes#30).
//
// El módulo siembra sus 10 categorías canónicas con el nombre en INGLÉS —ADR-0055: el dato nace en
// el idioma fuente y la UI lo traduce—, así que un hub en español leía «Product — generic» en la
// pantalla de categorías, en el selector «Departamento (IVA)» del TPV, en la línea del carrito y en
// el TIQUE IMPRESO del cliente. El nombre es un dato, no una etiqueta, y por eso no se traducía.
//
// Aquí se traduce en PRESENTACIÓN, sobre la CLAVE canónica. No se toca el seed: hub#945 (paso 4 de
// hub#576) hace que `taxes` deje de sembrar baselines por país en cuanto los blueprints —que ya
// llevan `tax_rules`— estén regenerados, así que traducir el seed es trabajo que se tira. Y tampoco
// se delega en el blueprint: un hub que cambia de idioma después de instalar se quedaría con el
// idioma de instalación congelado en la columna, y el `.blueprint.zip` es INMUTABLE (ADR-0121) —
// arreglar una traducción exigiría republicarlo.
//
// Es el patrón que el módulo hermano ya tiene resuelto: `payMethodDisplayName()` en
// `sales/ui/lib/pay-icons.ts`. La diferencia, a mejor: allí se busca por el NOMBRE sembrado (si el
// dueño renombra la forma de pago, su texto manda); aquí por la `key`, que es identidad de verdad
// —`taxes` no tiene command de update de categorías, así que una fila de sistema NO se renombra— y
// sobrevive a cualquier cosa que le pase al `name`.
//
// Lo que NO está aquí: las categorías que crea el usuario. No tienen clave en el mapa y salen con su
// texto tal cual. Son suyas y no se tocan.

/** Categoría tal y como la devuelve `taxes.categories.list`. */
export interface TaxCategoryLike {
  key?: string;
  name?: string;
  description?: string;
}

/** Clave canónica → clave i18n de su etiqueta. `t()` parte por puntos, así que
 *  `ui.taxCategory.product.generic` baja por `ui → taxCategory → product → generic`. */
const KEY_TO_LABEL: Record<string, string> = {
  'restaurant.food': 'ui.taxCategory.restaurant.food',
  'restaurant.drink': 'ui.taxCategory.restaurant.drink',
  'restaurant.alcohol': 'ui.taxCategory.restaurant.alcohol',
  'restaurant.delivery': 'ui.taxCategory.restaurant.delivery',
  'service.generic': 'ui.taxCategory.service.generic',
  'service.health': 'ui.taxCategory.service.health',
  'service.education': 'ui.taxCategory.service.education',
  'product.generic': 'ui.taxCategory.product.generic',
  'product.reduced': 'ui.taxCategory.product.reduced',
  'product.super_reduced': 'ui.taxCategory.product.super_reduced',
};

/** Las mismas claves, con descripción LEGAL sembrada (las dos exentas). El artículo citado no se
 *  traduce —es la referencia a la norma—, sí la frase que lo explica. */
const KEY_TO_DESCRIPTION: Record<string, string> = {
  'service.health': 'ui.taxCategoryDesc.service.health',
  'service.education': 'ui.taxCategoryDesc.service.education',
};

/** Las claves canónicas que siembra el módulo. Exportada para que un test pueda comprobar que el
 *  mapa y el seed no se separan. */
export const SYSTEM_TAX_CATEGORY_KEYS: readonly string[] = Object.keys(KEY_TO_LABEL);

/**
 * Nombre visible de una categoría fiscal. Si su `key` es una de las canónicas del módulo se
 * traduce por i18n; si no —la creó el usuario—, manda su `name` tal cual. Nunca devuelve vacío
 * teniendo `key`: una opción muda en un `<ion-select>` no se puede elegir.
 */
export function taxCategoryDisplayName(
  category: TaxCategoryLike,
  t: (key: string) => string,
): string {
  const key = (category.key || '').trim();
  const labelKey = KEY_TO_LABEL[key];
  if (labelKey) {
    const label = t(labelKey);
    // Un catálogo sin la clave devuelve la clave cruda: mejor el nombre del dato que `ui.taxCategory.…`.
    if (label && label !== labelKey) return label;
  }
  return (category.name || '').trim() || key;
}

/**
 * Descripción visible. Misma regla que el nombre; sin descripción devuelve cadena vacía (quien la
 * pinta ya decide su propio marcador de «sin dato»).
 */
export function taxCategoryDisplayDescription(
  category: TaxCategoryLike,
  t: (key: string) => string,
): string {
  const key = (category.key || '').trim();
  const descKey = KEY_TO_DESCRIPTION[key];
  if (descKey) {
    const text = t(descKey);
    if (text && text !== descKey) return text;
  }
  return (category.description || '').trim();
}
