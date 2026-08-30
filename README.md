# Módulo `taxes` — categorías fiscales, reglas por jurisdicción y motor de cálculo

Capa fiscal transversal del Hub (ADR-0085). Tres cosas: las **categorías canónicas**
(`tax_category_key`, la entidad enlazable), las **reglas** que ponen el % por país+región+categoría
con su **calificación fiscal** (ADR-0186), y el **motor** que resuelve y calcula al vender. El resto
de módulos delega aquí el «cuánto y por qué» en vez de duplicar la lógica de IVA.

> **Module id:** `taxes`. **Depende de:** nada. **Es dependencia de** `inventory`, `services` y
> `sales` (instalar cualquiera lo auto-instala; tier free, sin implicación de billing).
> Módulo híbrido: SQL + handler WASM (`calculate_tax`, `bulk_create_rules`).

## Documentación de usuario — [`docs/`](docs/)

Viaja **dentro** del módulo y se versiona con él: el asistente del hub (ADR-0282) la indexa por
versión instalada y cita la de TU versión, no la de la última publicada. En inglés (idioma fuente).

| Fichero | Para qué |
| ------- | -------- |
| [`docs/overview.md`](docs/overview.md) | Qué hace y qué NO hace; qué siembra el install (6 categorías, 14 alias, IVA ES) |
| [`docs/screens.md`](docs/screens.md) | Categories / Tax Rules / Aliases: crear categoría, regla, componente multi-impuesto y alias |
| [`docs/concepts.md`](docs/concepts.md) | Categoría vs regla, raíz vs componente, calificación fiscal, `igic`/`ipsi` son FAMILIA, snapshot inmutable, bruto→base por diferencia |
| [`docs/limits.md`](docs/limits.md) | `no_rate` no es 0 %, caps, permisos por acción y diagnóstico de «no encuentra la regla» |

## Qué expone hoy

| Tipo | Nombre | Permiso |
| ---- | ------ | ------- |
| query | `taxes.categories.list` / `.get` | `taxes.view_tax` |
| query | `taxes.rules.list` / `.by_country` / `.status` | `taxes.view_tax` |
| query | `taxes.aliases.list` / `.resolve` | `taxes.view_tax` |
| command | `taxes.categories.create` | `taxes.manage_tax` |
| command | `taxes.rules.create` / `.bulk_create` (WASM) / `.deactivate` | `taxes.manage_tax` |
| command | `taxes.aliases.create` | `taxes.manage_tax` |
| command | `taxes.calculate` (WASM, cálculo puro) | `taxes.calculate_tax` |
| emite | `taxes.category.created` / `.rule.created` / `.rule.deactivated` / `.alias.created` | — |
| escucha | — | — |

Navegación: `erp-taxes-categories`, `erp-taxes-rules`, `erp-taxes-aliases`. Sin bloque `settings`
(la identidad fiscal del hub vive en `hub_settings`, ADR-0061).

> 🧩 **ADR-0223:** la resolución de la regla (`resolve_root`, componentes, calificación) vive UNA vez
> en `erplora_guest_sdk::tax`, no en este módulo. Si diverge, se cobra una cosa y se declara otra.

## Layout

```text
module.json                   # manifest (contrato técnico)
migrations/postgres/          # esquema §2.5 (hub_id + soft-delete + auditoría)
seed/install.postgres.sql     # DML idempotente: categorías canónicas + alias + IVA ES
queries/*.sql                 # lecturas declarativas (:hub_id inyectado)
commands/*.sql                # escrituras declarativas (las `_` son intenciones del WASM)
schemas/*.json                # JSON Schemas de input (draft 2020-12)
handler/                      # WASM Tier 2 → dist/handler.wasm
ui/                           # Web Components (Lit/Ionic/OutfitKit)
docs/                         # documentación de usuario + corpus del asistente
```

## Estado y trabajo abierto

El estado vive en las **Issues de este repo**, no aquí.

Doc de arquitectura: `architecture/modules/taxes.md` (cargarlo antes de tocar el módulo).
