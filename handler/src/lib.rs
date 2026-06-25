//! Handler WASM (Tier 2) del módulo `taxes` — motor de cálculo fiscal.
//!
//! Cálculo **puro**, sin BD y sin escritura: `calculate_tax` recibe `{payload, context}`,
//! resuelve el tipo impositivo aplicable y devuelve el desglose. No emite operaciones ni
//! eventos (contrato `taxes.calculate`, ver `architecture/modules/taxes.md`).
//!
//! Acceso a datos (ADR-0069 — keystone del impuesto):
//! * El runtime **pre-carga** las lecturas declaradas en `command.reads`
//!   (`["taxes.rates.list", "taxes.rules.list"]`) e inyecta las filas en
//!   `context.reads["taxes.rates.list"]` / `context.reads["taxes.rules.list"]` antes de
//!   invocar al guest. Por compatibilidad se acepta además `taxes.rates.by_country` y un
//!   fallback a `payload.rates` / `payload.rules` (callers sin pre-carga).
//! * El `Output` gana un campo extra **`result`** (`{ base, tax, total, rate_pct, rate_id,
//!   tax_type, components }`) — forward-compatible (`serde(default)` host-side).
//!
//! Multi-impuesto (tipos "grupo", ADR-0069):
//! * Si el tipo resuelto es un **grupo** (`tax_type == "group"`), se **expande** a sus
//!   componentes (filas con `parent_id == id_del_grupo` entre las cargadas) y se calcula una
//!   cuota por componente sobre la misma base; `result.components` lleva el desglose (una
//!   entrada por hijo). Un grupo sin hijos cargados se trata como tipo simple.
//!
//! Resolución del tipo (precedencia, `WASM-TODO.md`):
//! reglas (`taxes_rule`, prioridad asc, primera cuyo `conditions` matchee) →
//! país+región+categoría → sin región (región vacía)+categoría → región sin categoría →
//! sin región ni categoría (prefiere `default`/`standard`). Solo tipos activos y vigentes
//! (`applies_from`/`applies_until` vs. fecha del host). Sin match → error `no_rate`, o
//! 0% si `payload.allow_missing_rate` es verdadero.

use erplora_guest_sdk::{Event, Operation, Output};
use serde::Serialize;
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

/// Tope de tipos creados en una sola llamada a `bulk_create_rates` (ADR-0066). El
/// asistente crea "el IVA de España" (4-5 tipos); 100 cubre cualquier país de sobra.
/// Las líneas que pasen del tope se descartan (el JSON Schema ya valida `maxItems: 100`).
const MAX_BULK_RATES: usize = 100;

/// `Output` del guest con canal extra `result`. El host actual deserializa solo
/// `operations`/`events` (ignora `result`); un host futuro puede leerlo.
#[derive(Debug, Clone, Serialize, Default)]
pub struct CalcOutput {
    pub operations: Vec<Operation>,
    pub events: Vec<Event>,
    pub result: Value,
}

// ── Export WASM ──────────────────────────────────────────────────────────────

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn calculate_tax(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<CalcOutput>> {
    match calculate_tax_pure(input.into_inner().into_value()) {
        Ok(out) => Ok(Json(out)),
        Err(e) => Err(Error::msg(e).into()),
    }
}

// ── Helpers (mismo estilo que sales-handler / kitchen-handler) ───────────────

fn as_f64(v: &Value, d: f64) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(d),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(d),
        _ => d,
    }
}

fn as_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn as_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => matches!(s.as_str(), "1" | "true" | "True" | "yes"),
        _ => false,
    }
}

fn field(v: &Value, k: &str) -> String {
    as_str(v.get(k).unwrap_or(&Value::Null))
}

/// Redondeo HALF_UP (mitad lejos de cero) a **céntimos enteros** (ADR-0007: el dinero
/// viaja en céntimos; el `amount` de entrada y `base`/`tax`/`total` de salida están en
/// céntimos). Epsilon para compensar la representación binaria (paridad SQLite↔Postgres).
fn round2_half_up(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    sign * (x.abs() + 0.5 + 1e-9).floor()
}

// ── Resolución del tipo ──────────────────────────────────────────────────────

