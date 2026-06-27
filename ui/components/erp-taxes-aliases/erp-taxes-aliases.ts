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

// ADR-0085: un alias mapea un texto libre (p.ej. una columna de un CSV de import)
// a una `tax_category_key` canónica. `source` distingue los enviados con el
// módulo (`shipped`) de los aprendidos en uso (`learned`).
interface TaxAlias {
  id: string;
  alias: string;
  tax_category_key: string;
  source: string;
  is_active: number;
}

interface TaxCategoryRef {
  id: string;
  key: string;
  name: string;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesAliases extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select { flex:1 1 11rem; min-width:9rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() categories: TaxCategoryRef[] = [];

  @state() formError = '';

  @state() newAlias = '';

  @state() newCategoryKey = '';

  @state() newSource = 'learned';

  @state() saving = false;

  private ctrl!: ListController<TaxAlias>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'alias', header: t('ui.colAlias'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'tax_category_key', header: t('ui.colCategory'), sortable: true, filterable: true, filterType: 'text' },
      {
        key: 'source',
        header: t('ui.colSource'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: [
          { value: 'shipped', label: t('ui.srcShipped') },
          { value: 'learned', label: t('ui.srcLearned') },
        ],
        format: (r) => (String(r.source) === 'shipped' ? t('ui.srcShipped') : t('ui.srcLearned')),
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
    this.ctrl = createListController<TaxAlias>(erplora(), 'taxes.aliases.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'alias',
      dir: 'asc',
    });
    await Promise.all([this.ctrl.load(), this.loadAux()]);
    try {
      this.unsub = erplora().on('taxes.alias.created', () => this.ctrl.load());
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
      const page = await erplora().queryPage<TaxCategoryRef>('taxes.categories.list', { limit: 200, offset: 0, sort: 'key', dir: 'asc' });
      this.categories = page?.rows ?? [];
      this.requestUpdate();
    } catch {
      /* el selector de categorías es opcional: se puede teclear la key a mano */
    }
  }

  private async createAlias(ev: Event) {
    ev.preventDefault();
    if (!this.newAlias.trim() || !this.newCategoryKey.trim()) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('taxes.aliases.create', {
        alias: this.newAlias.trim(),
        tax_category_key: this.newCategoryKey.trim(),
        source: this.newSource || 'learned',
      });
      this.newAlias = '';
      this.newCategoryKey = '';
      this.newSource = 'learned';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateAlias');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div>
        <header>
          <h2>${t('ui.aliasesTitle')}</h2>
        </header>
        <form class="form" @submit=${(e) => this.createAlias(e)}>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colAlias')} placeholder=${t('ui.phAlias')} .value=${this.newAlias} @ionInput=${(e: any) => (this.newAlias = e.target.value)}></ion-input>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategoryKey')} .value=${this.newCategoryKey} @ionChange=${(e: any) => (this.newCategoryKey = e.target.value)}>${this.categories.map((c) => html`<ion-select-option .value=${c.key}>${c.key} · ${c.name}</ion-select-option>`)}</ion-select>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colSource')} .value=${this.newSource} @ionChange=${(e: any) => (this.newSource = e.target.value)}>
            <ion-select-option value="learned">${t('ui.srcLearned')}</ion-select-option>
            <ion-select-option value="shipped">${t('ui.srcShipped')}</ion-select-option>
          </ion-select>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newAlias || !this.newCategoryKey}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchAlias')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyAliases')} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-taxes-aliases', ErpTaxesAliases);
