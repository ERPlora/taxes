// The jurisdictions a tax rule may be created for — ONE list, read from the command's own schema.
//
// WHY THIS FILE EXISTS (taxes#41). The country box of the rules form was a two-character text
// input, so `ZZ` went in. ISO 3166-1 leaves `ZZ` unassigned, no hub can ever carry it as its fiscal
// identity, and `taxes.calculate` resolves a rate by `country + region + category` (ADR-0085) — so
// the rule was created, listed, counted by the setup checklist, and never applied to anything. The
// owner read her rules screen and believed the VAT was configured.
//
// `schemas/rule_create.json` now refuses those 248 wrong answers. This is the other half: the form
// stops offering them. And the picker DERIVES its codes from that schema instead of holding a copy
// — a copy is a list that drifts, and a picker offering a country the server refuses is the same
// dead end from the other side.
//
// NAMES COME FROM THE PLATFORM, NOT FROM `locales/`. `Intl.DisplayNames` names all 249 in whatever
// language the hub speaks, with no assets, no network and no CSP exception; 249 hand-written names
// per language is a file that would be wrong within a year. Where the runtime cannot serve the API
// (or the locale), the code alone is shown: a usable picker beats an empty one.
import ruleCreateSchema from '../../schemas/rule_create.json';

/** One entry of the country picker, shaped for `ok-combo`. */
export interface CountryOption {
  /** ISO 3166-1 alpha-2 code — what travels in `country_code`. */
  value: string;
  /** What the person reads and types against (`ok-combo` filters on this). */
  label: string;
}

/**
 * The ISO 3166-1 alpha-2 codes `taxes.rules.create` accepts, straight from its schema.
 *
 * Not a copy: if the schema ever gains or loses a country, the picker follows in the same commit.
 */
export const COUNTRY_CODES: readonly string[] = ruleCreateSchema.properties.country_code.enum;

/** `Intl.DisplayNames` for `locale`, or `null` where the runtime cannot build one. */
function regionNames(locale: string): { of(code: string): string | undefined } | null {
  const DisplayNames = (Intl as { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames;
  if (typeof DisplayNames !== 'function') return null;
  try {
    // `fallback: 'none'` so an unknown code comes back `undefined` instead of echoing itself —
    // that is what lets the caller tell «no translation» from «the name happens to be the code».
    return new DisplayNames([locale, 'en'], { type: 'region', fallback: 'none' });
  } catch {
    return null;
  }
}

/**
 * The picker's options, named and ordered for whoever is reading (`erplora.locale`).
 *
 * The label carries the code as well as the name (`España (ES)`): `ok-combo` filters on the label
 * only, so without it an owner who knows her rule says `ES` could not find it by typing `ES`.
 */
export function countryOptions(locale: string): CountryOption[] {
  const names = regionNames(locale);
  const options = COUNTRY_CODES.map((value) => {
    const name = names?.of(value);
    return { value, label: name ? `${name} (${value})` : value };
  });
  let compare: (a: string, b: string) => number;
  try {
    compare = new Intl.Collator(locale).compare;
  } catch {
    compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
  return options.sort((a, b) => compare(a.label, b.label));
}