/// ¿Está la fila vigente en `date` (YYYY-MM-DD)? Fechas ISO comparan como string.
fn is_valid_on(rate: &Value, date: &str) -> bool {
    if date.is_empty() {
        return true;
    }
    let from = field(rate, "applies_from");
    let until = field(rate, "applies_until");
    (from.is_empty() || from.as_str() <= date) && (until.is_empty() || until.as_str() >= date)
}

/// ¿Está activa la fila? Si la columna no viene (query ya filtra), se asume activa.
fn is_active(row: &Value) -> bool {
    match row.get("is_active") {
        None | Some(Value::Null) => true,
        Some(v) => as_bool(v),
    }
}

/// ¿La fila de tipo matchea la categoría pedida? Acepta id o code.
fn category_matches(rate: &Value, cat: &str) -> bool {
    !cat.is_empty() && (field(rate, "category_id") == cat || field(rate, "category_code") == cat)
}

/// ¿La fila de tipo pertenece al país pedido? Si la fila no trae `country_code`
/// (p. ej. viene de `taxes.rates.by_country`, ya filtrada), se asume que sí.
fn country_matches(rate: &Value, cc: &str) -> bool {
    let rcc = field(rate, "country_code");
    rcc.is_empty() || cc.is_empty() || rcc.eq_ignore_ascii_case(cc)
}

/// Filas candidatas: array bajo `context.reads[<query>]` (lo pre-carga el runtime, ADR-0069)
/// con fallback a `payload[<key>]` (el caller las pasa cuando no hay pre-carga). Acepta
/// **varios** nombres de query alternativos (p. ej. el keystone pre-carga `taxes.rates.list`
/// sin params; un caller antiguo pasaba `taxes.rates.by_country`): se toma el primero que
/// exista en `context.reads`, y por último `context.reads[key]` y `payload[key]`.
fn candidate_rows<'a>(payload: &'a Value, context: &'a Value, queries: &[&str], key: &str) -> Vec<&'a Value> {
    let reads = context.get("reads");
    let from_reads = reads.and_then(|r| {
        queries
            .iter()
            .find_map(|q| r.get(*q))
            .or_else(|| r.get(key))
            .and_then(|v| v.as_array())
    });
    let rows = from_reads.or_else(|| payload.get(key).and_then(|v| v.as_array()));
    rows.map(|a| a.iter().collect()).unwrap_or_default()
}

/// ¿Matchean todas las `conditions` de la regla contra el payload? `conditions`
/// puede venir como objeto o como JSON serializado (así se persiste en BD).
fn rule_conditions_match(rule: &Value, payload: &Value) -> bool {
    let raw = rule.get("conditions").cloned().unwrap_or(Value::Null);
    let conds = match raw {
        Value::Object(m) => Value::Object(m),
        Value::String(s) => serde_json::from_str::<Value>(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    };
    let Some(map) = conds.as_object() else {
        return false; // sin condiciones interpretables → la regla no aplica
    };
    if map.is_empty() {
        return false; // regla vacía: nunca gana sola (evita overrides accidentales)
    }
    map.iter().all(|(k, expected)| {
        let actual = payload.get(k).cloned().unwrap_or(Value::Null);
        as_str(expected).eq_ignore_ascii_case(&as_str(&actual))
    })
}

/// Orden determinista dentro de un nivel de precedencia: `default`/`standard`
/// primero, después por `code` ascendente.
fn pick_best<'a>(mut rows: Vec<&'a Value>) -> Option<&'a Value> {
    rows.sort_by_key(|r| {
        let code = field(r, "code").to_lowercase();
        let pref = if code == "default" || code == "standard" { 0 } else { 1 };
        (pref, code)
    });
    rows.first().copied()
}

