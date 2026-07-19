//! Handler WASM (Tier 2) del módulo `taxes` — motor de cálculo fiscal (modelo ADR-0085).
//!
//! Cálculo **puro**, sin BD y sin escritura: `calculate_tax` recibe `{payload, context}`,
//! resuelve la regla de tipo aplicable **por CATEGORÍA FISCAL** y devuelve el desglose +
//! el snapshot inmutable que el caller (sales/invoice) congela en la línea. No emite
//! operaciones ni eventos (contrato `taxes.calculate`, ver `architecture/modules/taxes.md`).
//!
//! Resolución (ADR-0085, supersede el link `tax_rate_id` de ADR-0066):
//! * El producto/servicio (y por tanto la línea) aporta `tax_category_key` (categoría fiscal
//!   abstracta, p. ej. `restaurant.food`). El **país/región** del hub vienen del `context`
//!   (identidad fiscal en `hub_settings`, inyectada por el runtime — keystone ADR-0069);
//!   el `payload` puede sobreescribirlos para cálculos ad-hoc.
//! * El runtime **pre-carga** `command.reads` (`["taxes.rules.list"]`) e inyecta las filas en
//!   `context.reads["taxes.rules.list"]` (todas las reglas del hub, incluidos los componentes).
//!   Fallback a `payload.rules` para callers sin pre-carga.
//! * Se busca la **regla RAÍZ** (`parent_id` vacío) que matchee `país + categoría + vigencia`,
//!   prefiriendo región exacta sobre regla de país (región vacía/NULL). Sin match → error
//!   `no_rate`, o 0% si `payload.allow_missing_rate`.
//!
//! Multi-impuesto (componentes, ADR-0085 — decisión humano 2026-06-27, sin `taxes_rate`):
//! * La regla raíz es el tipo principal (IVA 21). Sus **componentes** (Recargo de equivalencia
//!   5,2) son filas con `parent_id == id_de_la_regla_raíz`. El handler aplica la raíz + sus
//!   componentes sobre la misma base; `result.components` lleva el desglose (una entrada por
//!   componente). Una regla sin componentes → un único componente (la propia raíz).
//!
//! Snapshot inmutable (ADR-0085) que `calculate_tax` devuelve para que sales/invoice lo congelen:
//! `tax_category_key`, `tax_rate_pct` (combinado), `tax_country_code`, `tax_region_code`,
//! `tax_rule_id` (id de la regla raíz, nullable).

use erplora_guest_sdk::money;
use erplora_guest_sdk::{Event, Operation, Output};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

/// Tope de reglas creadas en una sola llamada a `bulk_create_rules`. El asistente crea
/// "el IVA de España" (3-4 reglas); 100 cubre cualquier país de sobra.
const MAX_BULK_RULES: usize = 100;

/// `Output` del guest con canal extra `result` (ADR-0069). El host deserializa solo
/// `operations`/`events` (ignora `result`); un host futuro puede leerlo.
#[derive(Debug, Clone, Serialize, Default)]
pub struct CalcOutput {
    pub operations: Vec<Operation>,
    pub events: Vec<Event>,
    pub result: Value,
}

