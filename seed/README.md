# Seed canónico del módulo `taxes` (ADR-0085)

`install.postgres.sql` — **DML idempotente por hub** que el **instalador del runtime** aplica
automáticamente **tras las migraciones** (campo `seed` del `module.json`), con
`:hub_id`/`:now`/`:current_user_id` inyectados. Garantiza que **todo hub nuevo** tenga:

- las **categorías canónicas** (`is_system=1`): `restaurant.food/drink/alcohol/delivery`,
  `service.generic`, `product.generic`, `service.health`, `service.education`,
  `product.reduced`, `product.super_reduced`;
- los **alias de fábrica** (`source='shipped'`): `food`/`pizza`/`meal`→`restaurant.food`, etc.;
- la **baseline IVA de España COMPLETA** (taxes#7): general **21**, reducido **10**,
  superreducido **4** y reglas **exentas** con su calificación (`exempt` + causa `E1`,
  ADR-0185). Ya no hace falta el seed suplementario del hub (`es_iva.sql`, hub#107) para tener
  una base fiscal útil: comparte **las mismas claves naturales e ids**, así que ambos componen
  sin duplicar.

Idempotente por la clave natural (`WHERE NOT EXISTS` sobre `(hub_id, key)` / `(hub_id, alias)` /
`(hub_id, country, category, parent NULL, region NULL)`): se re-ejecuta en cada install/rehydrate
sin duplicar y **sin pisar filas existentes** (una edición manual del hub sobrevive — contrato
del que depende el backfill de taxes#18). IVA de otros países = seed por país de ADR-0072.

**Test**: `seed/install.postgres.test.sh` — contra un Postgres real en Docker
(`erplora-test-pg-5433` por defecto; BD scratch que se borra al final). Verifica la baseline
21/10/4/exentas, el contrato de ids y la idempotencia sin clobber.
