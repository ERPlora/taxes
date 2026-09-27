import { it, expect } from 'vitest';
import { checkMoneyDisplay } from '@erplora/module-toolkit/money-display-guard';

// GUARD (pm#289, shared since pm#505/pm#508): money on screen is never formatted by hand in this
// module, and OutfitKit comes in by entry point, never as a value from the barrel.
//
// The rules live in `@erplora/module-toolkit/money-display-guard` (one piece for every module,
// tested there against its own positives); this test only says what is specific to Impuestos:
//
// * notDisplay — the two tax PERCENTAGES of Rules, triaged in pm#289. They are also the witness on
//   the detector's OUTPUT: if the scan were fed empty or cut content, they would come back as
//   `stale_exception` (rv-taxes-78).
// * witnesses — this module paints no amount, so an empty scan proves nothing by itself: the code
//   the detector reads (comments stripped) must still carry the column formatters of the three
//   screens (`format: (r)`, where an amount would be painted first) and the helpers of `lib/`,
//   where a shared money helper would land first (rv-appointments-226, rv-taxes-78).
// * outfitkitImporters — each of the three screens imports OutfitKit (entry points + types), so
//   the barrel scan provably read all three.
it('money on screen goes through the shared formatter and OutfitKit by entry point (pm#289)', () => {
  expect(
    checkMoneyDisplay({
      from: import.meta.url,
      witnesses: {
        'components/erp-taxes-rules/erp-taxes-rules.ts': { text: 'format: (r)', atLeast: 8 },
        'components/erp-taxes-categories/erp-taxes-categories.ts': { text: 'format: (r)', atLeast: 4 },
        'components/erp-taxes-aliases/erp-taxes-aliases.ts': { text: 'format: (r)', atLeast: 2 },
        'lib/tax-category-name.ts': 'export function taxCategoryDisplayName(',
        'lib/countries.ts': 'export function countryOptions(',
      },
      notDisplay: {
        "components/erp-taxes-rules/erp-taxes-rules.ts: return `${Number(r.rate_pct).toFixed(2)}%`;":
          'rate column of the rules list: a tax PERCENTAGE (rate_pct), not an amount — no currency, no scale',
        "components/erp-taxes-rules/erp-taxes-rules.ts: ${this.parentCandidates.map((r) => html`<ion-select-option .value=${r.id}>${Number(r.rate_pct).toFixed(2)}% · ${t(`ui.taxType_${r.tax_type}`)}${r.valid_from ? ` · ${r.valid_from}` : ''}</ion-select-option>`)}":
          "parent-rule picker label: the parent rule's tax PERCENTAGE (rate_pct), not an amount",
      },
      outfitkitImporters: [
        'components/erp-taxes-rules/erp-taxes-rules.ts',
        'components/erp-taxes-categories/erp-taxes-categories.ts',
        'components/erp-taxes-aliases/erp-taxes-aliases.ts',
      ],
    }),
  ).toEqual([]);
});
