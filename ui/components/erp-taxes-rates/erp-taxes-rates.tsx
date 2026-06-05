import { Component, State, h } from '@stencil/core';
// Importa el DataTable compartido (Stencil) para que se auto-registre y esbuild
// lo empaquete dentro del bundle del módulo. El shell provee los `ion-*`.
import '../../../../_shared/ui/components/data-table/data-table';
import type { DataTableColumn } from '../../../../_shared/ui/components/data-table/data-table';

// Web Component del módulo `taxes` (Stencil). Mini-app: lista de tipos fiscales
// (rates) por país/categoría + alta rápida. Es la pieza `ui.entry` que el shell
// carga en runtime (modules/taxes/dist/taxes.esm.js).
//
// 90% de la lógica vive en Rust: este componente NO toca la BD; llama al SDK
// (erplora.query/command/on). El listado usa el DataTable compartido + Ionic.

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
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

@Component({
  tag: 'erp-taxes-rates',
  shadow: true,
  styles: `
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select { --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6); border-radius:8px; min-width:8rem; }
    .err { color:#d9480f; font-weight:600; }
  `,
})
export class ErpTaxesRates {
  @State() rates: TaxRate[] = [];
  @State() categories: TaxCategory[] = [];
  @State() loading = true;
  @State() error = '';
  @State() country = '';
  @State() newCode = '';
  @State() newCountry = '';
  @State() newPct = '';
  @State() newCategory = '';
  @State() saving = false;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'country_code', header: 'País' },
    { key: 'code', header: 'Código' },
    { key: 'category_id', header: 'Categoría', format: (r) => this.catName(r.category_id as string) },
    { key: 'tax_type', header: 'Tipo' },
    { key: 'rate_pct', header: '%', align: 'right', format: (r) => Number(r.rate_pct).toFixed(2) },
  ];

  async componentWillLoad() {
    await this.refresh();
    try {
      const off1 = erplora().on('taxes.rate.created', () => this.refresh());
      const off2 = erplora().on('taxes.rate.deactivated', () => this.refresh());
      const off3 = erplora().on('taxes.category.created', () => this.refresh());
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
    this.unsub?.();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const [rates, cats] = await Promise.all([
        erplora().query<TaxRate[]>('taxes.rates.list', { country_code: this.country, category_id: '' }),
        erplora().query<TaxCategory[]>('taxes.categories.list'),
      ]);
      this.rates = rates ?? [];
      this.categories = cats ?? [];
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Error cargando tipos fiscales';
    } finally {
      this.loading = false;
    }
  }

  private async createRate(ev: Event) {
    ev.preventDefault();
    if (!this.newCode.trim() || !this.newCountry.trim() || !this.newCategory) return;
    this.saving = true;
    this.error = '';
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
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'No se pudo crear el tipo';
    } finally {
      this.saving = false;
    }
  }

  private catName(id: string): string {
    return this.categories.find((c) => c.id === id)?.code ?? '—';
  }

  render() {
    return (
      <div>
        <header>
          <h2>Tipos fiscales</h2>
        </header>

        <form class="form" onSubmit={(e) => this.createRate(e)}>
          <ion-input
            placeholder="Código (standard)"
            value={this.newCode}
            onIonInput={(e: any) => (this.newCode = e.target.value)}
          />
          <ion-input
            placeholder="País (ES)"
            value={this.newCountry}
            onIonInput={(e: any) => (this.newCountry = e.target.value)}
          />
          <ion-input
            type="number"
            step="0.0001"
            placeholder="% tipo"
            value={this.newPct}
            onIonInput={(e: any) => (this.newPct = e.target.value)}
          />
          <ion-select
            placeholder="Categoría…"
            value={this.newCategory}
            onIonChange={(e: any) => (this.newCategory = e.target.value)}
          >
            {this.categories.map((c) => (
              <ion-select-option value={c.id} key={c.id}>
                {c.code}
              </ion-select-option>
            ))}
          </ion-select>
          <ion-button
            type="submit"
            size="small"
            disabled={this.saving || !this.newCode || !this.newCountry || !this.newCategory}
          >
            {this.saving ? 'Guardando…' : 'Añadir'}
          </ion-button>
        </form>

        {this.error && <p class="err">{this.error}</p>}

        <data-table
          columns={this.columns}
          rows={this.rates as unknown as Record<string, unknown>[]}
          searchKeys={['country_code', 'code']}
          searchPlaceholder="Buscar país o código…"
          emptyMessage={this.loading ? 'Cargando…' : 'Sin tipos fiscales.'}
        />
      </div>
    );
  }
}
