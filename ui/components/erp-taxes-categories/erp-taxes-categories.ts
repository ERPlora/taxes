import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
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

interface TaxCategory {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: number;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesCategories extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input { flex:1 1 11rem; min-width:9rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() formError = '';

  @state() newCode = '';

  @state() newName = '';

  @state() newDescription = '';

  @state() saving = false;

  private ctrl!: ListController<TaxCategory>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'code', header: t('ui.colCode'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'name', header: t('ui.colName'), sortable: true, filterable: true, filterType: 'text' },
      {
        key: 'description',
        header: t('ui.colDescription'),
        sortable: true,
        filterable: true,
        filterType: 'text',
        format: (r) => (r.description as string) || '—',
      },
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

  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    this.ctrl = createListController<TaxCategory>(erplora(), 'taxes.categories.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'name',
      dir: 'asc',
    });
    await this.ctrl.load();
    try {
      this.unsub = erplora().on('taxes.category.created', () => this.ctrl.load());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async createCategory(ev: Event) {
    ev.preventDefault();
    if (!this.newCode.trim() || !this.newName.trim()) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('taxes.categories.create', {
        code: this.newCode.trim(),
        name: this.newName.trim(),
        description: this.newDescription.trim(),
      });
      this.newCode = '';
      this.newName = '';
      this.newDescription = '';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateCategory');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div>
        <header>
          <h2>${t('ui.categoriesTitle')}</h2>
        </header>
        <form class="form" @submit=${(e) => this.createCategory(e)}>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCode')} placeholder=${t('ui.phCode')} .value=${this.newCode} @ionInput=${(e: any) => (this.newCode = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colName')} placeholder=${t('ui.phName')} .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colDescription')} placeholder=${t('ui.phDescription')} .value=${this.newDescription} @ionInput=${(e: any) => (this.newDescription = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCode || !this.newName}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCodeName')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyCategories')} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-taxes-categories', ErpTaxesCategories);
