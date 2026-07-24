import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
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
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    /* El alta vive en el panel lateral de la tabla (estrecho): los campos van APILADOS. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
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
      {
        key: 'tax_category_key',
        header: t('ui.colCategory'),
        sortable: true,
        filterable: true,
        // Dominio cerrado: las categorías fiscales del hub. Se ELIGE (el servidor la filtra por
        // `eq`, así que el `value` es la `key` canónica), no se teclea: una key mal escrita en un
        // alias mete el IVA equivocado en el import.
        filterType: 'select',
        options: this.categories.map((c) => ({ value: c.key, label: `${c.key} · ${c.name}` })),
      },
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

  /** Referencia a la tabla para cerrar su panel lateral (el del «+») tras el alta. */
  private dataTable(): (HTMLElement & { close: () => void }) | null {
    return this.renderRoot.querySelector('ok-data-table') as (HTMLElement & { close: () => void }) | null;
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
      this.dataTable()?.close(); // cierra el panel de alta tras crear
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateAlias');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${this.formError ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
        ${this.ctrl?.error ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <ok-data-table .serverSide=${true} .fill=${true} .addable=${true} .views=${true} .cardTitle=${(row: Record<string, unknown>) => String(row.alias ?? '')} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchAlias')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyAliases')} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- Alta de alias: el botón «+» de la tabla despliega este panel. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createAlias(e)}>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colAlias')} placeholder=${t('ui.phAlias')} .value=${this.newAlias} @ionInput=${(e: any) => (this.newAlias = e.target.value)}></ion-input>
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colCategory')} placeholder=${t('ui.phCategoryKey')} .value=${this.newCategoryKey} @ionChange=${(e: any) => (this.newCategoryKey = e.target.value)}>${this.categories.map((c) => html`<ion-select-option .value=${c.key}>${c.key} · ${c.name}</ion-select-option>`)}</ion-select>
            <ion-select fill="outline" label-placement="floating" label=${t('ui.colSource')} .value=${this.newSource} @ionChange=${(e: any) => (this.newSource = e.target.value)}>
              <ion-select-option value="learned">${t('ui.srcLearned')}</ion-select-option>
              <ion-select-option value="shipped">${t('ui.srcShipped')}</ion-select-option>
            </ion-select>
            <ion-button type="submit" ?disabled=${this.saving || !this.newAlias || !this.newCategoryKey}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-taxes-aliases', ErpTaxesAliases);