/// Resuelve el tipo aplicable. Devuelve `(fila, origen)`.
fn resolve_rate<'a>(
    rates: &[&'a Value],
    rules: &[&'a Value],
    payload: &Value,
    date: &str,
) -> Option<(&'a Value, &'static str)> {
    let cc = field(payload, "country_code");
    let rc = field(payload, "region_code");
    let cat = {
        let c = field(payload, "category_id");
        if c.is_empty() { field(payload, "category_code") } else { c }
    };

    // Candidatos elegibles: activos, vigentes y del país pedido.
    let eligible: Vec<&Value> = rates
        .iter()
        .copied()
        .filter(|r| is_active(r) && is_valid_on(r, date) && country_matches(r, &cc))
        .collect();

    // 0) Tipo explícito (ADR-0069, keystone): el caller (sales/POS) manda el `tax_rate_id` que
    //    el producto tiene asociado — que puede ser un GRUPO. Si está presente y resuelve a un
    //    tipo cargado, activo y vigente, gana sobre todo lo demás (el servidor solo resuelve su
    //    rate_pct/componentes; el cliente no falsea el %). Acepta `tax_rate_id` o `rate_id`.
    let explicit = {
        let id = field(payload, "tax_rate_id");
        if id.is_empty() { field(payload, "rate_id") } else { id }
    };
    if !explicit.is_empty() {
        if let Some(rate) = rates
            .iter()
            .copied()
            .find(|r| field(r, "id") == explicit && is_active(r) && is_valid_on(r, date))
        {
            return Some((rate, "explicit"));
        }
    }

    // 1) Reglas declarativas (prioridad asc, menor gana): primera regla activa cuyas
    //    condiciones matcheen y cuyo tax_rate_id resuelva a un tipo elegible.
    let mut sorted_rules: Vec<&Value> = rules.iter().copied().filter(|r| is_active(r)).collect();
    sorted_rules.sort_by_key(|r| r.get("priority").map(|p| as_f64(p, 100.0) as i64).unwrap_or(100));
    for rule in sorted_rules {
        if !rule_conditions_match(rule, payload) {
            continue;
        }
        let target = field(rule, "tax_rate_id");
        if let Some(rate) = rates
            .iter()
            .copied()
            .find(|r| field(r, "id") == target && is_active(r) && is_valid_on(r, date))
        {
            return Some((rate, "rule"));
        }
    }

    // 2) país + región + categoría
    if !rc.is_empty() && !cat.is_empty() {
        if let Some(r) = pick_best(
            eligible
                .iter()
                .copied()
                .filter(|r| field(r, "region_code").eq_ignore_ascii_case(&rc) && category_matches(r, &cat))
                .collect(),
        ) {
            return Some((r, "rate"));
        }
    }
    // 3) sin región (región vacía) + categoría
    if !cat.is_empty() {
        if let Some(r) = pick_best(
            eligible
                .iter()
                .copied()
                .filter(|r| field(r, "region_code").is_empty() && category_matches(r, &cat))
                .collect(),
        ) {
            return Some((r, "rate"));
        }
    }
    // 4) región sin categoría
    if !rc.is_empty() {
        if let Some(r) = pick_best(
            eligible
                .iter()
                .copied()
                .filter(|r| field(r, "region_code").eq_ignore_ascii_case(&rc))
                .collect(),
        ) {
            return Some((r, "fallback"));
        }
    }
    // 5) fallback país: región vacía, prefiere `default`/`standard`
    pick_best(
        eligible
            .iter()
            .copied()
            .filter(|r| field(r, "region_code").is_empty())
            .collect(),
    )
    .or_else(|| pick_best(eligible))
    .map(|r| (r, "fallback"))
}

// ── Tipos "grupo" (multi-impuesto, ADR-0069) ─────────────────────────────────

/// Un componente a aplicar: un hijo de un grupo, o el propio tipo simple.
struct Component {
    rate_pct: f64,
    rate_id: Value,
    rate_code: Value,
    name: Value,
    tax_type: Value,
}

/// Convierte una fila `taxes_rate` en un `Component`.
fn component_from_rate(rate: &Value) -> Component {
    Component {
        rate_pct: as_f64(rate.get("rate_pct").unwrap_or(&Value::Null), 0.0),
        rate_id: json!(field(rate, "id")),
        rate_code: json!(field(rate, "code")),
        name: json!(field(rate, "name")),
        tax_type: json!(field(rate, "tax_type")),
    }
}

/// Expande el tipo resuelto a sus componentes (ADR-0069):
/// * tipo "grupo" (`tax_type == "group"`) → los hijos (`parent_id == grupo.id`) activos y
///   vigentes en `date`, entre las filas cargadas, ordenados de forma determinista
///   (`default`/`standard` primero, luego por `code`). Si no hay hijos cargados, degrada al
///   propio grupo como tipo simple (su `rate_pct`).
/// * tipo simple → un único componente con su propio `rate_pct`.
fn group_components<'a>(rate: &'a Value, rates: &[&'a Value], date: &str) -> Vec<Component> {
    if field(rate, "tax_type").eq_ignore_ascii_case("group") {
        let gid = field(rate, "id");
        let children = pick_ordered(
            rates
                .iter()
                .copied()
                .filter(|r| !field(r, "id").is_empty() && field(r, "parent_id") == gid && is_active(r) && is_valid_on(r, date))
                .collect(),
        );
        if !children.is_empty() {
            return children.iter().map(|r| component_from_rate(r)).collect();
        }
        // Grupo sin hijos cargados: se trata como tipo simple con su propio rate_pct.
    }
    vec![component_from_rate(rate)]
}

/// Orden determinista de un conjunto de filas (mismo criterio que `pick_best`, pero devuelve
/// todas): `default`/`standard` primero, luego por `code` ascendente.
fn pick_ordered<'a>(mut rows: Vec<&'a Value>) -> Vec<&'a Value> {
    rows.sort_by_key(|r| {
        let code = field(r, "code").to_lowercase();
        let pref = if code == "default" || code == "standard" { 0 } else { 1 };
        (pref, code)
    });
    rows
}

