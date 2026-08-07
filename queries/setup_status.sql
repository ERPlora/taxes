-- Configuration state of the module (setup-status, ADR-0063 extended by hub#369/ADR-0222).
-- Runtime injects :hub_id and :now. ALWAYS one row: `configured_when` reads the first row, and
-- "no row" means "not configured" forever, so an aggregate with no GROUP BY is the shape.
--
-- Configured ⇔ `matching_rules` > 0, i.e. at least one tax rule the engine could actually
-- resolve TODAY for THIS hub. Rows existing is not the same as rows applying: taxes#7 seeds the
-- Spanish VAT baseline and taxes#18 backfills it into hubs that already had the module, so
-- "there are rows in taxes_rule" is true even on a hub that cannot price a single sale. Each
-- condition below is the difference between the two:
--   · country must MATCH the hub's — a French hub carrying only the ES baseline resolves nothing
--     and the caller falls back to a guessed rate, which is then declared to the tax agency;
--   · ROOT rules only (`parent_id IS NULL`) — a component (equivalence surcharge) never resolves
--     on its own: the engine picks a root and then expands its components;
--   · currently VALID — a rate whose `valid_to` has passed prices nothing today;
--   · active and not deleted — a deactivated rule does not apply to new operations.
-- Deliberately NOT filtered by `operation_class` or `tax_type`: a physiotherapist selling only
-- VAT-exempt treatments (0 %, cause E1 — ADR-0185) is correctly configured, and a Canary hub
-- charges IGIC. Either filter would invent a "you are missing your taxes" that is not true.
--
-- The hub's fiscal country lives in the CORE (`hub_settings.country_code`, ADR-0085), not in
-- this module, and the runtime binds no `:country_code`, so it is read here. `hub_settings` only
-- gets a row once somebody SAVES settings; until then the runtime resolves the country from its
-- own default (`settings::country_code_of`). A hub that has not stated a country therefore
-- cannot be told a rule "does not match" — every active root rule counts, because a false
-- "you are missing X" sends the user to fix something that is already fine
-- (`architecture/hub/setup-status.md` §5.3). Defaulting to a country here instead would plant
-- 'ES' inside a module that is meant to be international.
--
-- Dates are TEXT ISO-8601 compared lexicographically (ADR-0007), against the DATE part of :now
-- so that a rule expiring today is still valid today — same reading as the engine's
-- `is_valid_on`. An empty string is what the UI writes for a blank date field
-- (commands/rule_create.sql binds it raw) and it means "no limit", not "expired in year zero".
WITH hub_country AS (
    SELECT UPPER(TRIM(s.value)) AS code
    FROM hub_settings s
    WHERE s.hub_id = :hub_id
      AND s.key = 'country_code'
      AND TRIM(s.value) <> ''
)
SELECT
    COALESCE((SELECT code FROM hub_country), '') AS country_code,
    COUNT(r.id)                                  AS matching_rules
FROM taxes_rule r
WHERE r.hub_id = :hub_id
  AND r.is_deleted = 0
  AND r.is_active = 1
  AND r.parent_id IS NULL
  AND (r.valid_from IS NULL OR r.valid_from = '' OR r.valid_from <= substr(CAST(:now AS TEXT), 1, 10))
  AND (r.valid_to   IS NULL OR r.valid_to   = '' OR r.valid_to   >= substr(CAST(:now AS TEXT), 1, 10))
  AND (
        NOT EXISTS (SELECT 1 FROM hub_country)
        OR UPPER(TRIM(r.country_code)) = (SELECT code FROM hub_country)
      )