// ── Exports WASM ─────────────────────────────────────────────────────────────

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn calculate_tax(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<CalcOutput>> {
    match calculate_tax_pure(input.into_inner().into_value()) {
        Ok(out) => Ok(Json(out)),
        Err(e) => Err(Error::msg(e).into()),
    }
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn bulk_create_rules(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    Ok(Json(bulk_create_rules_pure(input.into_inner().into_value())))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/// Primer valor no vacío entre `payload[k]` y `context[k]` (la identidad fiscal —país/región—
/// la inyecta el runtime en el contexto; el payload puede sobreescribirla en cálculos ad-hoc).
fn payload_or_context(payload: &Value, context: &Value, k: &str) -> String {
    let p = field(payload, k);
    if p.is_empty() { field(context, k) } else { p }
}

// El redondeo del dinero es el ÚNICO del hub: `money::round` (HALF_UP sobre Decimal exacto,
// ADR-0123 §4). El `round2_half_up(f64)` con epsilon 1e-9 que vivía aquí era el mayor foco
// de coma flotante calculando IVA de todo el sistema — el patrón Odoo que el ADR prohíbe.

/// La tasa de un componente como Decimal exacto (una tasa NO es dinero, pero el producto
/// base × tasa sí: el intermedio va en Decimal, nunca f64).
fn rate_dec(pct: f64) -> Decimal {
    Decimal::from_f64(pct).unwrap_or(Decimal::ZERO)
}

/// ¿Está la fila vigente en `date` (YYYY-MM-DD)? Fechas ISO comparan como string.
fn is_valid_on(rule: &Value, date: &str) -> bool {
    if date.is_empty() {
        return true;
    }
    let from = field(rule, "valid_from");
    let until = field(rule, "valid_to");
    (from.is_empty() || from.as_str() <= date) && (until.is_empty() || until.as_str() >= date)
}

/// ¿Está activa la fila? Si la columna no viene (query ya filtra), se asume activa.
fn is_active(row: &Value) -> bool {
    match row.get("is_active") {
        None | Some(Value::Null) => true,
        Some(v) => as_bool(v),
    }
}

/// ¿Es una regla RAÍZ (no un componente)? `parent_id` vacío/NULL.
fn is_root(rule: &Value) -> bool {
    field(rule, "parent_id").is_empty()
}

/// Filas candidatas: `context.reads["taxes.rules.list"]` (lo pre-carga el keystone, ADR-0069)
/// con fallback a `payload.rules` (caller sin pre-carga). Se acepta también `taxes.rules.by_country`.
fn candidate_rules<'a>(payload: &'a Value, context: &'a Value) -> Vec<&'a Value> {
    let reads = context.get("reads");
    let from_reads = reads.and_then(|r| {
        r.get("taxes.rules.list")
            .or_else(|| r.get("taxes.rules.by_country"))
            .or_else(|| r.get("rules"))
            .and_then(|v| v.as_array())
    });
    let rows = from_reads.or_else(|| payload.get("rules").and_then(|v| v.as_array()));
    rows.map(|a| a.iter().collect()).unwrap_or_default()
}

// ── Resolución de la regla por categoría (ADR-0085) ──────────────────────────

/// Resuelve la regla RAÍZ aplicable a `(cc, rc, cat, date)`. Precedencia: región exacta →
/// regla de país (región vacía/NULL). Dentro de un nivel, prefiere la `valid_from` más reciente
/// (la regla vigente más nueva gana), luego orden determinista por `id`.
fn resolve_root<'a>(
    rules: &[&'a Value],
    cc: &str,
    rc: &str,
    cat: &str,
    date: &str,
) -> Option<&'a Value> {
    // Candidatas: raíces activas, vigentes, de la categoría y país pedidos.
    let eligible: Vec<&Value> = rules
        .iter()
        .copied()
        .filter(|r| {
            is_root(r)
                && is_active(r)
                && is_valid_on(r, date)
                && field(r, "country_code").eq_ignore_ascii_case(cc)
                && field(r, "tax_category_key") == cat
        })
        .collect();

    // 1) región exacta
    if !rc.is_empty() {
        if let Some(r) = pick_best(
            eligible
                .iter()
                .copied()
                .filter(|r| field(r, "region_code").eq_ignore_ascii_case(rc))
                .collect(),
        ) {
            return Some(r);
        }
    }
    // 2) regla de país (región vacía/NULL)
    pick_best(
        eligible
            .iter()
            .copied()
            .filter(|r| field(r, "region_code").is_empty())
            .collect(),
    )
    .or_else(|| pick_best(eligible))
}

/// Mejor de un conjunto: `valid_from` más reciente primero, luego por `id` ascendente.
fn pick_best<'a>(mut rows: Vec<&'a Value>) -> Option<&'a Value> {
    rows.sort_by(|a, b| {
        let fa = field(a, "valid_from");
        let fb = field(b, "valid_from");
        fb.cmp(&fa).then_with(|| field(a, "id").cmp(&field(b, "id")))
    });
    rows.first().copied()
}

/// Un componente a aplicar: la regla raíz o uno de sus hijos.
struct Component {
    rate_pct: f64,
    rule_id: Value,
    label: Value,
    tax_type: Value,
}

fn component_from_rule(rule: &Value) -> Component {
    // El componente puede traer `component_label`; si no, el nombre por defecto es el tax_type.
    let label = {
        let l = field(rule, "component_label");
        if l.is_empty() { field(rule, "tax_type") } else { l }
    };
    Component {
        rate_pct: as_f64(rule.get("rate_pct").unwrap_or(&Value::Null), 0.0),
        rule_id: json!(field(rule, "id")),
        label: json!(label),
        tax_type: json!(field(rule, "tax_type")),
    }
}

