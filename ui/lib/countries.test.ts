// The country of a tax rule is a CLOSED list, and the list is the one the command accepts (taxes#41).
//
// `taxes.rules.create` used to take any two characters, so `ZZ` — a code ISO 3166-1 deliberately
// leaves UNASSIGNED — created a rule that could never match any hub's fiscal identity. The schema
// now carries the 249 assigned codes; this file is about the OTHER half of that fix: the form must
// not let a person type one of the 248 wrong answers in the first place, and the list it offers has
// to be the SAME list the server accepts, or the screen and the door disagree.
//
// So the options are DERIVED from `schemas/rule_create.json`, never copied: there is one list, and
// a diff that adds a country to the schema moves the picker with it.
//
// The names come from `Intl.DisplayNames`, not from `locales/*.json`. Translating 249 country names
// by hand into every language the hub speaks is a file nobody would keep current — and the platform
// already knows them, in the reader's own language, with no assets and no CSP exception.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COUNTRY_CODES, countryOptions } from './countries';

const schema = JSON.parse(readFileSync(join(__dirname, '../../schemas/rule_create.json'), 'utf8')) as {
  properties: { country_code: { enum: string[] } };
};

describe('the picker offers exactly what the command accepts', () => {
  it('takes its codes from the schema, so the two cannot drift', () => {
    expect(COUNTRY_CODES).toEqual(schema.properties.country_code.enum);
    expect(COUNTRY_CODES).toHaveLength(249);
  });

  it('does not offer the code taxes#41 was filed with, nor the other unassigned ones', () => {
    for (const notACountry of ['ZZ', 'XX', 'AA', 'QQ', 'EU', 'UN']) {
      expect(COUNTRY_CODES, `${notACountry} is not a country`).not.toContain(notACountry);
    }
  });

  it('offers the ones a real business sells from', () => {
    expect(COUNTRY_CODES).toEqual(expect.arrayContaining(['ES', 'PT', 'FR', 'DE', 'IT', 'US', 'GB', 'MA']));
  });
});

describe('an option is readable in the language of whoever is looking', () => {
  it('names the country in Spanish for a Spanish hub', () => {
    const es = countryOptions('es');
    expect(es.find((o) => o.value === 'ES')?.label).toContain('España');
    expect(es.find((o) => o.value === 'DE')?.label).toContain('Alemania');
  });

  it('and in English for an English one', () => {
    const en = countryOptions('en');
    expect(en.find((o) => o.value === 'ES')?.label).toContain('Spain');
    expect(en.find((o) => o.value === 'DE')?.label).toContain('Germany');
  });

  // `ok-combo` filters on the LABEL only, so the code has to be in it: an owner who knows the
  // rule is «ES» would otherwise have to know that Spain is spelled España to find it.
  it('carries the code too, so typing ES finds Spain', () => {
    const label = countryOptions('es').find((o) => o.value === 'ES')?.label ?? '';
    expect(label).toContain('ES');
    const matches = countryOptions('es').filter((o) => o.label.toLowerCase().includes('es'));
    expect(matches.map((o) => o.value)).toContain('ES');
  });

  it('sorts by the name the reader sees, not by the code', () => {
    const labels = countryOptions('es').map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'es')));
    // Alemania before España in Spanish; in English Spain comes after Germany too, but the point
    // is that DE precedes ES by NAME while `DE` < `ES` by code would say the same — so use a pair
    // the two orders disagree on: Alemania (DE) before Bélgica (BE).
    const es = countryOptions('es').map((o) => o.value);
    expect(es.indexOf('DE')).toBeLessThan(es.indexOf('BE'));
  });

  it('every option is one of the accepted codes, and there are no duplicates', () => {
    const values = countryOptions('es').map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((v) => COUNTRY_CODES.includes(v))).toBe(true);
  });

  // A browser without `Intl.DisplayNames` (or a locale it cannot serve) must still get a usable
  // list — the code alone — instead of an empty picker that makes the screen unusable.
  it('falls back to the bare code when the platform cannot name a region', () => {
    const original = Intl.DisplayNames;
    try {
      // @ts-expect-error — deliberately removing the API to take the fallback path
      delete Intl.DisplayNames;
      const options = countryOptions('es');
      expect(options).toHaveLength(COUNTRY_CODES.length);
      expect(options.find((o) => o.value === 'ES')?.label).toBe('ES');
    } finally {
      Intl.DisplayNames = original;
    }
  });
});
