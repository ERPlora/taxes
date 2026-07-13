import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
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
  parent_id: string;
  component_label: string;
  valid_from: string;
  valid_to: string;
  is_active: number;
}

const TAX_TYPES = ['vat', 'surcharge', 'sales_tax', 'withholding', 'excise', 'import_duty'] as const;

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesRules extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select { flex:1 1 9rem; min-width:7rem; }
    .form .narrow { flex:1 1 6rem; min-width:5rem; }
    .hint { color:#6b675e; font-size:.85rem; margin:.25rem 0 .5rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() formError = '';

  @state() newCountry = '';

  @state() newRegion = '';

  @state() newCategoryKey = '';

  @state() newRatePct = '';

  @state() newTaxType = 'vat';

  @state() newValidFrom = '';

  @state() newValidTo = '';

  // Componente multi-tributo (opcional): cuelga de una regla raíz existente.
  @state() newParentId = '';

  @state() newComponentLabel = '';

  @state() saving = false;

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
        filterType: 'text',
        format: (r) => {
          const key = String(r.tax_category_key ?? '') || '—';
          const label = String(r.component_label ?? '');
          return r.parent_id && label ? `↳ ${key} · ${label}` : key;
        },
      },
      { key: 'country_code', header: t('ui.colCountry'), sortable: true, filterable: true, filterType: 'text' },
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

  private get rowActions(): DataTableAction[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [{ id: 'deactivate', label: t('ui.actionDeactivate'), color: 'danger' }];
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    if (actionId !== 'deactivate') return;
    if (!Number(row.is_active)) return;
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
    try {
      const offs = [
        erplora().on('taxes.rule.created', () => this.ctrl.load()),
        erplora().on('taxes.rule.deactivated', () => this.ctrl.load()),
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
      this.newValidFrom = '';
      this.newValidTo = '';
      this.newParentId = '';
      this.newComponentLabel = '';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateRule');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div>
        <header>
          <h2>${t('ui.rulesTitle')}</h2>
        </header>
        <form class="form" @submit=${(e) => this.createRule(e)}>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colCountry')} placeholder=${t('ui.phCountry')} maxlength="2" .value=${this.newCountry} @ionInput=${(e: any) => (this.newCountry = e.target.value)}></ion-input>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colRegion')} placeholder=${t('ui.phRegion')} .value=${this.newRegion} @ionInput=${(e: any) => (this.newRegion = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategoryKey')} .value=${this.newCategoryKey} @ionInput=${(e: any) => (this.newCategoryKey = e.target.value)}></ion-input>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colRate')} type="number" step="0.01" placeholder=${t('ui.phPercent')} .value=${this.newRatePct} @ionInput=${(e: any) => (this.newRatePct = e.target.value)}></ion-input>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colType')} .value=${this.newTaxType} @ionChange=${(e: any) => (this.newTaxType = e.target.value)}>${TAX_TYPES.map((v) => html`<ion-select-option .value=${v}>${t(`ui.taxType_${v}`)}</ion-select-option>`)}</ion-select>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colValidFrom')} type="date" .value=${this.newValidFrom} @ionInput=${(e: any) => (this.newValidFrom = e.target.value)}></ion-input>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colValidTo')} type="date" .value=${this.newValidTo} @ionInput=${(e: any) => (this.newValidTo = e.target.value)}></ion-input>
          <ion-input class="narrow" fill="outline" label-placement="floating" label=${t('ui.colParentId')} placeholder=${t('ui.phParentId')} .value=${this.newParentId} @ionInput=${(e: any) => (this.newParentId = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colComponentLabel')} placeholder=${t('ui.phComponentLabel')} .value=${this.newComponentLabel} @ionInput=${(e: any) => (this.newComponentLabel = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCountry || !this.newCategoryKey || this.newRatePct === ''}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
        </form>
        <p class="hint">${t('ui.rulesHint')}</p>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCategoryCountry')} .actions=${this.rowActions} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyRules')} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-taxes-rules', ErpTaxesRules);
