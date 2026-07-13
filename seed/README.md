# Seed canónico del módulo `taxes` (ADR-0085)

`install.sqlite.sql` / `install.postgres.sql` — **DML idempotente por hub** que el **instalador
del runtime** aplica automáticamente **tras las migraciones** (campo `seed` del `module.json`),
con `:hub_id`/`:now`/`:current_user_id` inyectados. Garantiza que **todo hub nuevo** tenga:

- las **6 categorías canónicas** (`is_system=1`): `restaurant.food/drink/alcohol/delivery`,
  `service.generic`, `product.generic`;
- los **alias de fábrica** (`source='shipped'`): `food`/`pizza`/`meal`→`restaurant.food`, etc.;
- las **reglas IVA de España** (fase 1, ADR-0072): general 21, reducido 10.

Idempotente por la clave natural (`WHERE NOT EXISTS` sobre `(hub_id, key)` / `(hub_id, alias)` /
`(hub_id, country, category, parent NULL, region NULL)`): se re-ejecuta en cada install/rehydrate
sin duplicar. **IVA por país más allá de ES** = columna humano (añadir reglas de otro país aquí o
vía el seed por país de ADR-0072).
