import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
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

// The runtime enforces the permission on every command; this only shapes the surface (taxes#11):
// a viewer (taxes.view_tax) gets a read-only table, a manager (taxes.manage_tax) the full one.
function can(permission: string): boolean {
  return erplora().hasPermission?.(permission) ?? true;
}

// Root rules a component may hang from (taxes#11): the same conditions the server enforces in
// `commands/rule_create.sql` (taxes#9) — a ROOT of the same country/region/category — plus «valid
// today», so the picker only shows what would be accepted and what still applies.
export function parentCandidates(rules: TaxRule[], country: string, region: string, category: string, today: string): TaxRule[] {
  const c = country.trim().toUpperCase();
  const r = region.trim().toUpperCase();
  const k = category.trim();
  if (!c || !k) return [];
  return rules.filter(
    (x) =>
      !x.parent_id &&
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

export class ErpTaxesRules extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
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

  @state() newValidTo = '';

  // Multi-tax component (optional): hangs from an existing root rule, CHOSEN among the compatible
  // ones (taxes#11) — never typed as a free id.
  @state() newParentId = '';

  // All active rules of the hub (not a page): the parent picker filters them client-side.
  @state() private allRules: TaxRule[] = [];

  @state() newComponentLabel = '';

  @state() saving = false;

  @state() private pendingDeactivate: TaxRule | null = null;

  // Categorías fiscales del hub: pueblan el selector del alta y el filtro de la columna.
  @state() private categories: TaxCategory[] = [];

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
      // La jurisdicción se ELIGE también aquí (taxes#48): desde taxes#41 el dominio de
      // `country_code` es la lista ISO cerrada, y el servidor la declara `op: eq` en module.json.
      {
        key: 'country_code',
        header: t('ui.colCountry'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: this.countryFilterOptions,
      },
      // La región NO es el mismo caso y se queda como caja de texto A PROPÓSITO (taxes#48):
      // `schemas/rule_create.json` le pone un `pattern`, no un `enum` —ISO 3166-2 es aquí una FORMA,
      // no una lista, y no hay fuente de subdivisiones como `Intl.DisplayNames` da los países—, y un
      // desplegable no sabría decir «sin región»: `ok-data-table` lee el valor vacío como «quita el
      // filtro», y sin región —el país entero— es el caso NORMAL. Por eso el manifest le deja
      // `like`: una caja de texto invita a un fragmento, y con `like` el fragmento es lo que hace.
      { key: 'region_code', header: t('ui.colRegion'), sortable: true, filterable: true, filterType: 'text', format: (r) => String(r.region_code ?? '') || '—' },
      {
        key: 'rate_pct',
        header: t('ui.colRate'),
        align: 'right',
        sortable: true,
        format: (r) => `${Number(r.rate_pct).toFixed(2)}%`,
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
      { key: 'valid_from', header: t('ui.colValidFrom'), sortable: true, format: (r) => String(r.valid_from ?? '') || '—' },
      { key: 'valid_to', header: t('ui.colValidTo'), sortable: true, format: (r) => String(r.valid_to ?? '') || '—' },
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
   * Las opciones del filtro de país: las jurisdicciones para las que este hub TIENE reglas.
   *
   * No son las 249 del `enum` (taxes#48). `ok-data-table` pinta un `filterType: 'select'` como un
   * `ion-select` SIN buscador, así que darle la lista entera reconstruiría el control que el alta,
   * un elemento más abajo, ya rechazó por escrito: «combo y no ion-select porque son 249». Y un
   * filtro no es un alta — narra lo que hay en la tabla, así que 247 de esos 249 solo podrían
   * contestar con una lista vacía. Es lo mismo que hace la columna de al lado (la categoría sale de
   * `this.categories`) y lo que `ok-data-table` hace por su cuenta cuando un select no trae
   * opciones: mirar las filas.
   *
   * `this.allRules` ya está cargado (lo pide el selector de regla padre) y se refresca con los
   * eventos de alta y baja, así que esto no añade ni una lectura. La página visible entra en la
   * unión porque `loadAllRules` es best-effort: si esa lectura falla, el desplegable sigue
   * ofreciendo lo que se está viendo en vez de quedarse vacío encima de una tabla llena.
   *
   * Un código que el `enum` ya no admite —el `ZZ` que encontró taxes#41— se queda en la lista con
   * su código por etiqueta: sus reglas siguen en la tabla, y sacarlo del filtro dejaría filas
   * visibles que no se pueden acotar.
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

  private get rowActions(): DataTableAction[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    if (!can('taxes.manage_tax')) return [];
    return [{ id: 'deactivate', label: t('ui.actionDeactivate'), icon: 'ban-outline', color: 'danger' }];
  }

  get parentCandidates(): TaxRule[] {
    const today = new Date().toISOString().slice(0, 10);
    return parentCandidates(this.allRules, this.newCountry, this.newRegion, this.newCategoryKey, today);
  }

  private onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    if (actionId !== 'deactivate' || !can('taxes.manage_tax')) return;
    if (!Number(row.is_active)) return;
    this.pendingDeactivate = row as unknown as TaxRule;
  }

  private async onDeactivateDismiss(ev: CustomEvent<{ role?: string }>) {
    const row = this.pendingDeactivate;
    this.pendingDeactivate = null;
    if (ev.detail?.role !== 'confirm' || !row) return;
    this.formError = '';
    try {
      await erplora().command('taxes.rules.deactivate', { rule_id: row.id });
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errDeactivateRule');
    }
  }

  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
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
      ];
      this.unsub = () => offs.forEach((o) => o());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
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
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el alta se proyecta dentro).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
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
        rate_pct: Number(this.newRatePct),
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
      this.dataTable()?.close(); // el panel de alta se cierra solo tras crear
      await Promise.all([this.ctrl.load(), this.loadAllRules()]);
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateRule');
    } finally {
      this.saving = false;
    }
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${can('taxes.manage_tax') ? nothing : html`<ok-inline-feedback tone="info" icon="lock-closed-outline">${t('ui.readOnlyHint')}</ok-inline-feedback>`}
        ${this.formError ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
        ${this.ctrl?.error ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <ok-data-table .serverSide=${true} .fill=${true} .addable=${can('taxes.manage_tax')} .views=${true} .defaultView=${window.innerWidth <= 834 ? 'cards' : 'table'} .cardTitle=${(row: Record<string, unknown>) => String(row.tax_category_key ?? row.country_code ?? '')} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCategoryCountry')} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyRules')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- Alta: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara al abrir,
               el «+» de la barra desplegaría un panel vacío. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createRule(e)}>
            <!-- El país se ELIGE de la lista CERRADA que acepta el command (taxes#41): tecleado a
                 mano, ZZ —que ISO 3166-1 deja sin asignar— creaba una regla que no casaba con
                 ningún hub y que nadie volvía a mirar. Combo y no ion-select porque son 249. -->
            <ok-combo
              label=${t('ui.colCountry')}
              .options=${countryOptions(erplora().locale)}
              .value=${this.newCountry}
              .labels=${{ placeholder: t('ui.phCountry'), empty: t('ui.noCountryMatch') }}
              @ok-change=${(e: CustomEvent<{ value: string }>) => (this.newCountry = e.detail.value)}
            ></ok-combo>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colRegion')} placeholder=${t('ui.phRegion')} .value=${this.newRegion} @ionInput=${(e: any) => (this.newRegion = e.target.value)}></ion-input>
            <!-- La categoría se ELIGE: la FK (hub_id, tax_category_key) la valida, y una clave mal
                 tecleada era una regla que nunca se aplicaba (o un command rechazado). -->
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategoryKey')} .value=${this.newCategoryKey} @ionChange=${(e: any) => (this.newCategoryKey = e.target.value)}>
              ${this.categories.map((c) => html`<ion-select-option .value=${c.key}>${taxCategoryDisplayName(c)} (${c.key})</ion-select-option>`)}
            </ion-select>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colRate')} type="number" step="0.01" placeholder=${t('ui.phPercent')} .value=${this.newRatePct} @ionInput=${(e: any) => (this.newRatePct = e.target.value)}></ion-input>
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colType')} .value=${this.newTaxType} @ionChange=${(e: any) => (this.newTaxType = e.target.value)}>${TAX_TYPES.map((v) => html`<ion-select-option .value=${v}>${t(`ui.taxType_${v}`)}</ion-select-option>`)}</ion-select>
            <!-- Fiscal qualification (ADR-0186, taxes#22): the reason only when exempt; regime optional. -->
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colOperationClass')} .value=${this.newOperationClass} @ionChange=${(e: any) => (this.newOperationClass = e.target.value ?? 'subject')}>${OPERATION_CLASSES.map((v) => html`<ion-select-option .value=${v}>${t(`ui.opClass_${v}`)}</ion-select-option>`)}</ion-select>
            ${this.newOperationClass === 'exempt'
              ? html`<ion-input fill="outline" label-placement="floating" label=${t('ui.colExemptReason')} placeholder=${t('ui.phExemptReason')} maxlength="10" .value=${this.newExemptReason} @ionInput=${(e: any) => (this.newExemptReason = e.target.value)}></ion-input>`
              : nothing}
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colRegimeKey')} placeholder=${t('ui.phRegimeKey')} maxlength="10" .value=${this.newRegimeKey} @ionInput=${(e: any) => (this.newRegimeKey = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colValidFrom')} type="date" .value=${this.newValidFrom} @ionInput=${(e: any) => (this.newValidFrom = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colValidTo')} type="date" .value=${this.newValidTo} @ionInput=${(e: any) => (this.newValidTo = e.target.value)}></ion-input>
            <!-- Parent rule (multi-tax component): CHOSEN among the root rules compatible with the
                 country/region/category above (taxes#11) — never a free id. -->
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colParentRule')} placeholder=${this.parentCandidates.length ? t('ui.phParentRule') : t('ui.phParentRuleNone')} ?disabled=${!this.parentCandidates.length} .value=${this.newParentId} @ionChange=${(e: any) => (this.newParentId = e.target.value ?? '')}>
              <ion-select-option .value=${''}>${t('ui.optNoParent')}</ion-select-option>
              ${this.parentCandidates.map((r) => html`<ion-select-option .value=${r.id}>${Number(r.rate_pct).toFixed(2)}% · ${t(`ui.taxType_${r.tax_type}`)}${r.valid_from ? ` · ${r.valid_from}` : ''}</ion-select-option>`)}
            </ion-select>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colComponentLabel')} placeholder=${t('ui.phComponentLabel')} .value=${this.newComponentLabel} @ionInput=${(e: any) => (this.newComponentLabel = e.target.value)}></ion-input>
            <p class="hint">${t('ui.rulesHint')}</p>
            <ion-button type="submit" ?disabled=${this.saving || !this.newCountry || !this.newCategoryKey || this.newRatePct === ''}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
          </form>
        </ok-data-table>
        <ion-alert
          .isOpen=${this.pendingDeactivate !== null}
          header=${t('ui.deactivateConfirmTitle')}
          message=${t('ui.deactivateConfirmMessage')}
          .buttons=${[
            { text: t('ui.cancel'), role: 'cancel' },
            { text: t('ui.deactivateConfirmAction'), role: 'confirm', cssClass: 'alert-button-danger' },
          ]}
          @ionAlertDidDismiss=${(e: CustomEvent<{ role?: string }>) => this.onDeactivateDismiss(e)}
        ></ion-alert>
      </div>`;
  }
}

define('erp-taxes-rules', ErpTaxesRules);
