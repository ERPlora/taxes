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

interface TaxRate {
  id: string;
  code: string;
  name: string;
  category_id: string;
  country_code: string;
  region_code: string;
  rate_pct: string;
  tax_type: string;
  is_active: number;
}

interface TaxCategory {
  id: string;
  code: string;
  name: string;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesRates extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select { flex:1 1 11rem; min-width:9rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() categories: TaxCategory[] = [];

  @state() formError = '';

  @state() newCode = '';

  @state() newCountry = '';

  @state() newPct = '';

  @state() newCategory = '';

  @state() saving = false;

  @state() tick = 0;

  private ctrl!: ListController<TaxRate>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'country_code', header: t('ui.colCountry'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'code', header: t('ui.colCode'), sortable: true, filterable: true, filterType: 'text' },
      {
        key: 'category_id',
        header: t('ui.colCategory'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: this.categories.map((c) => ({ value: c.id, label: c.code })),
        format: (r) => this.catName(r.category_id as string),
      },
      { key: 'tax_type', header: t('ui.colType'), sortable: true, filterable: true, filterType: 'range' },
      {
        key: 'rate_pct',
        header: t('ui.colPercent'),
        align: 'right',
        sortable: true,
        filterable: true,
        filterType: 'range',
        format: (r) => Number(r.rate_pct).toFixed(2),
      },
      {
        key: 'is_active',
        header: t('ui.colActiveMasc'),
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
    return [{ id: 'deactivate', label: erplora().t(CATALOG, 'ui.actionDeactivate'), color: 'danger' }];
  }

  private readonly onLocaleChange = (): void => this.requestUpdate();

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    this.ctrl = createListController<TaxRate>(erplora(), 'taxes.rates.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'name',
      dir: 'asc',
    });
    await Promise.all([this.ctrl.load(), this.loadAux()]);
    try {
      const off1 = erplora().on('taxes.rate.created', () => this.ctrl.load());
      const off2 = erplora().on('taxes.rate.deactivated', () => this.ctrl.load());
      const off3 = erplora().on('taxes.category.created', () => this.loadAux());
      this.unsub = () => {
        off1();
        off2();
        off3();
      };
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async loadAux() {
    try {
      this.categories = (await erplora().query<TaxCategory[]>('taxes.categories.list')) ?? [];
    } catch {
      /* categorías opcionales para el alta y el filtro */
    }
  }

  private async createRate(ev: Event) {
    ev.preventDefault();
    if (!this.newCode.trim() || !this.newCountry.trim() || !this.newCategory) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('taxes.rates.create', {
        code: this.newCode.trim(),
        name: '',
        category_id: this.newCategory,
        country_code: this.newCountry.trim().toUpperCase(),
        region_code: '',
        rate_pct: Number(this.newPct) || 0,
        tax_type: 'vat',
        applies_from: null,
        applies_until: null,
      });
      this.newCode = '';
      this.newCountry = '';
      this.newPct = '';
      this.newCategory = '';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateRate');
    } finally {
      this.saving = false;
    }
  }

  private catName(id: string): string {
    return this.categories.find((c) => c.id === id)?.code ?? '—';
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    if (ev.detail.actionId !== 'deactivate') return;
    const rate = ev.detail.row as unknown as TaxRate;
    if (!Number(rate.is_active)) return; // ya inactivo: no-op
    this.formError = '';
    try {
      await erplora().command('taxes.rates.deactivate', { rate_id: rate.id });
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errDeactivateRate');
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div>
        <header>
          <h2>${t('ui.ratesTitle')}</h2>
        </header>
        <form class="form" @submit=${(e) => this.createRate(e)}>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCode')} placeholder=${t('ui.phCode')} .value=${this.newCode} @ionInput=${(e: any) => (this.newCode = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCountry')} placeholder=${t('ui.phCountry')} .value=${this.newCountry} @ionInput=${(e: any) => (this.newCountry = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.lblPercent')} type="number" step="0.0001" placeholder=${t('ui.phPercent')} .value=${this.newPct} @ionInput=${(e: any) => (this.newPct = e.target.value)}></ion-input>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategory')} .value=${this.newCategory} @ionChange=${(e: any) => (this.newCategory = e.target.value)}>${this.categories.map((c) => html`<ion-select-option .value=${c.id}>${c.code}</ion-select-option>`)}</ion-select>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCode || !this.newCountry || !this.newCategory}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCountryCode')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyRates')} .actions=${this.rowActions} @rowAction=${(e: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-taxes-rates', ErpTaxesRates);