/// Expande la regla raíz a sus componentes (ADR-0085): la propia raíz + sus hijos (filas con
/// `parent_id == raiz.id`, activos y vigentes), ordenados de forma determinista por `id`.
fn rule_components<'a>(root: &'a Value, rules: &[&'a Value], date: &str) -> Vec<Component> {
    let rid = field(root, "id");
    let mut children: Vec<&Value> = rules
        .iter()
        .copied()
        .filter(|r| !field(r, "id").is_empty() && field(r, "parent_id") == rid && is_active(r) && is_valid_on(r, date))
        .collect();
    children.sort_by_key(|r| field(r, "id"));
    let mut comps = vec![component_from_rule(root)];
    comps.extend(children.iter().map(|r| component_from_rule(r)));
    comps
}

// ── Lógica pura: calculate_tax ───────────────────────────────────────────────

/// `{payload, context}` → desglose + snapshot ADR-0085.
pub fn calculate_tax_pure(input: Value) -> Result<CalcOutput, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let context = input.get("context").cloned().unwrap_or(Value::Null);

    // El importe llega en CÉNTIMOS ENTEROS (ADR-0123 §1); un float ya no es dinero válido.
    let amount: i64 = match payload.get("amount") {
        Some(v) if !v.is_null() => money::from_json(v, i64::MIN),
        _ => i64::MIN,
    };
    if amount == i64::MIN {
        return Err("payload.amount requerido (céntimos enteros)".to_string());
    }
    let tax_included = payload.get("tax_included").map(as_bool).unwrap_or(false);

    // Categoría fiscal de la línea (clave canónica, ADR-0085).
    let cat = field(&payload, "tax_category_key");
    if cat.is_empty() {
        return Err("payload.tax_category_key requerido (categoría fiscal)".to_string());
    }

    // País/región: del contexto (identidad fiscal del hub) con override por payload.
    let cc = payload_or_context(&payload, &context, "country_code");
    let rc = payload_or_context(&payload, &context, "region_code");

    // Fecha de vigencia: payload.date (override) o la fecha del host (context.now).
    let date = {
        let d = field(&payload, "date");
        if d.is_empty() {
            field(&context, "now").chars().take(10).collect::<String>()
        } else {
            d.chars().take(10).collect::<String>()
        }
    };

    let rules = candidate_rules(&payload, &context);
    let root = resolve_root(&rules, &cc, &rc, &cat, &date);

    let (tax_rule_id, source, components) = match root {
        Some(r) => (json!(field(r, "id")), "rule", rule_components(r, &rules, &date)),
        None => {
            if !payload.get("allow_missing_rate").map(as_bool).unwrap_or(false) {
                return Err(format!("no_rate: ninguna regla fiscal aplicable a categoría '{cat}' en '{cc}'"));
            }
            (Value::Null, "fallback_zero", vec![])
        }
    };

    // Tasa combinada = suma de los componentes (un componente para regla simple; 0 si no hay).
    let combined_pct: f64 = components.iter().map(|c| c.rate_pct).sum();
    let combined: Decimal = components.iter().map(|c| rate_dec(c.rate_pct)).sum();
    let hundred = Decimal::from(100);

    // Dinero en enteros de céntimos con UN redondeo por magnitud (ADR-0123 §2/§4):
    // * neto (tax_excluded): base = amount; cuota por componente = HALF_UP(base × tasa);
    //   total = base + Σcuotas — cuadra por construcción.
    // * bruto (tax_included, TPV B2C): base = HALF_UP(total / (1 + tasa combinada)) y la CUOTA
    //   POR DIFERENCIA (total − base): lo cobrado NO se mueve ni un céntimo. En el desglose,
    //   cada componente redondea HALF_UP y el ÚLTIMO absorbe el céntimo de ajuste para que la
    //   suma sea exactamente la cuota (issue #8: el bruto compuesto se preservaba mal).
    let (base, tax, quotas): (i64, i64, Vec<i64>) = if tax_included {
        let base = money::round(Decimal::from(amount) * hundred / (hundred + combined));
        let tax = amount - base;
        let mut quotas: Vec<i64> = components.iter().map(|c| money::percent_of(base, rate_dec(c.rate_pct))).collect();
        if let Some(n) = quotas.len().checked_sub(1) {
            let others: i64 = quotas[..n].iter().sum();
            quotas[n] = tax - others;
        }
        (base, tax, quotas)
    } else {
        let quotas: Vec<i64> = components.iter().map(|c| money::percent_of(amount, rate_dec(c.rate_pct))).collect();
        let tax = quotas.iter().sum();
        (amount, tax, quotas)
    };
    let total = base + tax;

    let breakdown: Vec<Value> = components
        .iter()
        .zip(quotas.iter())
        .map(|(c, q)| {
            json!({
                "base": base,          // céntimos (entero)
                "tax": q,              // céntimos (entero)
                "rate_pct": c.rate_pct,
                "rule_id": c.rule_id,
                "label": c.label,
                "tax_type": c.tax_type,
            })
        })
        .collect();

    Ok(CalcOutput {
        operations: vec![], // cálculo puro: sin escritura
        events: vec![],     // sin emit (contrato taxes.calculate)
        result: json!({
            "base": base,
            "tax": tax,
            "total": total,
            // ── Snapshot inmutable de la línea (ADR-0085) ──
            "tax_category_key": cat,
            "tax_rate_pct": combined_pct,
            "tax_country_code": cc,
            "tax_region_code": rc,
            "tax_rule_id": tax_rule_id,
            // ── Metadatos del cálculo ──
            "tax_included": tax_included,
            "source": source,
            // Desglose por componente (una entrada por componente; la raíz + sus hijos).
            "components": breakdown,
        }),
    })
}

