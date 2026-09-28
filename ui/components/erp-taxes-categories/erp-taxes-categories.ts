import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
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
// Capa de PRESENTACIÓN del nombre de la categoría (taxes#30): el seed lo guarda en inglés canónico
// (ADR-0055) y aquí se traduce por su `key`, sin tocar el dato. Lo que crea el usuario pasa tal cual.
import { taxCategoryDisplayDescription, taxCategoryDisplayName } from '../../lib/tax-category-name';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** Effective permission of the signed-in user (taxes#11). Optional: a preview without it stays permissive. */
  hasPermission?(permission: string): boolean;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

// ADR-0085: la identidad enlazable de una categoría fiscal es ahora `key`
// (p.ej. `restaurant.food`), no un `code` libre. Las categorías de sistema
// (`is_system`) las siembra el módulo y no se editan a mano.
interface TaxCategory {
  id: string;
  key: string;
  name: string;
  description: string;
  is_system: number;
  is_active: number;
  /** Nombre y descripción presentables, resueltos por la query al idioma del hub (taxes#38). */
  display_name?: string;
  display_description?: string;
}

// The runtime enforces the permission on every command; this only shapes the surface (taxes#11).
function can(permission: string): boolean {
  return erplora().hasPermission?.(permission) ?? true;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesCategories extends LitElement {
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

  /** What «Add» in the panel was refused: painted inside that form, never on the page (pm#513). */
  @state() formError = '';

  @state() newKey = '';

  @state() newName = '';

  @state() newDescription = '';

  @state() saving = false;

  private ctrl!: ListController<TaxCategory>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'key', header: t('ui.colKey'), sortable: true, filterable: true, filterType: 'text' },
      // El nombre y la descripción PRESENTABLES los resuelve la query (taxes#38): la columna ordena
      // y filtra por el mismo texto que enseña, no por el `name` inglés del seed.
      { key: 'display_name', header: t('ui.colName'), sortable: true, filterable: true, filterType: 'text', format: (r) => taxCategoryDisplayName(r as TaxCategory) },
      {
        key: 'display_description',
        header: t('ui.colDescription'),
        sortable: true,
        filterable: true,
        filterType: 'text',
        format: (r) => taxCategoryDisplayDescription(r as TaxCategory) || '—',
      },
      {
        key: 'is_system',
        header: t('ui.colSystem'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: [
          { value: '1', label: t('ui.optSystem') },
          { value: '0', label: t('ui.optCustom') },
        ],
        format: (r) => (Number(r.is_system) ? `🔒 ${t('ui.optSystem')}` : t('ui.optCustom')),
      },
      // NO filtrable (taxes#50): `queries/categories_list.sql` termina en `AND c.is_active = 1`,
      // así que un filtro «No» nunca podría devolver una fila.
      {
        key: 'is_active',
        header: t('ui.colActive'),
        sortable: true,
        format: (r) => (Number(r.is_active) ? t('ui.optYes') : t('ui.optNo')),
      },
    ];
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el alta se proyecta dentro).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
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
    if (!this.newKey.trim() || !this.newName.trim()) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('taxes.categories.create', {
        key: this.newKey.trim(),
        name: this.newName.trim(),
        description: this.newDescription.trim(),
      });
      this.newKey = '';
      this.newName = '';
      this.newDescription = '';
      this.dataTable()?.close(); // el panel de alta se cierra solo tras crear
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateCategory');
    } finally {
      this.saving = false;
    }
  }

  /** pm#513: the refusal appears above the button that was pressed — on a phone that can leave it
   *  off the sheet. Bring it into view when it appears, not again on every keystroke. */
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('formError') && this.formError) void this.revealRefusal('[data-testid="taxes-categories-form-error"]');
  }

  /** ok-inline-feedback lays itself out in its own update: scrolled to before it, the box is empty. */
  private async revealRefusal(selector: string): Promise<void> {
    const banner = this.renderRoot.querySelector(selector) as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    await banner?.updateComplete;
    banner?.scrollIntoView?.({ block: 'center' });
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${can('taxes.manage_tax') ? nothing : html`<ok-inline-feedback data-testid="taxes-categories-readonly" tone="info" icon="lock-closed-outline">${t('ui.readOnlyHint')}</ok-inline-feedback>`}
        ${this.ctrl?.error ? html`<ok-inline-feedback data-testid="taxes-categories-load-error" tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <ok-data-table testid="taxes-categories-table" .serverSide=${true} .fill=${true} .addable=${can('taxes.manage_tax')} .views=${true} .cardTitle=${(row: Record<string, unknown>) => taxCategoryDisplayName(row as TaxCategory) || String(row.key ?? '')} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${t('ui.searchKeyName')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyCategories')} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- Alta: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara al abrir,
               el «+» de la barra desplegaría un panel vacío. -->
          <form data-testid="taxes-categories-form" slot="create" class="form" @submit=${(e: Event) => this.createCategory(e)}>
            <ion-input data-testid="taxes-categories-key" fill="outline" label-placement="floating" label=${t('ui.colKey')} placeholder=${t('ui.phKey')} .value=${this.newKey} @ionInput=${(e: any) => (this.newKey = e.target.value)}></ion-input>
            <ion-input data-testid="taxes-categories-name" fill="outline" label-placement="floating" label=${t('ui.colName')} placeholder=${t('ui.phName')} .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
            <ion-input data-testid="taxes-categories-description" fill="outline" label-placement="floating" label=${t('ui.colDescription')} placeholder=${t('ui.phDescription')} .value=${this.newDescription} @ionInput=${(e: any) => (this.newDescription = e.target.value)}></ion-input>
            <!-- pm#513: the refusal travels WITH the form — under 834 px the panel is a full-screen
                 sheet and a notice on the page underneath it is never seen. -->
            ${this.formError ? html`<ok-inline-feedback data-testid="taxes-categories-form-error" tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
            <ion-button data-testid="taxes-categories-submit" type="submit" ?disabled=${this.saving || !this.newKey || !this.newName}>${this.saving ? t('ui.btnSaving') : t('ui.btnAdd')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-taxes-categories', ErpTaxesCategories);