// ── Lógica pura ──────────────────────────────────────────────────────────────

/// `{payload, context}` → desglose `{ base, tax, total, rate_pct, rate_id, tax_type, components }`.
pub fn calculate_tax_pure(input: Value) -> Result<CalcOutput, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let context = input.get("context").cloned().unwrap_or(Value::Null);

    let amount = match payload.get("amount") {
        Some(v) if !v.is_null() => as_f64(v, f64::NAN),
        _ => f64::NAN,
    };
    if !amount.is_finite() {
        return Err("payload.amount requerido (número)".to_string());
    }
    let tax_included = payload.get("tax_included").map(as_bool).unwrap_or(false);

    // Fecha de vigencia: payload.date (override) o la fecha del host (context.now).
    let date = {
        let d = field(&payload, "date");
        if d.is_empty() {
            field(&context, "now").chars().take(10).collect::<String>()
        } else {
            d.chars().take(10).collect::<String>()
        }
    };

    // El keystone (ADR-0069) pre-carga `taxes.rates.list`/`taxes.rules.list` en context.reads;
    // se acepta también `taxes.rates.by_country` por compatibilidad con callers antiguos.
    let rates = candidate_rows(&payload, &context, &["taxes.rates.list", "taxes.rates.by_country"], "rates");
    let rules = candidate_rows(&payload, &context, &["taxes.rules.list"], "rules");

    let resolved = resolve_rate(&rates, &rules, &payload, &date);

    let (rate_id, rate_code, tax_type, source) = match &resolved {
        Some((rate, source)) => (
            json!(field(rate, "id")),
            json!(field(rate, "code")),
            json!(field(rate, "tax_type")),
            *source,
        ),
        None => {
            if !payload.get("allow_missing_rate").map(as_bool).unwrap_or(false) {
                return Err("no_rate: ningún tipo impositivo aplicable".to_string());
            }
            (Value::Null, Value::Null, Value::Null, "fallback_zero")
        }
    };

    // Componentes a aplicar (ADR-0069): un tipo "grupo" (tax_type == "group") se EXPANDE a sus
    // hijos (filas con parent_id == id_del_grupo, activas y vigentes en `date`, entre las filas
    // cargadas); cada hijo aporta su rate_pct. Un tipo simple aporta un único componente con su
    // propio rate_pct. Un grupo sin hijos cargados se trata como tipo simple con su rate_pct.
    let components: Vec<Component> = match &resolved {
        Some((rate, _)) => group_components(rate, &rates, &date),
        None => vec![],
    };
    // Tasa combinada: suma de las tasas de los componentes (un solo componente para tipo simple,
    // 0 si no hay tipo). Se usa para desglosar la base del bruto cuando tax_included.
    let combined_pct: f64 = components.iter().map(|c| c.rate_pct).sum();

    // Base imponible (común a todos los componentes). Si el importe es bruto (tax_included), se
    // desglosa con la tasa combinada; si es neto, la base es el propio importe.
    let base = if tax_included {
        round2_half_up(amount / (1.0 + combined_pct / 100.0))
    } else {
        round2_half_up(amount)
    };

    // Cuota por componente sobre la misma base (HALF_UP por componente, paridad con cómo el POS
    // desglosa multi-impuesto); la cuota total es la suma de las cuotas redondeadas.
    let breakdown: Vec<Value> = components
        .iter()
        .map(|c| {
            let comp_tax = round2_half_up(base * (c.rate_pct / 100.0));
            json!({
                "base": base,
                "tax": comp_tax,
                "rate_pct": c.rate_pct,
                "rate_id": c.rate_id,
                "rate_code": c.rate_code,
                "name": c.name,
                "tax_type": c.tax_type,
            })
        })
        .collect();
    let tax: f64 = breakdown.iter().map(|c| as_f64(&c["tax"], 0.0)).sum();
    let total = round2_half_up(base + tax);
    // `rate_pct` de cabecera = tasa combinada (suma de los componentes).
    let rate_pct = combined_pct;

    Ok(CalcOutput {
        operations: vec![], // cálculo puro: sin escritura
        events: vec![],     // sin emit (contrato taxes.calculate)
        result: json!({
            "base": base,
            "tax": tax,
            "total": total,
            "rate_pct": rate_pct,
            "rate_id": rate_id,
            "rate_code": rate_code,
            "tax_type": tax_type,
            "tax_included": tax_included,
            "source": source,
            // Desglose por componente: para un tipo "grupo" lleva una entrada por hijo; para un
            // tipo simple, una sola entrada (== los totales de cabecera). El caller (sales) lo
            // congela en la línea.
            "components": breakdown,
        }),
    })
}