// ── Lógica pura: bulk_create_rules (asistente / seed) ────────────────────────
//
// Crea N reglas de tipo (`taxes_rule`) en una sola llamada — la usa el asistente ("créame el
// IVA de España 2026") y el seed por país. Mismo patrón que el antiguo `bulk_create_rates`: el
// guest valida cada línea SIN abortar el lote, toma los ids de `context.new_ids` y devuelve N
// intenciones `taxes._insert_rule`. El host inyecta `:hub_id`/`:current_user_id`/`:now`.
// (Los COMPONENTES con parent_id se crean de uno en uno con `taxes.rules.create` porque
// necesitan el id de la regla raíz ya persistida.)

/// `payload.rules[i]` → params de `taxes._insert_rule`. `Ok(params)` con el `id` asignado, o
/// `Err(motivo)` si la línea es inválida (no aborta el lote).
fn rule_op_params(item: &Value, id: Value) -> Result<Map<String, Value>, String> {
    let country = as_str(item.get("country_code").unwrap_or(&Value::Null));
    if country.trim().len() != 2 {
        return Err("`country_code` debe ser un código ISO de 2 letras".to_string());
    }
    let cat = as_str(item.get("tax_category_key").unwrap_or(&Value::Null));
    if cat.trim().is_empty() {
        return Err("falta `tax_category_key`".to_string());
    }
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
    p.insert("id".into(), id);
    p.insert("country_code".into(), json!(country.trim().to_uppercase()));
    p.insert("region_code".into(), opt_field(item, "region_code"));
    p.insert("tax_category_key".into(), json!(cat.trim()));
    p.insert("rate_pct".into(), json!(rate_pct));
    p.insert("tax_type".into(), json!(tax_type));
    p.insert("parent_id".into(), opt_field(item, "parent_id"));
    p.insert("component_label".into(), opt_field(item, "component_label"));
    p.insert("valid_from".into(), opt_field(item, "valid_from"));
    p.insert("valid_to".into(), opt_field(item, "valid_to"));
    Ok(p)
}

/// Campo opcional de string: ausente o null → `Value::Null` (el host lo bindea como SQL NULL).
fn opt_field(item: &Value, key: &str) -> Value {
    match item.get(key) {
        Some(Value::Null) | None => Value::Null,
        Some(v) => Value::String(as_str(v)),
    }
}

