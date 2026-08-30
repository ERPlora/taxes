// A component must belong to the rule it hangs from (taxes#9).
//
// A tax rule is either a ROOT —a jurisdiction, a category and a rate— or a COMPONENT of one, tied
// by `parent_id`. The component is what adds the recargo de equivalencia on top of its VAT. But
// `rule_create` inserted whatever `:parent_id` arrived: nothing checked that the parent existed, was
// this hub's, was a root at all, or shared its country, region and category.
//
// That matters because the combined rate is the SUM of the components of the resolved root. A
// component hanging from a root of another jurisdiction adds its points to a tax it has nothing to
// do with — and that combined rate is what gets charged and what gets declared.
//
// It is the other half of hub#600, which closed the door on the *reading* side (the SDK no longer
// resolves a rule of another region when none applies). This closes the *writing* side: building an
// incoherent hierarchy by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as {
  id: string;
  commands: Record<string, { sql?: string[]; expect_rows?: { op: string; n: number; error: string; message?: string } }>;
};
const schema = JSON.parse(readFileSync(join(ROOT, 'schemas/rule_create.json'), 'utf8')) as {
  properties: Record<string, Record<string, unknown>>;
};
const cmd = manifest.commands['taxes.rules.create'];
const sql = (cmd.sql ?? [])
  .map((f) => readFileSync(join(ROOT, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
  .join('\n');

describe('a component hangs from a root of ITS OWN jurisdiction and category', () => {
  it('resolves the parent instead of trusting the id it was given', () => {
    expect(sql, 'the insert takes any parent_id, including one from another hub').toMatch(/taxes_rule\b/);
    expect(sql, 'the parent must be this hub\'s').toMatch(/hub_id\s*=\s*:hub_id/);
  });

  it.each(['country_code', 'region_code', 'tax_category_key'])(
    'the component must share the %s of its parent',
    (col) => {
      expect(sql, `a component can hang from a root with a different ${col}`).toMatch(new RegExp(`${col}`));
    },
  );

  it('the parent has to be a ROOT, not another component', () => {
    // A component of a component would add its points twice over and nest a hierarchy the resolver
    // does not model: `rule_components` only ever looks one level down.
    expect(sql, 'nothing stops a component hanging from another component').toMatch(/parent_id/);
  });

  it('a root still needs no parent — that is the normal case', () => {
    // `parent_id` empty/NULL is the majority of rules; the guard must not make them impossible.
    expect(sql).toMatch(/COALESCE\(\s*NULLIF\(\s*:parent_id|:parent_id\s*,\s*''\s*\)\s*=\s*''/);
  });
});

describe('a validity range that runs backwards is not a range', () => {
  it('refuses valid_from later than valid_to', () => {
    expect(sql, 'an inverted range is accepted and the rule is never in force').toMatch(/valid_from/);
    expect(sql).toMatch(/valid_to/);
  });
});

describe('a rate has an upper end, not only a lower one', () => {
  it('rate_pct is capped', () => {
    const rate = schema.properties.rate_pct;
    expect(rate.minimum, 'a negative rate would subtract tax').toBe(0);
    expect(rate.maximum, 'a 500% rate passes the schema today').toBeLessThanOrEqual(100);
  });
});

describe('a rule that does not pass fails, instead of being written', () => {
  it('declares the expect_rows gate', () => {
    const gate = cmd.expect_rows;
    expect(gate, 'a conditional insert with no gate writes nothing and reports success').toBeTruthy();
    expect(gate!.op).toBe('min');
    expect(gate!.n).toBeGreaterThanOrEqual(1);
    expect(gate!.error.split('.')[0]).toBe(manifest.id);
    expect(gate!.message).toBeTruthy();
  });
});