// ── Alta batch de tipos (ADR-0066) ───────────────────────────────────────────
//
// `bulk_create_rates` crea N tipos (`taxes_rate`) en una sola llamada — la usa el
// asistente ("créame el IVA de España 2026") y el import CSV de productos. Mismo patrón
// que `inventory.products.bulk_create`: el guest valida cada línea SIN abortar el lote
// (recolecta errores parciales y salta la línea inválida), toma los ids de
// `context.new_ids` y devuelve N intenciones `taxes._insert_rate` (command privado del
// MISMO módulo). El host inyecta `:hub_id`/`:current_user_id`/`:now` al ejecutar cada
// intención (no los pasa el guest). Emite un `taxes.rate.created` por cada tipo creado
// (los `events` del Output → un INSERT de outbox cada uno, ver `persist_handler_output`).

/// `payload.rates[i]` → params de `taxes._insert_rate`. Devuelve `Ok(params)` con el `id`
/// ya asignado (de `new_ids`), o `Err(motivo)` si la línea es inválida (no aborta el lote).
fn rate_op_params(item: &Value, id: Value) -> Result<Map<String, Value>, String> {
    let code = as_str(item.get("code").unwrap_or(&Value::Null));
    if code.trim().is_empty() {
        return Err("falta `code`".to_string());
    }
    let country = as_str(item.get("country_code").unwrap_or(&Value::Null));
    if country.trim().len() != 2 {
        return Err("`country_code` debe ser un código ISO de 2 letras".to_string());
    }
    // `rate_pct` es obligatorio (número ≥ 0). Sin valor numérico → línea inválida.
    let rate_pct = match item.get("rate_pct") {
        Some(v) if !v.is_null() => as_f64(v, f64::NAN),
        _ => f64::NAN,
    };
    if !rate_pct.is_finite() || rate_pct < 0.0 {
        return Err("`rate_pct` requerido (número ≥ 0)".to_string());
    }

    let tax_type = {
        let t = as_str(item.get("tax_type").unwrap_or(&Value::Null));
        if t.is_empty() { "vat".to_string() } else { t }
    };

    let mut p = Map::new();
    p.insert("id".into(), id); // de context.new_ids (el host es la autoridad de ids)
    p.insert("code".into(), json!(code.trim()));
    p.insert("name".into(), json!(as_str(item.get("name").unwrap_or(&Value::Null))));
    // category_id es OPCIONAL (ADR-0066): ausente o null → el host bindea NULL.
    p.insert("category_id".into(), opt_field(item, "category_id"));
    p.insert("country_code".into(), json!(country.trim().to_uppercase()));
    p.insert("region_code".into(), json!(as_str(item.get("region_code").unwrap_or(&Value::Null))));
    p.insert("rate_pct".into(), json!(rate_pct));
    p.insert("tax_type".into(), json!(tax_type));
    // Vigencia opcional: ausente o null → NULL (histórico abierto).
    p.insert("applies_from".into(), opt_field(item, "applies_from"));
    p.insert("applies_until".into(), opt_field(item, "applies_until"));
    Ok(p)
}

