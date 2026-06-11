import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

interface TaxRule {
  id: string;
  code: string;
  name: string;
  conditions: string;
  tax_rate_id: string;
  priority: number;
  is_active: number;
}

interface TaxRate {
  id: string;
  code: string;
  country_code: string;
  rate_pct: string;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpTaxesRules extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select { --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6); border-radius:8px; min-width:8rem; }
    .form .wide { min-width: 18rem; }
    .hint { color:#6b675e; font-size:.85rem; margin:.25rem 0 .5rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() rates: TaxRate[] = [];

  @state() formError = '';

  @state() newCode = '';

  @state() newName = '';

  @state() newConditions = '';

  @state() newRateId = '';

  @state() newPriority = '';

  @state() saving = false;

  private ctrl!: ListController<TaxRule>;

  private unsub?: () => void;

  private get columns(): DataTableColumn[] {
    return [
      { key: 'priority', header: 'Prioridad', align: 'right', sortable: true, filterable: true, filterType: 'text' },
      { key: 'code', header: 'Código', sortable: true, filterable: true, filterType: 'text' },
      { key: 'name', header: 'Nombre', sortable: true, filterable: true, filterType: 'text' },
      { key: 'conditions', header: 'Condiciones', format: (r) => String(r.conditions ?? '') || '—' },
      {
        key: 'tax_rate_id',
        header: 'Tipo aplicado',
        sortable: true,
        format: (r) => this.rateName(r.tax_rate_id as string),
      },
      {
        key: 'is_active',
        header: 'Activa',
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: [
          { value: '1', label: 'Sí' },
          { value: '0', label: 'No' },
        ],
        format: (r) => (Number(r.is_active) ? 'Sí' : 'No'),
      },
    ];
  }

  async connectedCallback() {
    super.connectedCallback();
    this.ctrl = createListController<TaxRule>(erplora(), 'taxes.rules.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'priority',
      dir: 'asc',
    });
    await Promise.all([this.ctrl.load(), this.loadAux()]);
    try {
      const offs = [
        erplora().on('taxes.rule.created', () => this.ctrl.load()),
        erplora().on('taxes.rate.created', () => this.loadAux()),
        erplora().on('taxes.rate.deactivated', () => this.loadAux()),
      ];
      this.unsub = () => offs.forEach((o) => o());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async loadAux() {
    try {
      const page = await erplora().queryPage<TaxRate>('taxes.rates.list', { limit: 200, offset: 0, sort: 'code', dir: 'asc' });
      this.rates = page?.rows ?? [];
      this.requestUpdate();
    } catch {
      /* tipos opcionales para el selector del alta */
    }
  }

  private rateName(id: string): string {
    const r = this.rates.find((x) => x.id === id);
    return r ? `${r.country_code} · ${r.code} (${Number(r.rate_pct).toFixed(2)}%)` : id || '—';
  }

  private async createRule(ev: Event) {
    ev.preventDefault();
    if (!this.newCode.trim() || !this.newName.trim() || !this.newRateId) return;
    let conditions: Record<string, unknown> = {};
    const raw = this.newConditions.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no es un objeto');
        conditions = parsed as Record<string, unknown>;
      } catch {
        this.formError = 'Condiciones: JSON inválido (debe ser un objeto, p.ej. {"customer_segment":"vip"})';
        return;
      }
    }
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('taxes.rules.create', {
        code: this.newCode.trim(),
        name: this.newName.trim(),
        conditions,
        tax_rate_id: this.newRateId,
        priority: this.newPriority === '' ? 100 : Math.trunc(Number(this.newPriority)) || 100,
      });
      this.newCode = '';
      this.newName = '';
      this.newConditions = '';
      this.newRateId = '';
      this.newPriority = '';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo crear la regla';
    } finally {
      this.saving = false;
    }
  }

  render() {
    return html`<div>
        <header>
          <h2>Reglas de aplicación</h2>
        </header>
        <form class="form" @submit=${(e) => this.createRule(e)}>
          <ion-input placeholder="Código (vip-es)" .value=${this.newCode} @ionInput=${(e: any) => (this.newCode = e.target.value)}></ion-input>
          <ion-input placeholder="Nombre" .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
          <ion-input class="wide" placeholder='Condiciones JSON ({"customer_segment":"vip"})' .value=${this.newConditions} @ionInput=${(e: any) => (this.newConditions = e.target.value)}></ion-input>
          <ion-select placeholder="Tipo a aplicar…" .value=${this.newRateId} @ionChange=${(e: any) => (this.newRateId = e.target.value)}>${this.rates.map((r) => html`<ion-select-option .value=${r.id}>${this.rateName(r.id)}</ion-select-option>`)}</ion-select>
          <ion-input type="number" step="1" placeholder="Prioridad (100)" .value=${this.newPriority} @ionInput=${(e: any) => (this.newPriority = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCode || !this.newName || !this.newRateId}>${this.saving ? 'Guardando…' : 'Añadir'}</ion-button>
        </form>
        <p class="hint">Las reglas se evalúan por prioridad ascendente (menor gana) y mapean condiciones (país, segmento de cliente, categoría de producto…) a un tipo concreto.</p>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .searchPlaceholder=${"Buscar código o nombre…"} .emptyMessage=${this.ctrl?.loading ? 'Cargando…' : 'Sin reglas fiscales.'} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-taxes-rules', ErpTaxesRules);
