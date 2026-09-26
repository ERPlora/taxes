import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import '@erplora/outfitkit/ok-combo';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
// Capa de PRESENTACIÓN del nombre de la categoría (taxes#30): el seed lo guarda en inglés canónico
// (ADR-0055) y aquí se traduce por su `key`, sin tocar el dato. Lo que crea el usuario pasa tal cual.
import { taxCategoryDisplayName } from '../../lib/tax-category-name';
// La jurisdicción se ELIGE (taxes#41): las opciones salen del `enum` del propio schema del
// command, así que la pantalla no puede ofrecer un país que el servidor vaya a rechazar.
import { countryOptions } from '../../lib/countries';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  /** TODAS las filas, sin tope. El viejo `page_size` NO era un parámetro del runtime: truncaba a
   *  50 en silencio, y un hub con 60 categorías fiscales perdía 10 del desplegable. */
  queryAll<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T[]>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** Effective permission of the signed-in user (taxes#11). Optional: a preview without it stays permissive. */
  hasPermission?(permission: string): boolean;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

// ADR-0085: una regla declara el % aplicable por jurisdicción (país + región
// opcional) a una `tax_category_key`. Una regla "componente" (`parent_id` set,
// con `component_label`) modela multi-tributo (p.ej. recargo de equivalencia)
// colgando de una regla raíz.
interface TaxRule {
  id: string;
  country_code: string;
  region_code: string;
  tax_category_key: string;
  rate_pct: string;
  tax_type: string;
  // Fiscal qualification of the operation (ADR-0186, taxes#22): class + opaque jurisdiction codes.
  operation_class?: string;
  exempt_reason?: string;
  regime_key?: string;
  parent_id: string;
  component_label: string;
  valid_from: string;
  valid_to: string;
  is_active: number;
  /** 1 when the rule carries a rate on a class that charges no tax (taxes#63): see `isIncoherent`. */
  is_incoherent?: number;
  /** 1 when the rule is in force on some day together with another active rule of its slot (taxes#68). */
  overlaps?: number;
}

// Fila de `taxes.categories.list`: la categoría es la identidad enlazable (ADR-0085) y la FK
// (hub_id, tax_category_key) → taxes_category la valida, así que se ELIGE, no se teclea.
interface TaxCategory {
  id: string;
  key: string;
  name: string;
  /** Nombre presentable resuelto por `taxes.categories.list` al idioma del hub (taxes#38). */
  display_name?: string;
}

// Mirrors `schemas/rule_create.json`. `igic`/`ipsi` are tax FAMILIES (Canary Islands, Ceuta/Melilla), not
// regimes: a hub there does not charge VAT, and whoever files the return needs to know (ADR-0186).
const TAX_TYPES = ['vat', 'igic', 'ipsi', 'surcharge', 'sales_tax', 'withholding', 'excise', 'import_duty'] as const;

// Fiscal qualification of the operation (ADR-0186): subject (default), reverse charge, exempt (with a
// legal reason), not subject, not subject by place of supply. Codes travel opaque to the country's
// compliance module; this screen only lets the business state them (taxes#22).
const OPERATION_CLASSES = ['subject', 'subject_reverse', 'exempt', 'not_subject', 'not_subject_location'] as const;

// Every class but `subject` reaches the AEAT without a quota (S2/E*/N1/N2), so its rate is 0 — the
// server refuses anything else (`taxes.rule_incoherent`, taxes#59).
export function chargesNoTax(operationClass: string | undefined): boolean {
  return !!operationClass && operationClass !== 'subject';
}

// A rate on a rule that charges no tax — its own class, or its root's, is not `subject` (taxes#63).
// taxes#62 refuses those on create; the ones saved before that guard still resolve at the till and
// the invoice refuses to seal the sale. The server decides (`is_incoherent` in `rules_list.sql`);
// the screen only reads it.
export function isIncoherent(row: Record<string, unknown> | TaxRule): boolean {
  return Number((row as Record<string, unknown>).is_incoherent) === 1;
}

// An active root rule in force on some day together with another active rule of the same country,
// region and category (taxes#68). taxes#66 refuses that on every write; pairs saved before it are
// still there and the till charges whichever starts later. The server decides (`overlaps` in
// `rules_list.sql`, the same predicate as the #66 guard); the screen only reads it.
export function overlaps(row: Record<string, unknown> | TaxRule): boolean {
  return Number((row as Record<string, unknown>).overlaps) === 1;
}

// Whether «keep the rate, charge the tax» can repair it: only when the rule's OWN class is the
// problem. A subject component under a tax-free root cannot be fixed by changing the component
// (`commands/rule_repair.sql` refuses it too).
export function canRepairByChargingTax(row: Record<string, unknown> | TaxRule): boolean {
  return isIncoherent(row) && chargesNoTax(String((row as Record<string, unknown>).operation_class ?? ''));
}

// The runtime enforces the permission on every command; this only shapes the surface (taxes#11):
// a viewer (taxes.view_tax) gets a read-only table, a manager (taxes.manage_tax) the full one.
function can(permission: string): boolean {
  return erplora().hasPermission?.(permission) ?? true;
}

// Root rules a component may hang from (taxes#11): the same conditions the server enforces in
// `commands/rule_create.sql` (taxes#9) — a ROOT of the same country/region/category — plus «valid
// today», so the picker only shows what would be accepted and what still applies. A root that charges
// no tax is left out: a component with a rate under it is refused (taxes#59).
export function parentCandidates(rules: TaxRule[], country: string, region: string, category: string, today: string): TaxRule[] {
  const c = country.trim().toUpperCase();
  const r = region.trim().toUpperCase();
  const k = category.trim();
  if (!c || !k) return [];
  return rules.filter(
    (x) =>
      !x.parent_id &&
      !chargesNoTax(x.operation_class) &&
      Number(x.is_active) === 1 &&
      x.country_code === c &&
      (x.region_code ?? '') === r &&
      x.tax_category_key === k &&
      (!x.valid_from || x.valid_from <= today) &&
      (!x.valid_to || x.valid_to >= today),
  );
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

/** The `code` of a runtime error, or `''` when what arrived carries none (it is not the hub's). */
function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : '';
}

// A row's warning mark goes on its own line under the value (taxes#63, taxes#68). ok-data-table
// ellipsises a `format` string — and any `.gcell > span` — to one line, so a mark appended to the
// value was cut to «2012-09-01 …» at 1280 px: the root is a <div>, which wraps. It is painted inside
// the table's shadow root, where this component's styles do not reach, so it carries its own (via
// CSSOM, which the hub's CSP allows). Plain warning yellow is unreadable as small text on white: it
// is darkened toward the text colour (lightened in dark mode).
const MARK_STYLE = {
  color: 'color-mix(in srgb, var(--ion-color-warning, #ffc409) 40%, var(--ion-text-color, #000))',
  fontWeight: '600',
};

function markedCell(value: string, mark: unknown) {
  return html`<div>${value}<br />${mark}</div>`;
}

// A phone: where the screen opens in cards and lays the list out as one scrolling page (taxes#67).
const PHONE_QUERY = '(max-width: 834px)';

/** A card's title: the category a person reads (resolved by `rules_list.sql`), never its bare key
 *  unless that is all the row carries. A component names its root category and its own label. */
function cardTitle(r: Record<string, unknown>): string {
  const name = taxCategoryDisplayName({ key: String(r.tax_category_key ?? ''), display_name: String(r.tax_category_display_name ?? '') }) || '—';
  const label = String(r.component_label ?? '');
  return r.parent_id && label ? `↳ ${name} · ${label}` : name;
}

/** The rule's rate as the list shows it: a tax percentage, not an amount (see money-display-guard). */
function ratePct(r: Record<string, unknown>): string {
  return `${Number(r.rate_pct).toFixed(2)}%`;
}

export class ErpTaxesRules extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* The view fills the height: the data-table takes what is left (inner scroll, fixed footer).
       But never less than a usable minimum (taxes#68): on a phone, stacked warnings left it 30 px
       tall with no card in sight — past that minimum the page scrolls and the warnings go by. It
       still shrinks down to that minimum: with a flex-shrink of 0 it kept the page's full height
       (it is height:100% in fill mode) and one banner pushed the pager off screen. */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; overflow-y:auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:min(28rem, 70vh); }
    /* On a phone the table does not fill (taxes#67): it keeps its full height and the page scrolls,
       footer after the last card. Shrinking it to the floor above would spill the cards over it. */
    .page > ok-data-table:not([fill]) { flex:0 0 auto; }
    /* El alta vive en el panel lateral de la tabla (estrecho): los campos van APILADOS. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
    .hint { color:#6b675e; font-size:.85rem; margin:0; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() formError = '';

  @state() newCountry = '';

  @state() newRegion = '';

  @state() newCategoryKey = '';

  @state() newRatePct = '';

  @state() newTaxType = 'vat';

  @state() newOperationClass = 'subject';

  @state() newExemptReason = '';

  @state() newRegimeKey = '';

  @state() newValidFrom = '';

  /** Set when the create command was refused with `taxes.rule_overlaps` (taxes#66): marks «Valid
   *  from» with its own sentence instead of leaving the owner to guess which of the twelve fields
   *  of the form was wrong. Every `createRule()` attempt rewrites it (set on this refusal, cleared
   *  on any other outcome), and editing the date clears it. */
  @state() validFromError = '';

  @state() newValidTo = '';

  // Multi-tax component (optional): hangs from an existing root rule, CHOSEN among the compatible
  // ones (taxes#11) — never typed as a free id.
  @state() newParentId = '';

  // All active rules of the hub (not a page): the parent picker filters them client-side.
  @state() private allRules: TaxRule[] = [];

  @state() newComponentLabel = '';

  @state() saving = false;

  @state() private pendingDeactivate: TaxRule | null = null;
  /** The incoherent rule whose repair is being confirmed (taxes#63). */
  @state() private pendingRepair: TaxRule | null = null;
  /** The active rule being given an end date, dialog open while set (taxes#66). */
  @state() private pendingEnd: TaxRule | null = null;
  /** Si la tabla está mirando las reglas DESACTIVADAS (taxes#52): manda sobre el alcance de la
   *  lectura y sobre la acción que ofrece la fila. */
  @state() private showingArchived = false;

  // The table narrowed to the rules that overlap another one (taxes#68), from the banner.
  @state() private showingOverlaps = false;

  // Categorías fiscales del hub: pueblan el selector del alta y el filtro de la columna.
  @state() private categories: TaxCategory[] = [];

  // On a phone the list is one scrolling page instead of a filling table (taxes#67): `fill` pinned
  // «N records» under a 376 px box the cards scrolled through one at a time.
  @state() private phone = false;

  private phoneQuery?: MediaQueryList;

  // Columns the person hid with the table's column picker: the custom card body leaves them out,
  // as ok-data-table's own card body does.
  @state() private hiddenColumns = new Set<string>();

  private readonly onPhoneChange = (e: { matches: boolean }): void => {
    this.phone = e.matches;
  };

  private ctrl!: ListController<TaxRule>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      {
        key: 'tax_category_key',
        header: t('ui.colCategory'),
        sortable: true,
        filterable: true,
        // Dominio cerrado (las categorías del hub) y el servidor lo declara `op: eq` → select.
        filterType: 'select',
        options: this.categories.map((c) => ({ value: c.key, label: `${taxCategoryDisplayName(c)} (${c.key})` })),
        format: (r) => {
          const key = String(r.tax_category_key ?? '') || '—';
          const label = String(r.component_label ?? '');
          return r.parent_id && label ? `↳ ${key} · ${label}` : key;
        },
      },
      // The jurisdiction is CHOSEN here too (taxes#48): since taxes#41 the domain of
      // `country_code` is the closed ISO list, and the server declares it `op: eq` in module.json.
      {
        key: 'country_code',
        header: t('ui.colCountry'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: this.countryFilterOptions,
      },
      // The region is NOT the same case and stays a text box ON PURPOSE (taxes#48):
      // `schemas/rule_create.json` gives it a `pattern`, not an `enum` — ISO 3166-2 is a SHAPE here,
      // not a list, and there is no source of subdivisions the way `Intl.DisplayNames` names the
      // countries — and a dropdown could not say «no region»: `ok-data-table` reads the empty value
      // as «clear the filter», and no region — the whole country — is the NORMAL case. That is why
      // the manifest keeps `like`: a text box invites a fragment, and `like` is what a fragment does.
      { key: 'region_code', header: t('ui.colRegion'), sortable: true, filterable: true, filterType: 'text', format: (r) => String(r.region_code ?? '') || '—' },
      {
        key: 'rate_pct',
        header: t('ui.colRate'),
        align: 'right',
        sortable: true,
        // An incoherent rule keeps its rate readable and says what is wrong with it (taxes#63), on
        // its own line: see `markedCell`.
        format: (r) => (isIncoherent(r) ? `${ratePct(r)} · ${t('ui.incoherentBadge')}` : ratePct(r)),
        render: (r) =>
          isIncoherent(r)
            ? markedCell(ratePct(r), html`<small data-testid="taxes-rules-incoherent-mark" style=${styleMap(MARK_STYLE)}>${t('ui.incoherentBadge')}</small>`)
            : ratePct(r),
      },
      {
        key: 'tax_type',
        header: t('ui.colType'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: TAX_TYPES.map((v) => ({ value: v, label: t(`ui.taxType_${v}`) })),
        format: (r) => t(`ui.taxType_${String(r.tax_type)}`),
      },
      {
        key: 'operation_class',
        header: t('ui.colOperationClass'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: OPERATION_CLASSES.map((v) => ({ value: v, label: t(`ui.opClass_${v}`) })),
        format: (r) => {
          const cls = String(r.operation_class ?? '') || 'subject';
          const reason = String(r.exempt_reason ?? '');
          return cls === 'exempt' && reason ? `${t(`ui.opClass_${cls}`)} · ${reason}` : t(`ui.opClass_${cls}`);
        },
      },
      // A rule that overlaps another one keeps its date readable and says what is wrong with it
      // (taxes#68): the start date is where the two ranges collide. On its own line: see `markedCell`.
      {
        key: 'valid_from',
        header: t('ui.colValidFrom'),
        sortable: true,
        format: (r) => {
          const from = String(r.valid_from ?? '') || '—';
          return overlaps(r) ? `${from} · ${t('ui.overlapBadge')}` : from;
        },
        render: (r) => {
          const from = String(r.valid_from ?? '') || '—';
          return overlaps(r)
            ? markedCell(from, html`<small data-testid="taxes-rules-overlap-mark" style=${styleMap(MARK_STYLE)}>${t('ui.overlapBadge')}</small>`)
            : from;
        },
      },
      { key: 'valid_to', header: t('ui.colValidTo'), sortable: true, format: (r) => String(r.valid_to ?? '') || '—' },
      // Filtrable otra vez (taxes#52). taxes#50 la dejó sin filtro con razón —`rules_list.sql`
      // terminaba en `AND r.is_active = 1`, así que «No» no podía devolver una fila jamás—, pero
      // eso dejó de pie el defecto real: se desactivaba una regla, la fila desaparecía y no había
      // ninguna pantalla que la trajera de vuelta. Ahora la query sabe ampliar el alcance, así que
      // la caja puede cumplir lo que ofrece. Ojo: elegir «No» NO es un filtro más — ver
      // `onFilterChange`.
      {
        key: 'is_active',
        header: t('ui.colActive'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: [
          { value: '1', label: t('ui.optYes') },
          { value: '0', label: t('ui.optNo') },
        ],
        format: (r) => (Number(r.is_active) ? t('ui.optYes') : t('ui.optNo')),
      },
    ];
  }

  /**
   * The options of the country filter: the jurisdictions this hub HAS rules for.
   *
   * Not the 249 of the `enum` (taxes#48). `ok-data-table` paints a `select`-type filter as an
   * `ion-select` with NO search box, so handing it the whole list would rebuild the control the
   * create form, one element below, already rejected in writing: «combo y no ion-select porque son
   * 249». And a filter is not a create form — it narrows what is on the table, so 247 of those 249
   * could only ever answer with an empty list. It is what the column next door already does (the
   * category comes from `this.categories`) and what `ok-data-table` does on its own when a select
   * brings no options: look at the rows.
   *
   * `this.allRules` is already loaded (the parent-rule picker needs it) and refreshes on the create
   * and delete events, so this adds no reads. The visible page joins the union because
   * `loadAllRules` is best-effort: if that read fails, the dropdown still offers what is being
   * looked at instead of sitting empty on top of a full table.
   *
   * A code the `enum` no longer admits — the `ZZ` taxes#41 found — stays on the list with its code
   * as its label: its rules are still on the table, and dropping it from the filter would leave
   * visible rows that cannot be narrowed to.
   */
  private get countryFilterOptions(): { value: string; label: string }[] {
    const present = new Set<string>();
    for (const rule of [...this.allRules, ...((this.ctrl?.rows ?? []) as TaxRule[])]) {
      const code = String(rule.country_code ?? '');
      if (code) present.add(code);
    }
    if (!present.size) return [];
    const named = countryOptions(erplora().locale).filter((o) => present.has(o.value));
    const unnamed = [...present].filter((c) => !named.some((o) => o.value === c)).sort();
    return [...named, ...unnamed.map((value) => ({ value, label: value }))];
  }

  /**
   * Las acciones de la fila. Mientras se están mirando las DESACTIVADAS la fila ofrece el camino de
   * vuelta en lugar de «desactivar» (taxes#52): ofrecer desactivar sobre algo ya desactivado es
   * ofrecer no hacer nada. Es lo que hacen Square (`Unarchive`) y Fresha/Treatwell (el `⋯` de la
   * fila), y lo que este mismo repo ya hace en `services` (services#44) — la acción vive en la
   * fila, nunca dentro de la ficha: el «ábrelo, baja del todo, reactiva y vuelve a cambiar el
   * estado» de Shopify son seis toques y dos pantallas para una decisión.
   *
   * On an active row, «Set end date» sits next to «Deactivate» (taxes#66): once two active rules
   * of the same slot can no longer overlap, ending the rule in force is the legal way to schedule
   * a rate change — the way Oracle E-Business Tax and Dynamics 365 let the owner end-date the
   * current rate before the next one starts, instead of deactivating (which drops the rule outright
   * and leaves the slot with no rate at all in the meantime).
   */
  private get rowActions(): DataTableAction[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    if (!can('taxes.manage_tax')) return [];
    // «Repair» only shows up on a page that has something to repair, and only works on those rows
    // (taxes#63): on a healthy hub it would be one more dead button on every row.
    const repair: DataTableAction[] = ((this.ctrl?.rows ?? []) as TaxRule[]).some((r) => isIncoherent(r))
      ? [{ id: 'repair', label: t('ui.actionRepair'), icon: 'construct-outline', color: 'warning', disabled: (row) => !isIncoherent(row) }]
      : [];
    if (this.showingArchived) {
      return [...repair, { id: 'restore', label: t('ui.actionRestore'), icon: 'arrow-undo-outline', color: 'success' }];
    }
    return [
      ...repair,
      { id: 'end', label: t('ui.actionEndRule'), icon: 'calendar-outline' },
      { id: 'deactivate', label: t('ui.actionDeactivate'), icon: 'ban-outline', color: 'danger' },
    ];
  }

  /** How many active rules of the hub are incoherent — all of them, not just the visible page. */
  private get incoherentCount(): number {
    return this.allRules.filter((r) => isIncoherent(r)).length;
  }

  /** How many active rules of the hub overlap another one — all of them, not just the visible page. */
  private get overlapCount(): number {
    return this.allRules.filter((r) => overlaps(r)).length;
  }

  /** The banner's way to the overlapping rules: narrows the table to them, and back (taxes#68). */
  private toggleOverlapFilter(on: boolean): void {
    this.showingOverlaps = on;
    this.ctrl.setFilter('overlaps', on ? '1' : '');
  }

  /**
   * Cambio de filtro de la tabla. `is_active = 0` no es un filtro más: las reglas desactivadas NO
   * están en la respuesta por defecto de `taxes.rules.list` —el keystone (ADR-0069) consume esa
   * misma lectura para resolver una venta, y ahí una regla desactivada no puede aparecer— así que
   * elegir «No» tiene que AMPLIAR el alcance además de filtrar. Sin eso, la caja solo podría pintar
   * una tabla vacía, que es exactamente el filtro muerto que taxes#50 retiró.
   *
   * El alcance se escribe directo en el contexto del controlador y la recarga se deja en manos de
   * `setFilter`: `setContext` recargaría por su cuenta y el mismo toque costaría DOS viajes al hub.
   */
  private onFilterChange(col: string, value: unknown): void {
    if (col === 'is_active') {
      this.showingArchived = String(value ?? '') === '0';
      this.ctrl.state.context = this.showingArchived ? { include_archived: 1 } : {};
    }
    this.ctrl.setFilter(col, value);
  }

  get parentCandidates(): TaxRule[] {
    const today = new Date().toISOString().slice(0, 10);
    return parentCandidates(this.allRules, this.newCountry, this.newRegion, this.newCategoryKey, today);
  }

  private onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    // El permiso lo decide la PANTALLA, no la tabla: un `rowAction` forjado llega igual (taxes#11).
    if (!can('taxes.manage_tax')) return;
    if (actionId === 'restore') {
      void this.restoreRule(row);
      return;
    }
    if (actionId === 'repair') {
      if (isIncoherent(row)) this.pendingRepair = row as unknown as TaxRule;
      return;
    }
    if (actionId === 'end') {
      if (Number(row.is_active)) this.pendingEnd = row as unknown as TaxRule;
      return;
    }
    if (actionId !== 'deactivate') return;
    if (!Number(row.is_active)) return;
    this.pendingDeactivate = row as unknown as TaxRule;
  }

  /** Devuelve a la vida una regla desactivada (`taxes.rules.activate`). Sin confirmación: reactivar
   *  no es destructivo —deshace algo que sí lo era— y el mercado tampoco la pide (taxes#52). */
  private async restoreRule(row: Record<string, unknown>): Promise<void> {
    this.formError = '';
    try {
      await erplora().command('taxes.rules.activate', { rule_id: String(row.id) });
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errRestoreRule');
    }
  }

  private async onDeactivateDismiss(ev: CustomEvent<{ role?: string }>) {
    const row = this.pendingDeactivate;
    this.pendingDeactivate = null;
    if (ev.detail?.role !== 'confirm' || !row) return;
    this.formError = '';
    try {
      await erplora().command('taxes.rules.deactivate', { rule_id: row.id });
      // The whole hub too, not just the page: the banners count every active rule (taxes#68).
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errDeactivateRule');
    }
  }

  /** Ends the confirmed rule on the chosen date (`taxes.rules.end`, taxes#66): the legal way to
   *  schedule a rate change once overlapping active rules of the same slot are refused. */
  private async onEndDismiss(ev: CustomEvent<{ role?: string; data?: { values?: { valid_to?: string } } }>) {
    const row = this.pendingEnd;
    this.pendingEnd = null;
    const validTo = ev.detail?.data?.values?.valid_to?.trim();
    if (ev.detail?.role !== 'confirm' || !row || !validTo) return;
    this.formError = '';
    try {
      await erplora().command('taxes.rules.end', { rule_id: String(row.id), valid_to: validTo });
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      // A refusal on the overlap check (taxes#66) explains itself instead of leaving the generic
      // banner as the only clue, the same treatment `createRule()` gives it.
      this.formError =
        errorCode(e) === 'taxes.rule_overlaps'
          ? erplora().t(CATALOG, 'ui.errRuleOverlaps')
          : e instanceof Error
            ? e.message
            : erplora().t(CATALOG, 'ui.errEndRule');
    }
  }

  /** Repairs the confirmed rule (`taxes.rules.repair`, taxes#63) in the way the owner chose. */
  private async onRepairDismiss(ev: CustomEvent<{ role?: string }>) {
    const row = this.pendingRepair;
    this.pendingRepair = null;
    const mode = ev.detail?.role;
    if (!row || (mode !== 'no_tax' && mode !== 'charge_tax')) return;
    this.formError = '';
    try {
      await erplora().command('taxes.rules.repair', { rule_id: row.id, mode });
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errRepairRule');
    }
  }

  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    if (typeof window.matchMedia === 'function') {
      this.phoneQuery = window.matchMedia(PHONE_QUERY);
      this.phone = this.phoneQuery.matches;
      this.phoneQuery.addEventListener('change', this.onPhoneChange);
    }
    this.ctrl = createListController<TaxRule>(erplora(), 'taxes.rules.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'country_code',
      dir: 'asc',
    });
    await this.ctrl.load();
    await this.loadCategories();
    await this.loadAllRules();
    try {
      const refresh = () => Promise.all([this.ctrl.load(), this.loadAllRules()]);
      const offs = [
        erplora().on('taxes.rule.created', () => refresh()),
        erplora().on('taxes.rule.deactivated', () => refresh()),
        erplora().on('taxes.rule.activated', () => refresh()),
        erplora().on('taxes.rule.repaired', () => refresh()),
        erplora().on('taxes.rule.ended', () => refresh()),
      ];
      this.unsub = () => offs.forEach((o) => o());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    this.phoneQuery?.removeEventListener('change', this.onPhoneChange);
    this.phoneQuery = undefined;
    super.disconnectedCallback();
    this.unsub?.();
  }

  // TODAS las categorías (no una página): el desplegable del alta y el filtro de la columna las
  // necesitan enteras. Best-effort: si falla, el alta sigue (el runtime revalida la FK).
  private async loadCategories(): Promise<void> {
    try {
      const rows = await erplora().queryAll<TaxCategory>('taxes.categories.list', { sort: 'name', dir: 'asc' });
      this.categories = Array.isArray(rows) ? rows : [];
    } catch {
      this.categories = [];
    }
  }

  // ALL active rules, for the parent picker. Best-effort: without them the picker is empty and the
  // server still validates the link (taxes#9).
  private async loadAllRules(): Promise<void> {
    try {
      const rows = await erplora().queryAll<TaxRule>('taxes.rules.list', { sort: 'tax_category_key', dir: 'asc' });
      this.allRules = Array.isArray(rows) ? rows : [];
    } catch {
      this.allRules = [];
    }
    // The last overlap is gone, and with it the banner that could undo the filter: undo it here
    // rather than leave an empty table with no word about why (taxes#68).
    if (this.showingOverlaps && this.overlapCount === 0) this.toggleOverlapFilter(false);
  }

  /**
   * A card's body: every visible field but the category, which is already its title (taxes#67). Painted with
   * ok-data-table's own card-row markup (`.rrow`/`.rk`/`.rv`, styled in its shadow root, where this
   * renders) so it looks exactly like the cards it does not customise; `render` wins over `format`
   * as it does in the table, so the warning marks of taxes#63/#68 stay.
   */
  private renderRuleCard(row: Record<string, unknown>) {
    return this.columns
      .filter((c) => c.key !== 'tax_category_key' && !this.hiddenColumns.has(c.key))
      .map((c) => html`<div class="rrow"><span class="rk">${c.header}</span><span class="rv">${c.render ? c.render(row) : c.format ? c.format(row) : String(row[c.key] ?? '')}</span></div>`);
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el alta se proyecta dentro).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
  }

  // A class that charges no tax pins the rate to 0 (taxes#59); leaving it asks for the rate again
  // instead of keeping a 0 the owner never typed.
  private setOperationClass(value: string) {
    const wasNoTax = chargesNoTax(this.newOperationClass);
    this.newOperationClass = value;
    if (chargesNoTax(value)) this.newRatePct = '0';
    else if (wasNoTax) this.newRatePct = '';
  }

  private async createRule(ev: Event) {
    ev.preventDefault();
    if (!this.newCountry.trim() || !this.newCategoryKey.trim() || this.newRatePct === '') return;
    this.saving = true;
    this.formError = '';
    try {
      const payload: Record<string, unknown> = {
        country_code: this.newCountry.trim().toUpperCase(),
        tax_category_key: this.newCategoryKey.trim(),
        rate_pct: chargesNoTax(this.newOperationClass) ? 0 : Number(this.newRatePct),
        tax_type: this.newTaxType || 'vat',
      };
      if (this.newRegion.trim()) payload.region_code = this.newRegion.trim().toUpperCase();
      // Qualification: defaults stay implicit (the server COALESCEs to `subject`), and the exemption
      // reason only travels with an exempt class — a stale reason typed before switching class must not.
      if (this.newOperationClass && this.newOperationClass !== 'subject') payload.operation_class = this.newOperationClass;
      if (this.newOperationClass === 'exempt' && this.newExemptReason.trim()) payload.exempt_reason = this.newExemptReason.trim().toUpperCase();
      if (this.newRegimeKey.trim()) payload.regime_key = this.newRegimeKey.trim();
      if (this.newValidFrom.trim()) payload.valid_from = this.newValidFrom.trim();
      if (this.newValidTo.trim()) payload.valid_to = this.newValidTo.trim();
      if (this.newParentId.trim()) payload.parent_id = this.newParentId.trim();
      if (this.newComponentLabel.trim()) payload.component_label = this.newComponentLabel.trim();
      await erplora().command('taxes.rules.create', payload);
      this.newCountry = '';
      this.newRegion = '';
      this.newCategoryKey = '';
      this.newRatePct = '';
      this.newTaxType = 'vat';
      this.newOperationClass = 'subject';
      this.newExemptReason = '';
      this.newRegimeKey = '';
      this.newValidFrom = '';
      this.newValidTo = '';
      this.newParentId = '';
      this.newComponentLabel = '';
      this.validFromError = '';
      this.dataTable()?.close(); // el panel de alta se cierra solo tras crear
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      // A refusal on the overlap check (taxes#66) blames the field the owner has to change instead
      // of leaving the generic banner as the only clue; any other refusal leaves the date alone.
      this.validFromError = errorCode(e) === 'taxes.rule_overlaps' ? erplora().t(CATALOG, 'ui.errRuleOverlaps') : '';
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateRule');
    } finally {
      this.saving = false;
    }
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${can('taxes.manage_tax') ? nothing : html`<ok-inline-feedback data-testid="taxes-rules-readonly" tone="info" icon="lock-closed-outline">${t('ui.readOnlyHint')}</ok-inline-feedback>`}
        ${this.formError ? html`<ok-inline-feedback data-testid="taxes-rules-form-error" tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
        ${this.incoherentCount
          ? html`<ok-inline-feedback data-testid="taxes-rules-incoherent-warning" tone="warning" icon="warning-outline">${erplora().t(CATALOG, this.incoherentCount === 1 ? 'ui.incoherentWarningOne' : 'ui.incoherentWarning', { count: this.incoherentCount })}</ok-inline-feedback>`
          : nothing}
        ${this.overlapCount
          ? html`<ok-inline-feedback data-testid="taxes-rules-overlap-warning" tone="warning" icon="warning-outline">${erplora().t(CATALOG, 'ui.overlapWarning', { count: this.overlapCount })}<ion-button slot="actions" data-testid="taxes-rules-overlap-filter" size="small" fill="outline" @click=${() => this.toggleOverlapFilter(!this.showingOverlaps)}>${this.showingOverlaps ? t('ui.overlapShowAll') : t('ui.overlapShow')}</ion-button></ok-inline-feedback>`
          : nothing}
        ${this.ctrl?.error ? html`<ok-inline-feedback data-testid="taxes-rules-load-error" tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <ok-data-table testid="taxes-rules-table" .serverSide=${true} .fill=${!this.phone} .addable=${can('taxes.manage_tax')} .views=${true} .defaultView=${window.innerWidth <= 834 ? 'cards' : 'table'} .cardTitle=${cardTitle} .renderCard=${(row: Record<string, unknown>) => this.renderRuleCard(row)} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCategoryCountry')} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyRules')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.onFilterChange(e.detail.col, e.detail.value)} @columnsChange=${(e: CustomEvent<{ visible: string[] }>) => (this.hiddenColumns = new Set(this.columns.map((c) => c.key).filter((k) => !e.detail.visible.includes(k))))}>
          <!-- Alta: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara al abrir,
               el «+» de la barra desplegaría un panel vacío. -->
          <form data-testid="taxes-rules-form" slot="create" class="form" @submit=${(e: Event) => this.createRule(e)}>
            <!-- El país se ELIGE de la lista CERRADA que acepta el command (taxes#41): tecleado a
                 mano, ZZ —que ISO 3166-1 deja sin asignar— creaba una regla que no casaba con
                 ningún hub y que nadie volvía a mirar. Combo y no ion-select porque son 249. -->
            <ok-combo data-testid="taxes-rules-country"
              label=${t('ui.colCountry')}
              .options=${countryOptions(erplora().locale)}
              .value=${this.newCountry}
              .labels=${{ placeholder: t('ui.phCountry'), empty: t('ui.noCountryMatch') }}
              @ok-change=${(e: CustomEvent<{ value: string }>) => (this.newCountry = e.detail.value)}
            ></ok-combo>
            <ion-input data-testid="taxes-rules-region" fill="outline" label-placement="floating" label=${t('ui.colRegion')} placeholder=${t('ui.phRegion')} .value=${this.newRegion} @ionInput=${(e: any) => (this.newRegion = e.target.value)}></ion-input>
            <!-- La categoría se ELIGE: la FK (hub_id, tax_category_key) la valida, y una clave mal
                 tecleada era una regla que nunca se aplicaba (o un command rechazado). -->
            <ion-select data-testid="taxes-rules-category" fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategoryKey')} .value=${this.newCategoryKey} @ionChange=${(e: any) => (this.newCategoryKey = e.target.value)}>
              ${this.categories.map((c) => html`<ion-select-option .value=${c.key}>${taxCategoryDisplayName(c)} (${c.key})</ion-select-option>`)}
            </ion-select>
            <ion-input data-testid="taxes-rules-rate" label-placement="floating" label=${t('ui.colRate')} type="number" step="0.01" placeholder=${t('ui.phPercent')} .disabled=${chargesNoTax(this.newOperationClass)} helper-text=${chargesNoTax(this.newOperationClass) ? t('ui.hintRateNoTax') : nothing} .value=${this.newRatePct} @ionInput=${(e: any) => (this.newRatePct = e.target.value)}></ion-input>
            <ion-select data-testid="taxes-rules-tax-type" fill="outline" label-placement="floating" label=${t('ui.colType')} .value=${this.newTaxType} @ionChange=${(e: any) => (this.newTaxType = e.target.value)}>${TAX_TYPES.map((v) => html`<ion-select-option .value=${v}>${t(`ui.taxType_${v}`)}</ion-select-option>`)}</ion-select>
            <!-- Fiscal qualification (ADR-0186, taxes#22): the reason only when exempt; regime optional. -->
            <ion-select data-testid="taxes-rules-operation-class" label-placement="floating" label=${t('ui.colOperationClass')} .value=${this.newOperationClass} @ionChange=${(e: any) => this.setOperationClass(e.target.value ?? 'subject')}>${OPERATION_CLASSES.map((v) => html`<ion-select-option .value=${v}>${t(`ui.opClass_${v}`)}</ion-select-option>`)}</ion-select>
            ${this.newOperationClass === 'exempt'
              ? html`<ion-input data-testid="taxes-rules-exempt-reason" fill="outline" label-placement="floating" label=${t('ui.colExemptReason')} placeholder=${t('ui.phExemptReason')} maxlength="10" .value=${this.newExemptReason} @ionInput=${(e: any) => (this.newExemptReason = e.target.value)}></ion-input>`
              : nothing}
            <ion-input data-testid="taxes-rules-regime-key" fill="outline" label-placement="floating" label=${t('ui.colRegimeKey')} placeholder=${t('ui.phRegimeKey')} maxlength="10" .value=${this.newRegimeKey} @ionInput=${(e: any) => (this.newRegimeKey = e.target.value)}></ion-input>
            <!-- A refusal on the overlap check (taxes#66) marks THIS field with its own sentence
                 instead of leaving the generic banner above as the only clue. -->
            <ion-input data-testid="taxes-rules-valid-from" fill="outline" label-placement="floating" label=${t('ui.colValidFrom')} type="date" class=${classMap({ 'ion-invalid': !!this.validFromError, 'ion-touched': !!this.validFromError })} error-text=${this.validFromError ? this.validFromError : nothing} .value=${this.newValidFrom} @ionInput=${(e: any) => { this.newValidFrom = e.target.value; this.validFromError = ''; }}></ion-input>
            <ion-input data-testid="taxes-rules-valid-to" fill="outline" label-placement="floating" label=${t('ui.colValidTo')} type="date" .value=${this.newValidTo} @ionInput=${(e: any) => (this.newValidTo = e.target.value)}></ion-input>
            <!-- Parent rule (multi-tax component): CHOSEN among the root rules compatible with the
                 country/region/category above (taxes#11) — never a free id. -->
            <ion-select data-testid="taxes-rules-parent" fill="outline" label-placement="floating" label=${t('ui.colParentRule')} placeholder=${this.parentCandidates.length ? t('ui.phParentRule') : t('ui.phParentRuleNone')} ?disabled=${!this.parentCandidates.length} .value=${this.newParentId} @ionChange=${(e: any) => (this.newParentId = e.target.value ?? '')}>
              <ion-select-option .value=${''}>${t('ui.optNoParent')}</ion-select-option>
              ${this.parentCandidates.map((r) => html`<ion-select-option .value=${r.id}>${Number(r.rate_pct).toFixed(2)}% · ${t(`ui.taxType_${r.tax_type}`)}${r.valid_from ? ` · ${r.valid_from}` : ''}</ion-select-option>`)}
            </ion-select>
            <ion-input data-testid="taxes-rules-component-label" fill="outline" label-placement="floating" label=${t('ui.colComponentLabel')} placeholder=${t('ui.phComponentLabel')} .value=${this.newComponentLabel} @ionInput=${(e: any) => (this.newComponentLabel = e.target.value)}></ion-input>
            <p class="hint">${t('ui.rulesHint')}</p>
            <ion-button data-testid="taxes-rules-submit" type="submit" ?disabled=${this.saving || !this.newCountry || !this.newCategoryKey || this.newRatePct === ''}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
          </form>
        </ok-data-table>
        <ion-alert data-testid="taxes-rules-deactivate-confirm"
          .isOpen=${this.pendingDeactivate !== null}
          header=${t('ui.deactivateConfirmTitle')}
          message=${t('ui.deactivateConfirmMessage')}
          .buttons=${[
            { text: t('ui.cancel'), role: 'cancel' },
            { text: t('ui.deactivateConfirmAction'), role: 'confirm', cssClass: 'alert-button-danger' },
          ]}
          @ionAlertDidDismiss=${(e: CustomEvent<{ role?: string }>) => this.onDeactivateDismiss(e)}
        ></ion-alert>
        <!-- Scheduling a rate change (taxes#66): the overlap guard refuses a new active rule while
             the current one is still open-ended, so ending it on a chosen date is what makes the
             change possible, not another way to deactivate. -->
        <ion-alert data-testid="taxes-rules-end-confirm"
          .isOpen=${this.pendingEnd !== null}
          header=${t('ui.endRuleTitle')}
          message=${t('ui.endRuleMessage')}
          .inputs=${[{ name: 'valid_to', type: 'date', value: this.pendingEnd?.valid_to ?? '' }]}
          .buttons=${[
            { text: t('ui.cancel'), role: 'cancel' },
            { text: t('ui.endRuleAction'), role: 'confirm' },
          ]}
          @ionAlertDidDismiss=${(e: CustomEvent<{ role?: string; data?: { values?: { valid_to?: string } } }>) => this.onEndDismiss(e)}
        ></ion-alert>
        <!-- Two readings of the same mistake (taxes#63): the class was right (0 %) or the rate was
             right (charge it). «Keep the rate» only when the rule's own class is the problem. -->
        <ion-alert data-testid="taxes-rules-repair-confirm"
          .isOpen=${this.pendingRepair !== null}
          header=${t('ui.repairConfirmTitle')}
          message=${t('ui.repairConfirmMessage')}
          .buttons=${[
            { text: t('ui.cancel'), role: 'cancel' },
            ...(this.pendingRepair && canRepairByChargingTax(this.pendingRepair) ? [{ text: t('ui.repairChargeTax'), role: 'charge_tax' }] : []),
            { text: t('ui.repairNoTax'), role: 'no_tax' },
          ]}
          @ionAlertDidDismiss=${(e: CustomEvent<{ role?: string }>) => this.onRepairDismiss(e)}
        ></ion-alert>
      </div>`;
  }
}

define('erp-taxes-rules', ErpTaxesRules);