/// Campo opcional de string: ausente o null → `Value::Null` (el host lo bindea como SQL
/// NULL, tipado por contexto — paridad SQLite/Postgres).
fn opt_field(item: &Value, key: &str) -> Value {
    match item.get(key) {
        Some(Value::Null) | None => Value::Null,
        Some(v) => Value::String(as_str(v)),
    }
}

/// `{payload:{rates:[...]}, context:{new_ids:[...]}}` → intenciones `taxes._insert_rate` +
/// un evento `taxes.rate.created` por tipo creado. Errores parciales se devuelven en el
/// evento `taxes.rates.bulk_create.report` (no abortan el lote).
pub fn bulk_create_rates_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let new_ids: Vec<Value> = input
        .get("context")
        .and_then(|c| c.get("new_ids"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let empty: Vec<Value> = Vec::new();
    let rates = payload.get("rates").and_then(|v| v.as_array()).unwrap_or(&empty);

    let mut ops: Vec<Operation> = Vec::new();
    let mut events: Vec<Event> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    let mut created = 0usize; // índice de id consumido (solo avanza en líneas válidas)

    for (i, item) in rates.iter().take(MAX_BULK_RATES).enumerate() {
        let id = new_ids.get(created).cloned().unwrap_or(Value::Null);
        if id.is_null() {
            // Sin id disponible (lote mayor que new_ids): se reporta y se detiene el alta.
            errors.push(json!({ "index": i, "error": "sin id disponible (lote demasiado grande)" }));
            continue;
        }
        match rate_op_params(item, id.clone()) {
            Ok(params) => {
                events.push(Event::new(
                    "taxes.rate.created",
                    json!({
                        "id": id,
                        "code": params.get("code").cloned().unwrap_or(Value::Null),
                        "country_code": params.get("country_code").cloned().unwrap_or(Value::Null),
                        "rate_pct": params.get("rate_pct").cloned().unwrap_or(Value::Null),
                    }),
                ));
                ops.push(Operation::sql("taxes._insert_rate", params));
                created += 1;
            }
            Err(reason) => {
                // Línea inválida: se salta sin abortar el lote (error parcial).
                errors.push(json!({ "index": i, "error": reason }));
            }
        }
    }

    // Evento de resumen del lote (siempre): cuántos se crearon y qué líneas fallaron.
    events.push(Event::new(
        "taxes.rates.bulk_create.report",
        json!({ "created": created, "errors": errors }),
    ));

    // `result` vacío: este command escribe (operations/events), no devuelve desglose calculado.
    Output { operations: ops, events, result: Value::Null }
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn bulk_create_rates(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(bulk_create_rates_pure(input.into_inner().into_value())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(n: usize) -> Value {
        let ids: Vec<Value> = (0..n).map(|i| json!(format!("id-{i}"))).collect();
        json!({ "context": { "new_ids": ids } })
    }

    fn with_payload(mut input: Value, payload: Value) -> Value {
        input.as_object_mut().unwrap().insert("payload".into(), payload);
        input
    }

    // ── calculate_tax: tipo simple y tipos "grupo" (ADR-0069) ────────────────

    /// Construye `{payload, context:{reads:{"taxes.rates.list": rates}}}` — simula la
    /// pre-carga del keystone (el runtime inyecta las filas vía `command.reads`).
    fn calc_input(payload: Value, rates: Value) -> Value {
        json!({ "payload": payload, "context": { "reads": { "taxes.rates.list": rates } } })
    }

    #[test]
    fn calculate_simple_rate_one_component() {
        // Un tipo simple (IVA 21%) sobre 100,00 € (10000 céntimos) → cuota 21,00 € (2100).
        let rates = json!([
            { "id": "r-vat21", "code": "IVA21", "name": "IVA General", "country_code": "ES",
              "region_code": "", "rate_pct": 21.0, "tax_type": "vat", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "country_code": "ES" });
        let out = calculate_tax_pure(calc_input(payload, rates)).unwrap();
        let r = &out.result;
        assert_eq!(r["base"], json!(10000.0));
        assert_eq!(r["tax"], json!(2100.0));
        assert_eq!(r["total"], json!(12100.0));
        assert_eq!(r["rate_pct"], json!(21.0));
        assert_eq!(r["rate_id"], json!("r-vat21"));
        assert_eq!(r["tax_type"], json!("vat"));
        // un tipo simple → un único componente == los totales de cabecera
        let comps = r["components"].as_array().unwrap();
        assert_eq!(comps.len(), 1);
        assert_eq!(comps[0]["rate_id"], json!("r-vat21"));
        assert_eq!(comps[0]["tax"], json!(2100.0));
        assert_eq!(comps[0]["rate_pct"], json!(21.0));
    }

    #[test]
    fn calculate_group_expands_to_components() {
        // Grupo "IVA 21 + Recargo de equivalencia 5,2" → dos componentes, cada uno sobre la
        // misma base de 10000 céntimos: IVA 2100 + RE 520 = cuota total 2620.
        let rates = json!([
            { "id": "g-re", "code": "IVA21_RE", "name": "IVA 21 + RE", "country_code": "ES",
              "region_code": "", "rate_pct": 0.0, "tax_type": "group", "is_active": 1 },
            { "id": "c-vat", "code": "IVA21", "name": "IVA General", "country_code": "ES",
              "region_code": "", "rate_pct": 21.0, "tax_type": "vat", "parent_id": "g-re", "is_active": 1 },
            { "id": "c-re", "code": "RE52", "name": "Recargo equivalencia", "country_code": "ES",
              "region_code": "", "rate_pct": 5.2, "tax_type": "surcharge", "parent_id": "g-re", "is_active": 1 }
        ]);
        // El producto guarda el id del GRUPO en tax_rate_id (keystone): el servidor lo resuelve
        // por id (precedencia 0) y lo expande a sus componentes.
        let payload = json!({ "amount": 10000, "country_code": "ES", "tax_rate_id": "g-re" });
        let out = calculate_tax_pure(calc_input(payload, rates)).unwrap();
        let r = &out.result;
        assert_eq!(r["tax_type"], json!("group"));
        assert_eq!(r["rate_id"], json!("g-re"));
        assert_eq!(r["source"], json!("explicit"));
        assert_eq!(r["base"], json!(10000.0));
        // tasa combinada = 21 + 5,2 = 26,2
        assert_eq!(r["rate_pct"], json!(26.2));
        // cuota total = 2100 (IVA) + 520 (RE) = 2620
        assert_eq!(r["tax"], json!(2620.0));
        assert_eq!(r["total"], json!(12620.0));
        // desglose: una entrada por hijo
        let comps = r["components"].as_array().unwrap();
        assert_eq!(comps.len(), 2);
        // orden determinista por code: IVA21 antes que RE52
        assert_eq!(comps[0]["rate_id"], json!("c-vat"));
        assert_eq!(comps[0]["tax"], json!(2100.0));
        assert_eq!(comps[0]["name"], json!("IVA General"));
        assert_eq!(comps[1]["rate_id"], json!("c-re"));
        assert_eq!(comps[1]["tax"], json!(520.0));
        assert_eq!(comps[1]["rate_pct"], json!(5.2));
    }

    #[test]
    fn calculate_group_tax_included_unwinds_combined_rate() {
        // Importe BRUTO 12620 céntimos con grupo 26,2% → base 10000, cuota 2620.
        let rates = json!([
            { "id": "g", "code": "GRP", "name": "Grupo", "country_code": "ES",
              "region_code": "", "rate_pct": 0.0, "tax_type": "group", "is_active": 1 },
            { "id": "c1", "code": "A", "country_code": "ES", "region_code": "",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": "g", "is_active": 1 },
            { "id": "c2", "code": "B", "country_code": "ES", "region_code": "",
              "rate_pct": 5.2, "tax_type": "surcharge", "parent_id": "g", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 12620, "country_code": "ES", "tax_included": true, "tax_rate_id": "g" });
        let out = calculate_tax_pure(calc_input(payload, rates)).unwrap();
        let r = &out.result;
        assert_eq!(r["base"], json!(10000.0));
        assert_eq!(r["tax"], json!(2620.0));
        assert_eq!(r["total"], json!(12620.0));
        assert_eq!(r["components"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn calculate_group_without_children_is_treated_as_simple_rate() {
        // Grupo sin hijos cargados → se trata como tipo simple con su propio rate_pct (10%).
        let rates = json!([
            { "id": "g0", "code": "GRP0", "name": "Grupo vacío", "country_code": "ES",
              "region_code": "", "rate_pct": 10.0, "tax_type": "group", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "country_code": "ES", "tax_rate_id": "g0" });
        let out = calculate_tax_pure(calc_input(payload, rates)).unwrap();
        let r = &out.result;
        assert_eq!(r["rate_pct"], json!(10.0));
        assert_eq!(r["tax"], json!(1000.0));
        let comps = r["components"].as_array().unwrap();
        assert_eq!(comps.len(), 1);
        assert_eq!(comps[0]["rate_id"], json!("g0"));
    }

    #[test]
    fn calculate_reads_rates_list_key_is_accepted() {
        // El keystone pre-carga bajo "taxes.rates.list"; candidate_rows debe leerlo.
        let rates = json!([
            { "id": "r1", "code": "default", "country_code": "ES", "region_code": "",
              "rate_pct": 21.0, "tax_type": "vat", "is_active": 1 }
        ]);
        let input = json!({
            "payload": { "amount": 10000, "country_code": "ES" },
            "context": { "reads": { "taxes.rates.list": rates } }
        });
        let out = calculate_tax_pure(input).unwrap();
        assert_eq!(out.result["rate_id"], json!("r1"));
        assert_eq!(out.result["tax"], json!(2100.0));
    }

    #[test]
    fn bulk_create_rates_builds_one_op_per_valid_rate() {
        let input = with_payload(
            ctx(8),
            json!({ "rates": [
                { "code": "IVA21", "name": "IVA General", "country_code": "ES", "rate_pct": 21 },
                { "code": "IVA10", "country_code": "es", "rate_pct": 10.0 },
            ] }),
        );
        let out = bulk_create_rates_pure(input);
        assert_eq!(out.operations.len(), 2);
        assert_eq!(out.operations[0].command, "taxes._insert_rate");
        assert_eq!(out.operations[0].params["id"], json!("id-0"));
        assert_eq!(out.operations[0].params["country_code"], json!("ES"));
        // país en minúscula se normaliza a mayúscula
        assert_eq!(out.operations[1].params["country_code"], json!("ES"));
        assert_eq!(out.operations[1].params["id"], json!("id-1"));
        // category_id ausente → NULL
        assert_eq!(out.operations[0].params["category_id"], Value::Null);
        // tax_type por defecto vat
        assert_eq!(out.operations[0].params["tax_type"], json!("vat"));
        // un evento created por tipo + 1 de reporte
        assert_eq!(out.events.len(), 3);
        assert_eq!(out.events[2].name, "taxes.rates.bulk_create.report");
    }

    #[test]
    fn bulk_create_rates_skips_invalid_without_aborting() {
        let input = with_payload(
            ctx(8),
            json!({ "rates": [
                { "code": "OK", "country_code": "ES", "rate_pct": 21 },
                { "code": "", "country_code": "ES", "rate_pct": 10 },          // code vacío
                { "code": "BADCC", "country_code": "ESP", "rate_pct": 4 },      // país != 2 letras
                { "code": "NOPCT", "country_code": "ES" },                       // sin rate_pct
                { "code": "OK2", "country_code": "ES", "rate_pct": 0 },          // 0% válido
            ] }),
        );
        let out = bulk_create_rates_pure(input);
        // 2 válidos → 2 ops, ids correlativos sin huecos
        assert_eq!(out.operations.len(), 2);
        assert_eq!(out.operations[0].params["id"], json!("id-0"));
        assert_eq!(out.operations[1].params["id"], json!("id-1"));
        // reporte: created=2, 3 errores
        let report = &out.events.last().unwrap().payload;
        assert_eq!(report["created"], json!(2));
        assert_eq!(report["errors"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn bulk_create_rates_caps_at_max() {
        let many: Vec<Value> = (0..MAX_BULK_RATES + 25)
            .map(|i| json!({ "code": format!("R{i}"), "country_code": "ES", "rate_pct": 1 }))
            .collect();
        let input = with_payload(ctx(MAX_BULK_RATES + 25), json!({ "rates": many }));
        let out = bulk_create_rates_pure(input);
        assert_eq!(out.operations.len(), MAX_BULK_RATES);
    }
}