/// `{payload:{rules:[...]}, context:{new_ids:[...]}}` → intenciones `taxes._insert_rule` + un
/// evento `taxes.rule.created` por regla. Errores parciales no abortan el lote.
pub fn bulk_create_rules_pure(input: Value) -> Output {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let new_ids: Vec<Value> = input
        .get("context")
        .and_then(|c| c.get("new_ids"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let empty: Vec<Value> = Vec::new();
    let rules = payload.get("rules").and_then(|v| v.as_array()).unwrap_or(&empty);

    let mut ops: Vec<Operation> = Vec::new();
    let mut events: Vec<Event> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    let mut created = 0usize;

    for (i, item) in rules.iter().take(MAX_BULK_RULES).enumerate() {
        let id = new_ids.get(created).cloned().unwrap_or(Value::Null);
        if id.is_null() {
            errors.push(json!({ "index": i, "error": "sin id disponible (lote demasiado grande)" }));
            continue;
        }
        match rule_op_params(item, id.clone()) {
            Ok(params) => {
                events.push(Event::new(
                    "taxes.rule.created",
                    json!({
                        "id": id,
                        "country_code": params.get("country_code").cloned().unwrap_or(Value::Null),
                        "tax_category_key": params.get("tax_category_key").cloned().unwrap_or(Value::Null),
                        "rate_pct": params.get("rate_pct").cloned().unwrap_or(Value::Null),
                    }),
                ));
                ops.push(Operation::sql("taxes._insert_rule", params));
                created += 1;
            }
            Err(reason) => errors.push(json!({ "index": i, "error": reason })),
        }
    }

    events.push(Event::new(
        "taxes.rules.bulk_create.report",
        json!({ "created": created, "errors": errors }),
    ));

    Output { operations: ops, events }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `{payload, context:{reads:{"taxes.rules.list": rules}}}` — simula la pre-carga del keystone.
    fn calc_input(payload: Value, rules: Value) -> Value {
        json!({ "payload": payload, "context": { "reads": { "taxes.rules.list": rules } } })
    }

    fn ctx_rules(n: usize) -> Value {
        let ids: Vec<Value> = (0..n).map(|i| json!(format!("id-{i}"))).collect();
        json!({ "context": { "new_ids": ids } })
    }

    fn with_payload(mut input: Value, payload: Value) -> Value {
        input.as_object_mut().unwrap().insert("payload".into(), payload);
        input
    }

    // ── calculate_tax: resolución por categoría ──────────────────────────────

    #[test]
    fn resolves_simple_rate_by_category() {
        // restaurant.food en ES → 10% sobre 100,00 € (10000 céntimos) → 1000.
        let rules = json!([
            { "id": "r-food", "country_code": "ES", "region_code": null, "tax_category_key": "restaurant.food",
              "rate_pct": 10.0, "tax_type": "vat", "parent_id": null, "is_active": 1 },
            { "id": "r-gen", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "tax_category_key": "restaurant.food", "country_code": "ES" });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        let r = &out.result;
        assert_eq!(r["base"], json!(10000));
        assert_eq!(r["tax"], json!(1000));
        assert_eq!(r["total"], json!(11000));
        // snapshot ADR-0085
        assert_eq!(r["tax_category_key"], json!("restaurant.food"));
        assert_eq!(r["tax_rate_pct"], json!(10.0));
        assert_eq!(r["tax_country_code"], json!("ES"));
        assert_eq!(r["tax_rule_id"], json!("r-food"));
        let comps = r["components"].as_array().unwrap();
        assert_eq!(comps.len(), 1);
    }

    #[test]
    fn country_region_come_from_context() {
        // El país/región los inyecta el runtime en el contexto (hub_settings); el payload solo
        // lleva la categoría. La regla product.generic ES → 21%.
        let rules = json!([
            { "id": "r-gen", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 }
        ]);
        let input = json!({
            "payload": { "amount": 10000, "tax_category_key": "product.generic" },
            "context": { "country_code": "ES", "region_code": null, "reads": { "taxes.rules.list": rules } }
        });
        let out = calculate_tax_pure(input).unwrap();
        assert_eq!(out.result["tax"], json!(2100));
        assert_eq!(out.result["tax_country_code"], json!("ES"));
    }

    #[test]
    fn region_rule_beats_country_rule() {
        // IGIC Canarias: regla de región ES-CN (7%) gana a la regla de país ES (21%).
        let rules = json!([
            { "id": "r-es", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 },
            { "id": "r-cn", "country_code": "ES", "region_code": "ES-CN", "tax_category_key": "product.generic",
              "rate_pct": 7.0, "tax_type": "igic", "parent_id": null, "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "tax_category_key": "product.generic", "country_code": "ES", "region_code": "ES-CN" });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        assert_eq!(out.result["tax_rule_id"], json!("r-cn"));
        assert_eq!(out.result["tax"], json!(700));
    }

    #[test]
    fn root_plus_components_recargo_de_equivalencia() {
        // Regla raíz IVA 21 (product.generic ES) + componente Recargo de equivalencia 5,2
        // (parent_id = raíz). Sobre 10000: 2100 + 520 = 2620 (26,2%).
        let rules = json!([
            { "id": "r-iva", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "component_label": "IVA", "is_active": 1 },
            { "id": "c-re", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 5.2, "tax_type": "surcharge", "parent_id": "r-iva", "component_label": "Recargo de equivalencia", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "tax_category_key": "product.generic", "country_code": "ES" });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        let r = &out.result;
        assert_eq!(r["tax_rule_id"], json!("r-iva"));
        assert_eq!(r["tax_rate_pct"], json!(26.2));
        assert_eq!(r["tax"], json!(2620));
        assert_eq!(r["total"], json!(12620));
        let comps = r["components"].as_array().unwrap();
        assert_eq!(comps.len(), 2);
        assert_eq!(comps[0]["rule_id"], json!("r-iva"));
        assert_eq!(comps[0]["tax"], json!(2100));
        assert_eq!(comps[0]["label"], json!("IVA"));
        assert_eq!(comps[1]["rule_id"], json!("c-re"));
        assert_eq!(comps[1]["tax"], json!(520));
        assert_eq!(comps[1]["label"], json!("Recargo de equivalencia"));
    }

    #[test]
    fn tax_included_unwinds_combined_rate() {
        // Bruto 12620 con IVA21+RE5,2 → base 10000, cuota 2620.
        let rules = json!([
            { "id": "r-iva", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 },
            { "id": "c-re", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 5.2, "tax_type": "surcharge", "parent_id": "r-iva", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 12620, "tax_category_key": "product.generic", "country_code": "ES", "tax_included": true });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        assert_eq!(out.result["base"], json!(10000));
        assert_eq!(out.result["tax"], json!(2620));
        assert_eq!(out.result["total"], json!(12620));
    }

    #[test]
    fn money_in_result_is_integer_cents() {
        // ADR-0123 §1: el dinero en JSON es ENTERO de céntimos — no 10000.0. El cálculo
        // interno es Decimal exacto del SDK, no f64 con epsilon.
        let rules = json!([
            { "id": "r", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 }
        ]);
        let payload = json!({ "amount": 250, "tax_category_key": "product.generic", "country_code": "ES" });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        // 250 × 21 % = 52,5 → HALF_UP → 53. Y como ENTEROS JSON (json! distingue 53 de 53.0).
        assert_eq!(out.result["base"], json!(250));
        assert_eq!(out.result["tax"], json!(53));
        assert_eq!(out.result["total"], json!(303));
    }

    #[test]
    fn tax_included_keeps_charged_amount_by_difference() {
        // ADR-0123 §4 (TPV B2C, IVA incluido): base = round(total/(1+tipo)) y CUOTA POR
        // DIFERENCIA (total − base) — lo cobrado no se mueve NI UN CÉNTIMO. Con cuota
        // recalculada por componente, 101 se rompía: base=83, round(83×21%)=17 y
        // base+cuota=100 ≠ 101.
        let rules = json!([
            { "id": "r", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 }
        ]);
        let payload = json!({ "amount": 101, "tax_category_key": "product.generic", "country_code": "ES", "tax_included": true });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        assert_eq!(out.result["base"], json!(83));   // round(101/1,21) = round(83,47)
        assert_eq!(out.result["tax"], json!(18));    // 101 − 83, por diferencia
        assert_eq!(out.result["total"], json!(101), "lo cobrado NO se mueve");
    }

    #[test]
    fn tax_included_composite_last_component_absorbs_the_cent() {
        // Multi-componente con IVA incluido (issue #8): la suma de cuotas debe ser EXACTAMENTE
        // total − base. Cada componente redondea HALF_UP y el ÚLTIMO absorbe el céntimo de
        // ajuste. 12621 con 21+5,2: base=round(12621/1,262)=10001; cuota=2620;
        // IVA=round(10001×21%)=2100 → RE=2620−2100=520.
        let rules = json!([
            { "id": "r-iva", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "is_active": 1 },
            { "id": "c-re", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 5.2, "tax_type": "surcharge", "parent_id": "r-iva", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 12621, "tax_category_key": "product.generic", "country_code": "ES", "tax_included": true });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        let r = &out.result;
        assert_eq!(r["total"], json!(12621), "lo cobrado NO se mueve");
        let base = r["base"].as_i64().unwrap();
        let tax = r["tax"].as_i64().unwrap();
        assert_eq!(base + tax, 12621, "base + cuota = total, por construcción");
        let comps = r["components"].as_array().unwrap();
        let comp_sum: i64 = comps.iter().map(|c| c["tax"].as_i64().unwrap()).sum();
        assert_eq!(comp_sum, tax, "el desglose SUMA la cuota exacta (el último absorbe)");
    }

    #[test]
    fn no_rule_errors_unless_allow_missing() {
        let rules = json!([]);
        let payload = json!({ "amount": 10000, "tax_category_key": "restaurant.food", "country_code": "ES" });
        assert!(calculate_tax_pure(calc_input(payload.clone(), rules.clone())).is_err());
        // allow_missing_rate → 0%
        let mut p = payload;
        p["allow_missing_rate"] = json!(true);
        let out = calculate_tax_pure(calc_input(p, rules)).unwrap();
        assert_eq!(out.result["tax"], json!(0));
        assert_eq!(out.result["tax_rule_id"], Value::Null);
    }

    #[test]
    fn expired_rule_is_not_picked() {
        // Regla con valid_to en el pasado → no aplica en la fecha del host.
        let rules = json!([
            { "id": "old", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 18.0, "tax_type": "vat", "parent_id": null, "valid_to": "2012-08-31", "is_active": 1 },
            { "id": "new", "country_code": "ES", "region_code": null, "tax_category_key": "product.generic",
              "rate_pct": 21.0, "tax_type": "vat", "parent_id": null, "valid_from": "2012-09-01", "is_active": 1 }
        ]);
        let payload = json!({ "amount": 10000, "tax_category_key": "product.generic", "country_code": "ES", "date": "2026-06-27" });
        let out = calculate_tax_pure(calc_input(payload, rules)).unwrap();
        assert_eq!(out.result["tax_rule_id"], json!("new"));
        assert_eq!(out.result["tax"], json!(2100));
    }

    // ── bulk_create_rules ────────────────────────────────────────────────────

    #[test]
    fn bulk_create_rules_builds_one_op_per_valid_rule() {
        let input = with_payload(
            ctx_rules(8),
            json!({ "rules": [
                { "country_code": "ES", "tax_category_key": "restaurant.food", "rate_pct": 10 },
                { "country_code": "es", "tax_category_key": "product.generic", "rate_pct": 21.0 },
            ] }),
        );
        let out = bulk_create_rules_pure(input);
        assert_eq!(out.operations.len(), 2);
        assert_eq!(out.operations[0].command, "taxes._insert_rule");
        assert_eq!(out.operations[0].params["id"], json!("id-0"));
        assert_eq!(out.operations[0].params["tax_category_key"], json!("restaurant.food"));
        // país en minúscula se normaliza a mayúscula
        assert_eq!(out.operations[1].params["country_code"], json!("ES"));
        assert_eq!(out.operations[0].params["tax_type"], json!("vat"));
        assert_eq!(out.events.len(), 3);
        assert_eq!(out.events[2].name, "taxes.rules.bulk_create.report");
    }

    #[test]
    fn bulk_create_rules_skips_invalid_without_aborting() {
        let input = with_payload(
            ctx_rules(8),
            json!({ "rules": [
                { "country_code": "ES", "tax_category_key": "restaurant.food", "rate_pct": 10 },
                { "country_code": "ES", "rate_pct": 21 },                                  // sin categoría
                { "country_code": "ESP", "tax_category_key": "product.generic", "rate_pct": 4 }, // país != 2
                { "country_code": "ES", "tax_category_key": "product.generic" },           // sin rate_pct
                { "country_code": "ES", "tax_category_key": "restaurant.drink", "rate_pct": 0 }, // 0% válido
            ] }),
        );
        let out = bulk_create_rules_pure(input);
        assert_eq!(out.operations.len(), 2);
        assert_eq!(out.operations[0].params["id"], json!("id-0"));
        assert_eq!(out.operations[1].params["id"], json!("id-1"));
        let report = &out.events.last().unwrap().payload;
        assert_eq!(report["created"], json!(2));
        assert_eq!(report["errors"].as_array().unwrap().len(), 3);
    }
}
