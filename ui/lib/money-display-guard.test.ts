import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUARD (pm#289): money on screen is never formatted by hand in this module.
//
// Money travels as an integer in the currency's minor unit (ADR-0123). The screen gets it through
// the shell's single formatter — `erplora().formatMoney(minor)` (currency and scale of the hub,
// JPY 0 decimals, KWD 3) — or `<ok-money>` / `formatMinor` from OutfitKit (by string, no float).
// A `(cents / 100).toFixed(2)` — or `.toFixed(scale)`, same float path — or a hand-built
// `Intl.NumberFormat({ currency })` / `.toLocaleString(…, { currency })` brings back what that
// contract removed: its own separators, its own rounding, and a hard `/100` that is wrong the day
// the hub is not in euros.
//
// The only hand formatting left is NOT display, and each one is listed below with the reason.
// A new occurrence (or an allowed one that moves to another file) turns this test red.

function moduleRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'module.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('module.json not found walking up from the test');
    dir = up;
  }
  return dir;
}

/** Production sources of the UI: tests and the test doubles in `ui/test/` do not reach a screen. */
function uiSources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'test' || n === 'node_modules' ? [] : uiSources(p);
    return /\.(ts|js|vue)$/.test(n) && !/\.test\.(ts|js)$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });
}

/** Comments may talk about `toFixed(2)`; only code counts. Crude but enough: strings never
 *  contain these patterns in this module, and a false positive fails loud, not silent. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Every `NumberFormat(…)` or `.toLocaleString(…)` call whose arguments (up to the balancing paren,
 *  across lines) name a `currency`: the options object usually sits on its own lines, so a per-line
 *  match misses it. `toLocaleString` is the same Intl path without spelling `NumberFormat`. */
function currencyNumberFormatCalls(code: string): string[] {
  const calls: string[] = [];
  const open = /(?:NumberFormat|\.toLocaleString)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(code))) {
    let depth = 1;
    let i = open.lastIndex;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
      i++;
    }
    const call = code.slice(m.index, i);
    if (/\bcurrency\b/.test(call)) calls.push(call.replace(/\s+/g, ' ').trim());
  }
  return calls;
}

/** Each hand-formatted number in the code: any `.toFixed(…)` (per line — `toFixed(scale)` is the
 *  same float path as `toFixed(2)`) or a `NumberFormat(…currency…)` / `.toLocaleString(…currency…)`
 *  call (collapsed to one line, however many it spans). */
