-- Taxes · la CALIFICACIÓN fiscal de una regla (hub#292, ADR-0185).
--
-- Hasta aquí una regla solo sabía decir CUÁNTO se repercute (`rate_pct`) y de qué familia es el
-- impuesto (`tax_type`). Faltaba la otra mitad, la que un registro fiscal tiene que declarar: si la
-- operación está SUJETA, EXENTA o NO SUJETA, bajo qué RÉGIMEN y —cuando es exenta— por qué CAUSA.
-- Sin ese dato, el módulo de compliance no tenía más remedio que declararlo todo como venta
-- nacional sujeta y no exenta: un servicio sanitario salía como «sujeto al 0 %» y una venta
-- intracomunitaria repercutía IVA español.
--
-- Vive en la REGLA y no en la categoría porque es la regla la que ya está indexada por
-- `(país, región, categoría, vigencia)`, que es exactamente la tupla en la que este dato cambia:
-- un tratamiento sanitario está exento en España (art. 20.Uno.3º de la Ley 37/1992) y no tiene por
-- qué estarlo en otra jurisdicción. La categoría sigue siendo la clave abstracta enlazable
-- (ADR-0085).
--
-- Los DEFAULT hacen que las reglas ya creadas sigan significando exactamente lo que significaban:
-- venta sujeta y no exenta, régimen general, sin exención. Ninguna factura ya emitida cambia de
-- interpretación — están encadenadas en la huella fiscal.

-- Sujeta · sujeta con inversión del sujeto pasivo · exenta · no sujeta · no sujeta por reglas de
-- localización. La lista la valida el handler y el JSON Schema del comando; aquí no hay CHECK para
-- no romper la portabilidad del subconjunto "ERPlora SQL" (ADR-0007).
ALTER TABLE taxes_rule ADD COLUMN IF NOT EXISTS operation_class TEXT NOT NULL DEFAULT 'subject';

-- Causa de la exención, en el vocabulario de la JURISDICCIÓN (en España, la `OperacionExenta` de
-- la AEAT: E1 art. 20, E2 art. 21, E3 art. 22, E4 arts. 23 y 24, E5 art. 25, E6 otros; con IGIC,
-- además E7/E8). Viaja OPACA: este módulo la guarda y la devuelve, no la interpreta — quien la
-- traduce a XML es el módulo de compliance del país. NULL fuera de las reglas exentas.
ALTER TABLE taxes_rule ADD COLUMN IF NOT EXISTS exempt_reason TEXT;

-- Régimen de la operación, también en el vocabulario de la jurisdicción (en España, la
-- `ClaveRegimen` de las listas L8A/IVA y L8B/IGIC de la AEAT; `01` = régimen general). NULL se
-- interpreta como régimen general.
ALTER TABLE taxes_rule ADD COLUMN IF NOT EXISTS regime_key TEXT;

-- El índice de resolución no cambia: la calificación se lee de la fila que ya se resolvió por
-- país+categoría+región, no se busca por ella.
