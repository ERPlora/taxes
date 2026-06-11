//! Handler WASM (Tier 2) del módulo `taxes` — motor de cálculo fiscal.
//!
//! Cálculo **puro**, sin BD y sin escritura: `calculate_tax` recibe `{payload, context}`,
//! resuelve el tipo impositivo aplicable y devuelve el desglose. No emite operaciones ni
//! eventos (contrato `taxes.calculate`, ver `architecture/modules/taxes.md`).
//!
//! Restricciones del runtime actual (importante):
//! * El host aún NO pre-carga lecturas para el guest: las filas candidatas (tipos y
//!   reglas) se aceptan en `context.reads["taxes.rates.by_country"]` /
//!   `context.reads["taxes.rules.list"]` (punto de inyección futuro del host) con
//!   fallback a `payload.rates` / `payload.rules` (el caller las obtiene hoy vía las
//!   queries públicas del módulo).
//! * El `Output` del contrato host↔guest no tiene canal de resultado: este guest
//!   devuelve además un campo extra `result` (`{ base, tax, total, rate_pct, rate_id,
//!   tax_type }`) que el host actual ignora al deserializar (forward-compatible).
//!
//! Resolución del tipo (precedencia, `WASM-TODO.md`):
//! reglas (`taxes_rule`, prioridad asc, primera cuyo `conditions` matchee) →
//! país+región+categoría → sin región (región vacía)+categoría → región sin categoría →
//! sin región ni categoría (prefiere `default`/`standard`). Solo tipos activos y vigentes
//! (`applies_from`/`applies_until` vs. fecha del host). Sin match → error `no_rate`, o
//! 0% si `payload.allow_missing_rate` es verdadero.

use erplora_guest_sdk::{Event, Operation};
use serde::Serialize;
use serde_json::{json, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

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

/// Redondeo HALF_UP (mitad lejos de cero) a 2 decimales, con epsilon para
/// compensar la representación binaria (paridad SQLite↔Postgres, `WASM-TODO.md`).
fn round2_half_up(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    sign * ((x.abs() * 100.0) + 0.5 + 1e-9).floor() / 100.0
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

/// Filas candidatas: array bajo `context.reads[<query>]` (inyección futura del host)
/// con fallback a `payload[<key>]` (el caller las pasa hoy).
fn candidate_rows<'a>(payload: &'a Value, context: &'a Value, query: &str, key: &str) -> Vec<&'a Value> {
    let from_reads = context
        .get("reads")
        .and_then(|r| r.get(query).or_else(|| r.get(key)))
        .and_then(|v| v.as_array());
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

// ── Lógica pura ──────────────────────────────────────────────────────────────

/// `{payload, context}` → desglose `{ base, tax, total, rate_pct, rate_id, tax_type }`.
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

    let rates = candidate_rows(&payload, &context, "taxes.rates.by_country", "rates");
    let rules = candidate_rows(&payload, &context, "taxes.rules.list", "rules");

    let resolved = resolve_rate(&rates, &rules, &payload, &date);

    let (rate_pct, rate_id, rate_code, tax_type, source) = match resolved {
        Some((rate, source)) => (
            as_f64(rate.get("rate_pct").unwrap_or(&Value::Null), 0.0),
            json!(field(rate, "id")),
            json!(field(rate, "code")),
            json!(field(rate, "tax_type")),
            source,
        ),
        None => {
            if payload.get("allow_missing_rate").map(as_bool).unwrap_or(false) {
                (0.0, Value::Null, Value::Null, Value::Null, "fallback_zero")
            } else {
                return Err("no_rate: ningún tipo impositivo aplicable".to_string());
            }
        }
    };

    let (base, tax, total) = if tax_included {
        // Desglosar la base imponible del importe bruto.
        let total = round2_half_up(amount);
        let base = round2_half_up(amount / (1.0 + rate_pct / 100.0));
        (base, round2_half_up(total - base), total)
    } else {
        let base = round2_half_up(amount);
        let tax = round2_half_up(base * (rate_pct / 100.0));
        (base, tax, round2_half_up(base + tax))
    };

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
        }),
    })
}