export function handFormattedMoney(src: string): string[] {
  const code = stripComments(src);
  const hits: string[] = [];
  for (const line of code.split('\n')) {
    if (/\.toFixed\s*\(/.test(line)) hits.push(line.trim());
  }
  return hits.concat(currencyNumberFormatCalls(code));
}

/** Triaged pm#289: formatting that is not a screen amount. `file: exact code line → why`.
 *  This module paints no amount today (it manages tax rules, not prices); any future one goes
 *  through `erplora().formatMoney(minor)` or `<ok-money>`. Add an entry only with the reason it
 *  is not a screen amount. */
const NOT_DISPLAY: Record<string, string> = {
  "components/erp-taxes-rules/erp-taxes-rules.ts: return `${Number(r.rate_pct).toFixed(2)}%`;":
    'rate column of the rules list: a tax PERCENTAGE (rate_pct), not an amount — no currency, no scale',
  "components/erp-taxes-rules/erp-taxes-rules.ts: ${this.parentCandidates.map((r) => html`<ion-select-option .value=${r.id}>${Number(r.rate_pct).toFixed(2)}% · ${t(`ui.taxType_${r.tax_type}`)}${r.valid_from ? ` · ${r.valid_from}` : ''}</ion-select-option>`)}":
    'parent-rule picker label: the parent rule\'s tax PERCENTAGE (rate_pct), not an amount',
};

/** The hits no exception covers. Each exception covers ONE occurrence: the key is file + exact
 *  line, so a copy of the allowed line in a new display function of the same file would otherwise
 *  ride on it. */
export function unexpectedHits(found: string[], allowed: Record<string, string>): string[] {
  const left = new Map(Object.keys(allowed).map((k) => [k, 1]));
  return found.filter((k) => {
    const n = left.get(k) ?? 0;
    left.set(k, n - 1);
    return n <= 0;
  });
}

describe('money display goes through the shared formatter (pm#289)', () => {
  it('no hand-formatted amount in ui/ outside the triaged non-display cases', () => {
    const uiRoot = join(moduleRoot(), 'ui');
    const found: string[] = [];
    const sources = uiSources(uiRoot);
    // The control that keeps this from passing vacuously: this module paints no amount, so the
    // guard's job is to catch the FIRST one on any of its three screens — all three are scanned.
    expect(sources.map((f) => f.slice(uiRoot.length + 1))).toEqual(
      expect.arrayContaining([
        'components/erp-taxes-rules/erp-taxes-rules.ts',
        'components/erp-taxes-categories/erp-taxes-categories.ts',
        'components/erp-taxes-aliases/erp-taxes-aliases.ts',
      ]),
    );
    for (const f of sources) {
      const rel = f.slice(uiRoot.length + 1);
      for (const h of handFormattedMoney(readFileSync(f, 'utf8'))) found.push(`${rel}: ${h}`);
    }
    const unexpected = unexpectedHits(found, NOT_DISPLAY);
    expect(
      unexpected,
      'amount formatted by hand: use erplora().formatMoney(minor) or <ok-money>/formatMinor',
    ).toEqual([]);
  });

  it('every triaged exception still exists (a stale entry would hide the next one)', () => {
    const uiRoot = join(moduleRoot(), 'ui');
    const found = new Set<string>();
    for (const f of uiSources(uiRoot)) {
      const rel = f.slice(uiRoot.length + 1);
      for (const h of handFormattedMoney(readFileSync(f, 'utf8'))) found.add(`${rel}: ${h}`);
    }
    expect(Object.keys(NOT_DISPLAY).filter((k) => !found.has(k))).toEqual([]);
  });

  it('the detector catches the positive (otherwise this guard is decorative)', () => {
    expect(handFormattedMoney('const s = `${(total / 100).toFixed(2)} €`;')).toHaveLength(1);
    expect(handFormattedMoney("const f = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });")).toHaveLength(1);
    expect(handFormattedMoney('const s = (total / 10 ** scale).toFixed(scale) + " €";')).toHaveLength(1);
    expect(handFormattedMoney('const s = erplora().formatMoney(total);')).toHaveLength(0);
    expect(handFormattedMoney('// was (x / 100).toFixed(2)\nconst s = erplora().formatMoney(x);')).toHaveLength(0);
    expect(handFormattedMoney("new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })")).toHaveLength(0);
    // The shape prettier produces: the options object on its own lines (this is how it comes back).
    expect(handFormattedMoney("new Intl.NumberFormat('es-ES', {\n  style: 'currency',\n  currency: 'EUR',\n});")).toHaveLength(1);
    // Same Intl path without spelling `NumberFormat` (gap noted in the review of verifactu#136).
    expect(handFormattedMoney("const s = (total / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });")).toHaveLength(1);
    expect(handFormattedMoney("const s = (total / 100).toLocaleString(locale, {\n  style: 'currency',\n  currency,\n});")).toHaveLength(1);
    expect(handFormattedMoney("const s = new Date(x).toLocaleString(locale, { hour: '2-digit' });")).toHaveLength(0);
  });

  it('an exception covers one occurrence of its line, not every copy in the file', () => {
    const allowed = { 'lib/a.ts: x.toFixed(d);': 'input value' };
    expect(unexpectedHits(['lib/a.ts: x.toFixed(d);'], allowed)).toEqual([]);
    expect(unexpectedHits(['lib/a.ts: x.toFixed(d);', 'lib/a.ts: x.toFixed(d);'], allowed)).toEqual(['lib/a.ts: x.toFixed(d);']);
    expect(unexpectedHits(['lib/b.ts: x.toFixed(d);'], allowed)).toEqual(['lib/b.ts: x.toFixed(d);']);
  });
});

// GUARD (rv-payment_gateways-36, copied to every module of pm#289): OutfitKit is imported by ENTRY POINT (`@erplora/outfitkit/ok-money`),
// never as a value from the barrel (`@erplora/outfitkit`). The barrel re-exports every `ok-*`
// component, so a single `import { formatMinor } from '@erplora/outfitkit'` made esbuild inline the
// whole library into this module's bundle: `dist/` went from 216 KB to 1.1 MB and registered 90
// components the screen never paints. Type-only imports/exports are erased and stay allowed; a
// side-effect, dynamic or re-export of the barrel drags it in just the same.
export function barrelValueImports(src: string): string[] {
  const code = stripComments(src);
  const re =
    /(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"]@erplora\/outfitkit['"]|\bimport\s*\(?\s*['"]@erplora\/outfitkit['"]/g;
  return (code.match(re) ?? []).map((m) => m.replace(/\s+/g, ' ').trim());
}

describe('OutfitKit comes in by entry point, not by the barrel (bundle size)', () => {
  it('no value import from `@erplora/outfitkit` in ui/', () => {
    const uiRoot = join(moduleRoot(), 'ui');
    const found: string[] = [];
    for (const f of uiSources(uiRoot)) {
      const rel = f.slice(uiRoot.length + 1);
      for (const h of barrelValueImports(readFileSync(f, 'utf8'))) found.push(`${rel}: ${h}`);
    }
    expect(found, 'import it from @erplora/outfitkit/<component> (the barrel drags every ok-* into dist/)').toEqual([]);
  });

  it('the detector catches the positive and lets type-only imports through', () => {
    expect(barrelValueImports("import { formatMinor } from '@erplora/outfitkit';")).toHaveLength(1);
    expect(barrelValueImports("import {\n  formatMinor,\n} from '@erplora/outfitkit';")).toHaveLength(1);
    expect(barrelValueImports("import type { DataTableColumn } from '@erplora/outfitkit';")).toHaveLength(0);
    expect(barrelValueImports("import { formatMinor } from '@erplora/outfitkit/ok-money';")).toHaveLength(0);
    expect(barrelValueImports("// import { formatMinor } from '@erplora/outfitkit';")).toHaveLength(0);
    // The other doors to the same barrel: a side-effect import (the shape of this module's own
    // `import '@erplora/outfitkit/ok-data-table'` with the entry point dropped), a dynamic import
    // and a re-export all evaluate every `ok-*` just the same.
    expect(barrelValueImports("import '@erplora/outfitkit';")).toHaveLength(1);
    expect(barrelValueImports("const ok = await import('@erplora/outfitkit');")).toHaveLength(1);
    expect(barrelValueImports("export { formatMinor } from '@erplora/outfitkit';")).toHaveLength(1);
    expect(barrelValueImports("export * from '@erplora/outfitkit';")).toHaveLength(1);
    expect(barrelValueImports("import '@erplora/outfitkit/ok-data-table';")).toHaveLength(0);
    expect(barrelValueImports("export type { OkDetailItem } from '@erplora/outfitkit';")).toHaveLength(0);
  });
});
