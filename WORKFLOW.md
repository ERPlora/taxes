# WORKFLOW — Impuestos

Prefijo: TAXES
Alcance MVP: transversal

> Contrato de comportamiento del módulo (pm#620, pm#621). Se lee antes de tocar el código y se
> actualiza en la misma PR que cambie un comportamiento. El detalle técnico vive en
> `architecture/modules/taxes.md`; aquí se escribe lo que ve y hace la persona. Contrastado contra
> `origin/main` v2.3.34 (05/10/2026).

## Para qué sirve y para quién

Impuestos guarda lo que dice cuánto IVA lleva cada cosa que se vende: las **categorías fiscales**
(«Restauración — comida», «Servicio — general»…, a las que apuntan los productos y los servicios) y
las **reglas** que fijan el tipo de cada categoría en un país o región y entre unas fechas, con su
calificación fiscal (sujeta, exenta, no sujeta, con inversión del sujeto pasivo). Casi nadie lo abre
a diario: se prepara al montar el negocio y se toca cuando cambia un tipo. Pero cada línea que cobra
Ventas, cada factura de Facturación y cada producto de Inventario o Servicios lee de aquí.

Lo usan el **administrador** y el **responsable** (crean y retiran reglas, categorías y alias) y el
**empleado** y el cajero (solo consultan; calcular lo tienen todos). Sirve igual a la restauración y a
la peluquería: lo que cambia es qué categorías vende cada una, no cómo funciona. No decide el precio,
no emite facturas ni habla con la AEAT, y no guarda el país del negocio (eso es de Ajustes del hub).

## Referencia adoptada

- [Ley 37/1992 del IVA](https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740): tipos general, reducido
  y superreducido (arts. 90 y 91), exenciones (art. 20), recargo de equivalencia. Los tipos y la
  calificación de fábrica salen de aquí; su contraste con la asesoría es de cada negocio.
- Las listas de la AEAT que el código cita (régimen `ClaveRegimen`, exención `OperacionExenta`, causas
  E1…E6): viajan como códigos opacos, no se interpretan aquí.
- [Odoo — impuestos](https://www.odoo.com/documentation/19.0/applications/finance/accounting/taxes/tax_computation.html):
  tipo «incluido en el precio» (la base sale de dentro del importe) y tipo añadido; varios impuestos
  sobre la misma línea; el impuesto se asigna al producto por categoría, no por porcentaje suelto.
- [Square — impuestos](https://squareup.com/help/us/en/article/5061-create-and-manage-your-tax-settings):
  el impuesto aditivo o incluido en el precio, y la lista de impuestos por local.
- Cambiar un tipo = poner fecha de fin al vigente y crear el nuevo (así lo hacen Oracle E-Business Tax,
  Dynamics 365 y SAP, citados en el código de la guarda de solapes), nunca editar la regla.
- La referencia de QA ya contrastada: `.claude/qa/qa-method-shared.md` L-01 (qué lleva el tique) y L-08
  (precio al consumidor con IVA incluido); no se rehace aquí.

## Antes de empezar

- **País del negocio**: lo guarda Ajustes del hub (campo «País», España o Portugal); sin él guardado
  el motor usa España. Impuestos solo lo lee.
- **Región** (Canarias, Ceuta, Melilla): también es de Ajustes del hub, pero esa pantalla no tiene
  campo para ella (TAXES-F11).
- Al instalar el módulo, el hub trae de fábrica 10 categorías, 16 alias y los tipos de España (TAXES-F16).
  Con eso un negocio español puede vender sin tocar nada.
- Si el negocio es de Portugal o de otro país, no hay ninguna regla de fábrica: hay que crearlas
  (TAXES-F04) y la lista de primeros pasos lo avisa hasta que exista una (TAXES-F17).
- Instalar Inventario, Servicios, Ventas o Facturación instala Impuestos con ellos; no se puede
  quitar mientras alguno esté instalado.

Configuración inicial, paso a paso:

1. Abre **Impuestos → Categorías** y revisa que están las que vendes; crea las que falten (TAXES-F02).
2. Abre **Impuestos → Reglas** y comprueba que cada categoría tiene su tipo para tu país (TAXES-F03).
   Crea las que falten (TAXES-F04); si el negocio es de Canarias, Ceuta o Melilla, sigue TAXES-F11.
3. Comprueba que «Tus impuestos» sale como hecho en la lista «Termina de configurar tu negocio»
   (TAXES-F17).
4. Haz una venta de prueba y comprueba el desglose del tique.

## Pantallas

El módulo se abre desde el menú **Impuestos** y tiene tres pestañas en la barra de abajo:
**Categorías**, **Reglas** y **Alias**. No tiene pestaña de Ajustes (no declara bloque de ajustes) ni
pestaña de Plan. Las tres siguen el permiso de quien mira: con solo consulta aparece el aviso «Puedes
consultar las reglas fiscales pero no modificarlas.», desaparece el botón «+» de la tabla y, en Reglas,
las acciones de fila. El servidor exige el permiso en cada acción aunque la pantalla enseñe el botón.

### Categorías
Tabla con Clave, Nombre, Descripción, Origen («🔒 Sistema» o «Propia») y Activa; buscador «Buscar clave
o nombre…», orden y filtros por columna. Las de fábrica salen con su nombre traducido al idioma de la
persona (la lista resuelve el idioma: preferencia personal, luego el del negocio, luego español); las
propias, con el texto que se tecleó. Botón «+» que abre el panel de alta (Clave, Nombre, Descripción,
«Añadir»). Sin acciones de fila. Vacía: «Sin categorías fiscales.». Cargando: «Cargando…». Error: el
aviso de la tabla con reintento; un fallo del alta sale dentro del panel.

### Reglas
Tabla con Categoría (la clave; un componente sale como «↳ clave · etiqueta»), País, Región, %, Tipo,
Calificación (con la causa de exención si la hay), Vigente desde, Vigente hasta y Activa. Buscador
«Buscar categoría o país…»; filtros por columna; en pantalla estrecha (hasta 834 px) abre en tarjetas
con el nombre de la categoría como título. Solo muestra las activas; filtrar Activa = «No» enseña las
desactivadas. Botón «+» con el panel de alta (País, Región, Categoría, %, Tipo, Calificación, Causa de
exención —solo si es exenta—, Régimen, Vigente desde, Vigente hasta, «Regla raíz (componente de)»,
«Etiqueta componente» y «Añadir»). Acciones de fila: «Poner fecha de fin» y «Desactivar» (en las
desactivadas, «Reactivar»; «Reparar» solo en una página que tenga reglas marcadas). Encima de la tabla
pueden salir tres avisos: el rechazo de una acción de fila, el de reglas que cobran tipo donde no toca y
el de reglas solapadas (con «Ver cuáles» / «Ver todas las reglas»). Vacía: «Sin reglas fiscales.».
Cargando: «Cargando…». Error: el aviso de la tabla con reintento.

### Alias
Tabla con Alias, Categoría (la clave), Origen («De fábrica» o «Aprendido») y Activa; buscador «Buscar
alias o categoría…». Botón «+» con el panel de alta (Alias, Categoría, Origen, «Añadir»). Vacía: «Sin
alias de categorías.». Cargando: «Cargando…». Error: el aviso de la tabla con reintento.

## Flujos

### TAXES-F01 Ver las categorías fiscales
Estado: hecho
Vertical: comun
Actor: administrador, responsable, empleado
Pantalla: Categorías
Pasos:
1. Abre **Impuestos → Categorías**.
2. Busca por clave o nombre, o filtra por Origen («Sistema» o «Propia»).
3. Lee la Clave: es lo que guardan los productos y los servicios y no cambia nunca; el Nombre es solo
   una etiqueta.
Entra: nada; lee las categorías activas del negocio.
Sale: nada (solo lectura).
Si falla: el aviso de la tabla con reintento. Sin permiso de consulta la pestaña se ve (la navegación del módulo no declara permiso), pero la tabla no carga y sale el aviso de error; afecta solo a roles propios, porque los cuatro de fábrica tienen permiso de consulta.
Implicados: COMBOS-F02, INVENTORY-F01, INVENTORY-F02, INVENTORY-F05, INVENTORY-F06, SALES-F09, SALES-F35, SERVICES-F01, SERVICES-F02, REC_PELUQUERIA-F04
QA: ninguno

### TAXES-F02 Crear una categoría fiscal propia
Estado: parcial — una categoría ya creada no se puede renombrar, desactivar ni quitar (no hay pantalla ni comando para ello); una clave repetida se rechaza pero sin mensaje propio (sin confirmar el texto que sale)
Vertical: comun
Actor: administrador, responsable
Pantalla: Categorías
Pasos:
1. En Categorías pulsa «+».
2. Escribe la Clave (minúsculas, empieza por letra, letras, dígitos, puntos y guiones bajos, hasta 80;
   por ejemplo `product.books`) y el Nombre; la Descripción es opcional.
3. Pulsa «Añadir».
4. El panel se cierra y la categoría sale en la tabla como «Propia», con su nombre tal como lo escribiste.
Entra: clave, nombre y descripción que escribe la persona.
Sale: la categoría, única por clave en el negocio (avisa: taxes.category.created). No trae ninguna regla: hasta que se cree (TAXES-F04), una venta de esa categoría se rechaza. Inventario también la crea cuando alguien elige «crear» al importar un archivo (TAXES-F15).
Si falla: el motivo sale dentro del panel; el botón «Añadir» está apagado mientras falte Clave o Nombre.
Implicados: INVENTORY-F09
QA: ninguno

### TAXES-F03 Ver y filtrar las reglas
Estado: hecho
Vertical: comun
Actor: administrador, responsable, empleado
Pantalla: Reglas
Pasos:
1. Abre **Impuestos → Reglas**.
2. Busca por categoría o país, o filtra por Categoría, País, Región, Tipo, Calificación o Activa.
3. Filtra Activa = «No» para ver las desactivadas; la fila ofrece «Reactivar» (TAXES-F08).
4. Reconoce un componente (recargo) por «↳ clave · etiqueta»; no sale necesariamente debajo de su raíz, porque la tabla se ordena por país.
Entra: nada; lee las reglas del negocio (por defecto solo las activas).
Sale: nada (solo lectura).
Si falla: el aviso de la tabla con reintento; si fallan las lecturas auxiliares, el selector de categoría del alta y el filtro de País pueden quedar vacíos hasta reintentar (el país del alta es una lista fija y nunca queda vacío).
Implicados: ninguno
QA: ninguno

### TAXES-F04 Fijar el tipo de una categoría en un país o región
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. En Reglas pulsa «+».
2. Elige el País (lista cerrada ISO) y, solo si el tipo cambia dentro del país, la Región (por ejemplo
   ES-CN); vacía vale para todo el país.
3. Elige la Categoría y escribe el %, entre 0 y 100.
4. Elige el Tipo («IVA» por defecto; «IGIC (Canarias)», «IPSI (Ceuta/Melilla)», etc.) y, si quieres,
   Vigente desde y Vigente hasta (vacío = desde siempre / para siempre).
5. Pulsa «Añadir»; el panel se cierra y la regla sale en la tabla.
Entra: país, región, categoría, tipo, familia de impuesto y fechas que elige la persona.
Sale: la regla activa (avisa: taxes.rule.created). Desde ese momento Ventas y Facturación la usan para las ventas nuevas: gana la regla de la región del negocio y, si no hay, la del país entero; una regla de otra región nunca se usa. Las ventas ya hechas no cambian (TAXES-F07).
Si falla: el motivo sale dentro del panel. Dos reglas activas de la misma categoría, país y región no pueden estar vigentes el mismo día: el rechazo marca «Vigente desde» con «Se solapa con otra regla activa de este país, región y categoría…» (se resuelve con TAXES-F07). Un rango de fechas al revés, o un componente que no cuelga de una raíz de su mismo país, región y categoría, se rechaza con el aviso de «no se ha podido crear la regla».
Implicados: INVOICE-F01, SALES-F01
QA: L-01, L-08

### TAXES-F05 Declarar una operación exenta, no sujeta o con inversión del sujeto pasivo
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. En Reglas pulsa «+» y rellena país, categoría y tipo como en TAXES-F04.
2. En Calificación elige «Exenta», «No sujeta», «No sujeta (reglas de localización)» o «Inversión del
   sujeto pasivo». El % se pone en 0 y se bloquea, con la nota «Esta operación no lleva impuesto, así
   que su tipo es 0 %.».
3. Si es «Exenta», escribe la Causa de exención (hasta 10 caracteres, por ejemplo E1); el Régimen es
   opcional (por defecto el general, 01).
4. Pulsa «Añadir».
Entra: calificación, causa de exención y régimen que elige o escribe la persona (códigos de la AEAT, opacos para este módulo).
Sale: la regla con su calificación (avisa: taxes.rule.created). La venta no copia la calificación en su línea: la resuelve Facturación al emitir, contra las reglas vigentes ese día, y queda en el desglose de la factura. VeriFactu no lee Impuestos: toma la calificación, la causa y el régimen de ese desglose y los traduce al registro de la AEAT (REC_FISCAL-F04).
Si falla: una regla que no cobra impuesto con tipo mayor que 0, o un componente con tipo colgado de ella, se rechaza («no se ha podido crear la regla…»). La causa de exención no se comprueba contra ninguna lista ni se exige: una exenta sin causa se guarda, Facturación la emite con clase exenta y sin causa, y el motor fiscal del hub la declara a la AEAT como exenta «por otros» (E6) (`hub` `crates/plugins/verifactu/src/aeat.rs`).
Implicados: INVOICE-F01, REC_FISCAL-F04
QA: ninguno

### TAXES-F06 Añadir un recargo de equivalencia a un tipo
Estado: parcial — el recargo se suma a toda venta de la categoría, sin mirar al cliente; no se siembra ninguno; por lote se puede crear sin ninguna comprobación (TAXES-F12)
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. Crea antes la regla principal de la categoría (TAXES-F04): es la raíz.
2. En Reglas pulsa «+», elige el mismo País, Región y Categoría y escribe el % del recargo (por
   ejemplo 5,2).
3. Elige el Tipo «Recargo»; en «Regla raíz (componente de)» elige la raíz (solo salen las compatibles
   y vigentes hoy) y escribe la «Etiqueta componente» (por ejemplo «Recargo de equivalencia»).
4. Pulsa «Añadir».
Entra: el recargo, la raíz de la que cuelga y su etiqueta.
Sale: la regla componente (avisa: taxes.rule.created). Las ventas de esa categoría llevan tipo combinado (21 + 5,2 = 26,2) con el desglose por componente; la calificación y la familia de impuesto siguen siendo las de la raíz.
Si falla: sin raíz compatible el selector dice «No hay regla raíz compatible para ese país/región/categoría» y está apagado; una raíz que no cobra impuesto no se ofrece. Un componente de un componente no existe: solo se mira un nivel.
Implicados: INVOICE-F01, SALES-F01
QA: ninguno

### TAXES-F07 Cambiar un tipo a partir de una fecha
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. En la fila de la regla vigente pulsa «Poner fecha de fin».
2. Escribe el último día que se aplica (el día antes de que empiece el nuevo tipo) y pulsa «Guardar
   fecha de fin».
3. Crea la regla nueva (TAXES-F04) con «Vigente desde» el día siguiente.
4. La tabla enseña las dos con sus fechas; desde la fecha de cambio las ventas nuevas usan la nueva.
Entra: la fecha de fin (inclusiva) y los datos de la regla nueva.
Sale: la regla con su fecha de fin (avisa: taxes.rule.ended). Una venta ya hecha conserva su tipo, categoría, país, región y regla: la línea de venta guarda esa copia. Una factura ya emitida no cambia. En cambio, Facturación vuelve a leer el tipo y la calificación de la regla vigente el día de emisión: si el tipo cambió entre la venta y una factura emitida después (por ejemplo una factura completa a petición), la factura se rechaza por descuadre de cuota. No se edita una regla: no existe esa acción.
Si falla: un fin anterior al inicio de la regla se rechaza con «Esa regla no puede terminar en esa fecha…»; un fin que invade otra regla activa del mismo hueco, con el aviso de solape. No se comprueba que la fecha sea futura: poner un fin pasado deja un hueco sin tipo y las ventas de esa categoría se rechazan hasta crear la siguiente. Dos tramos seguidos (uno acaba el 31/12, el otro empieza el 1/1) no se solapan.
Implicados: INVOICE-F01, INVOICE-F04, SALES-F01, REC_FISCAL-F02, REC_FISCAL-F10
QA: ninguno

### TAXES-F08 Desactivar y reactivar una regla
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. En la fila pulsa «Desactivar» y confirma en «Desactivar regla fiscal» con «Desactivar regla»
   («La regla dejará de aplicarse a operaciones nuevas. Los documentos fiscales ya emitidos no se modifican.»).
2. La regla desaparece de la tabla; para verla, filtra Activa = «No».
3. Para recuperarla, en esa vista pulsa «Reactivar» (sin confirmación).
Entra: la regla elegida.
Sale: la regla activa o inactiva (avisa: taxes.rule.deactivated / taxes.rule.activated). Desactivar una raíz deja sus componentes donde estaban, pero dejan de contar porque solo se leen los de la raíz que se usa. Si era la única raíz de la categoría, las ventas de esa categoría se rechazan. No existe borrar una regla.
Si falla: reactivar una regla que ya está activa, o que no es de este negocio, sale como «No se ha podido recuperar la regla…»; reactivar una que ahora se solapa con otra activa, con el aviso de solape. Desactivar, en cambio, no comprueba que la regla exista ni que esté activa: responde bien y avisa igualmente.
Implicados: SALES-F01
QA: ninguno

### TAXES-F09 Reparar una regla que cobra un tipo donde no toca
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. Si hay reglas así, encima de la tabla sale un aviso que cuenta cuántas («…Sus ventas se cobran en
   caja pero no se pueden facturar…»); la fila lleva la marca «debe ser 0 % en esta clase».
2. En esa fila pulsa «Reparar».
3. Elige «Sin impuesto (0 %)» (el tipo pasa a 0 y, en una raíz, también el de sus componentes) o
   «Cobrar el tipo» (la regla pasa a sujeta y pierde la causa de exención; solo se ofrece si el problema
   es la clase de la propia regla).
4. La marca y el aviso desaparecen.
Entra: la regla y la lectura que elige la persona.
Sale: la regla corregida en su sitio (avisa: taxes.rule.repaired). Las ventas ya hechas y las facturas emitidas no cambian; las nuevas se facturan con normalidad.
Si falla: una regla que no existe, no es de este negocio o no tiene nada que reparar se rechaza («No se pudo reparar la regla…»). Estas reglas son las guardadas antes de que se prohibiera crearlas: la alta normal ya no las deja nacer, pero el lote del asistente sí puede crear un componente con tipo bajo una raíz exenta; nadie las repara solo.
Implicados: INVOICE-F06, REC_FISCAL-F09
QA: ninguno

### TAXES-F10 Resolver reglas que se solapan
Estado: hecho
Vertical: comun
Actor: administrador, responsable
Pantalla: Reglas
Pasos:
1. Si hay pares así (guardados antes de que se prohibiera el solape), encima de la tabla sale un aviso
   con el recuento de todo el negocio y la fila marca «se solapa con otra regla» bajo «Vigente desde».
2. Pulsa «Ver cuáles» para dejar solo esas reglas.
3. En la regla antigua pulsa «Poner fecha de fin» (el día antes de que empiece la nueva) o, en la que no
   deba aplicarse, «Desactivar».
4. Cuando se resuelve el último par, la tabla vuelve a enseñar todas las reglas; «Ver todas las reglas» las trae antes.
Entra: la fecha de fin o la desactivación que elige la persona.
Sale: el par resuelto (avisa: taxes.rule.ended / taxes.rule.deactivated). Mientras siga el solape, la caja cobra la regla que empieza más tarde.
Si falla: un fin que sigue invadiendo a la otra regla se rechaza con el aviso de solape: hay que desactivar una.
Implicados: ninguno
QA: ninguno

### TAXES-F11 Montar un negocio de Canarias, Ceuta o Melilla
Estado: parcial — ninguna pantalla del hub escribe la región: Ajustes solo deja elegir el país (España o Portugal) y la región solo se fija con la API de ajustes, que la valida y exige que sea del país del negocio. Sin región el negocio cobra las reglas nacionales (IVA)
Vertical: comun
Actor: administrador
Pantalla: Reglas
Pasos:
1. Comprueba que la región del negocio es ES-CN (Canarias), ES-CE (Ceuta) o ES-ML (Melilla); el país,
   España. Hoy solo se fija por la API de ajustes; no hay pantalla.
2. En Reglas crea una regla por cada categoría que vendes: País «España», esa Región, el % del
   territorio, Tipo «IGIC (Canarias)» o «IPSI (Ceuta/Melilla)» (TAXES-F04).
3. No borres las reglas de IVA: en un negocio con región se aplican a toda categoría que no tenga regla
   regional, cobrando IVA sin avisar. Por eso hace falta una regla regional por cada categoría que vendas.
4. Haz una venta de prueba y comprueba el tipo cobrado (que la factura declare IGIC o IPSI, y si el tique impreso lo enseña, sin confirmar).
Entra: región del negocio, y un tipo regional por categoría que fija la persona (no se siembra ninguno a propósito).
Sale: reglas regionales; para una venta, la regla de la región gana a la nacional. La familia de impuesto no se guarda en la línea de venta: la resuelve Facturación al emitir y queda en el desglose de la factura.
Si falla: una categoría sin regla regional se cobra con la nacional, al IVA, sin avisar; con la región vacía, las reglas regionales no se usan nunca.
Implicados: INVOICE-F01, SALES-F01, REC_FISCAL-F04
QA: ninguno

### TAXES-F12 Crear varias reglas de golpe con el asistente
Estado: parcial — sin pantalla; el lote deja pasar un componente (parent_id), también uno con tipo bajo una raíz exenta, y un rango de fechas al revés, sin las comprobaciones de la alta normal; la respuesta no trae el motivo de cada fila saltada
Vertical: comun
Actor: administrador, responsable, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente algo como «crea los tipos de IVA de España 2026».
2. El asistente prepara hasta 100 reglas y las guarda.
3. Revisa el resultado: la respuesta dice cuántas reglas entraron; solo se salta, y entra el resto, una fila con calificación que no cobra impuesto y tipo mayor que 0.
4. Comprueba las reglas en Reglas (TAXES-F03).
Entra: la lista de reglas que dicta la persona al asistente.
Sale: una regla por fila válida (avisa: taxes.rule.created por cada una y un informe con cuántas entraron y el motivo de cada fila saltada; ese motivo va solo en el aviso, no en la respuesta a quien llama). Si una fila solapa otra regla activa del mismo hueco, falla el lote entero.
Si falla: si cualquier fila incumple el formato (país fuera de la lista ISO, calificación fuera de la lista, falta categoría o tipo, tipo mayor que 100, fecha mal escrita) se rechaza el lote entero antes de procesar ninguna fila. Por lectura del código, una categoría que no existe también hace fallar el lote entero (clave ajena). Los componentes deberían crearse uno a uno, pero el lote acepta un `parent_id` y lo guarda sin comprobar raíz, país ni categoría.
Implicados: ninguno
QA: ninguno

### TAXES-F13 Ver los alias de categoría
Estado: hecho
Vertical: comun
Actor: administrador, responsable, empleado
Pantalla: Alias
Pasos:
1. Abre **Impuestos → Alias**.
2. Busca por alias o categoría, o filtra por Categoría u Origen.
Entra: nada; lee los alias activos.
Sale: nada (solo lectura).
Si falla: el aviso de la tabla con reintento.
Implicados: ninguno
QA: ninguno

### TAXES-F14 Enseñar un alias de categoría a mano
Estado: parcial — la pantalla guarda el texto sin pasarlo a minúsculas ni juntar espacios dobles (solo quita los de los extremos; el importador sí lo normaliza todo), así que un alias con mayúsculas nunca casa; no se puede editar ni quitar un alias; un alias repetido se rechaza sin mensaje propio (sin confirmar el texto)
Vertical: comun
Actor: administrador, responsable
Pantalla: Alias
Pasos:
1. En Alias pulsa «+».
2. Escribe el Alias (el texto que llega de fuera, por ejemplo `comida`), elige la Categoría y el Origen
   («Aprendido» por defecto).
3. Pulsa «Añadir».
Entra: texto externo y categoría que elige la persona.
Sale: el alias, único por texto en el negocio (avisa: taxes.alias.created). La próxima importación de Inventario lo entiende.
Si falla: el motivo sale dentro del panel; «Añadir» está apagado mientras falte Alias o Categoría.
Implicados: INVENTORY-F09
QA: ninguno

### TAXES-F15 Decir al importador de Inventario qué categoría es un texto
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Quien importa un archivo de productos con una columna de IVA o categoría no hace nada en Impuestos.
2. Inventario pasa cada texto a minúsculas y lo contrasta primero con las claves y nombres de las
   categorías y luego con los alias.
3. Lo que no casa lo pregunta él a la persona; su respuesta se guarda como alias aprendido o como
   categoría nueva (TAXES-F02, TAXES-F14).
Entra: el texto normalizado, de Inventario.
Sale: la clave de categoría, o nada si no hay alias; los alias y categorías nuevos que decida la persona (avisa: taxes.alias.created / taxes.category.created).
Si falla: si falla la búsqueda de alias, el texto queda sin resolver y se pregunta; si no carga la lista de categorías, Inventario lo captura sin avisar y la importación sigue: las filas con texto fiscal acaban fallidas con «Falta la categoría fiscal» y las que no traen columna se preguntan con el desplegable vacío (INVENTORY-F09).
Implicados: INVENTORY-F09, INVENTORY-F10
QA: ninguno

### TAXES-F16 Sembrar el catálogo de fábrica al instalar
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Al instalar el módulo en un negocio, el hub siembra el catálogo; no se hace nada a mano.
2. Los negocios que ya tenían el módulo reciben lo que les falte al actualizarlo.
3. Se comprueba en Categorías y Reglas.
Entra: nada.
Sale: 10 categorías de sistema (`restaurant.food`, `restaurant.drink`, `restaurant.alcohol`, `restaurant.delivery`, `service.generic`, `service.health`, `service.education`, `product.generic`, `product.reduced`, `product.super_reduced`), 16 alias de fábrica y 10 reglas para España, para todo el país y desde el 01/09/2012: general 21 % (`product.generic`, `service.generic`, `restaurant.alcohol`), 10 % (`restaurant.food`, `restaurant.drink`, `restaurant.delivery`, `product.reduced`), 4 % (`product.super_reduced`) y exentas con causa E1 al 0 % (`service.health`, `service.education`). No hay reglas de IGIC, IPSI, recargo ni de ningún otro país.
Si falla: nunca pisa una fila editada, ni recrea una desactivada ni un alias reapuntado; repetirla no duplica nada.
Implicados: REC_ALTA-F08
QA: qa-hub §4 (discrepa)

### TAXES-F17 Avisar de que faltan tipos para el país del negocio
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: Hub: Termina de configurar tu negocio
Pasos:
1. En la lista «Termina de configurar tu negocio» sale el paso «Tus impuestos» («Configura los tipos de
   IVA del país en el que vendes para que el TPV pueda calcular el precio de una venta.»).
2. Pulsa «Configurar»: lleva a la pestaña Reglas. El paso solo se enseña a quien puede gestionar impuestos.
3. Cuando existe una regla raíz activa y vigente hoy para el país del negocio, el paso sale hecho.
Entra: las reglas y el país guardado en Ajustes del hub.
Sale: un único paso, de nivel «Importante»; no bloquea vender por sí mismo.
Si falla: basta una sola regla de cualquier categoría para darlo por hecho, aunque otras categorías sigan sin regla. Si el negocio no tiene país guardado, cuenta reglas de cualquier país (el motor, en cambio, usa España).
Implicados: ninguno
QA: qa-hub §4

### TAXES-F18 Calcular el impuesto de un importe
Estado: hecho
Vertical: comun
Actor: asistente
Pantalla: asistente
Pasos:
1. Pide al asistente «¿cuánto IVA lleva 100 € de producto general?». Ningún módulo lo llama: Ventas y Facturación resuelven por su cuenta (TAXES-F19).
2. Se indica el importe (en céntimos enteros) y la categoría; opcionalmente la fecha y si el importe ya
   lleva el impuesto.
3. Se obtiene la base, la cuota, el total, el tipo combinado, la calificación y el desglose por
   componente.
Entra: importe en céntimos, categoría, y país y región del negocio (el que llama puede sustituirlos); fecha por defecto, hoy en UTC (entre la medianoche local y la UTC puede resolver otra regla que la caja, que usa la fecha local del negocio).
Sale: solo respuesta; no guarda nada ni avisa. Sobre importe sin impuesto, cuota de cada componente = base × tipo redondeada al céntimo a mitad hacia arriba; con el impuesto incluido, base = importe ÷ (1 + tipo combinado) redondeada, y la cuota es lo que resta, así que lo cobrado nunca se mueve un céntimo (el último componente absorbe el ajuste). El redondeo no es propio de Impuestos: es el común del hub (`guest-sdk`, `money::round` y `money::percent_of`), el mismo con que Ventas cierra el tique por tipo (SALES-F01) y Facturación cuadra la cuota de cada tipo al céntimo (INVOICE-F01). Cambiar ese redondeo cambia los tres a la vez. El motor de VeriFactu no usa este redondeo: compara la cuota con base × tipo con su propia tolerancia y solo puede negarse a sellar una que no cuadra (REC_FISCAL-F04); cambiar solo el cálculo de este módulo deja al asistente diciendo una cifra distinta de la del tique.
Si falla: sin regla aplicable responde «no_rate» (no cobra 0 % salvo que el que llama lo pida expresamente); si el hub no pudo leer las reglas, el cálculo se detiene sin adivinar; sin importe o sin categoría, se rechaza. Cobrar un tique no pasa por aquí (TAXES-F19).
Implicados: INVOICE-F01, SALES-F01, REC_FISCAL-F04, HUB-F18, PRICING-F02, PRICING-F08
QA: L-08

### TAXES-F19 Entregar las reglas y las categorías a Ventas, Facturación, Inventario y Servicios
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Quien cobra un tique, emite una factura o guarda un producto no abre Impuestos.
2. Ventas y Facturación piden al arrancar la operación todas las reglas activas; si no llegan, la
   operación se rechaza antes de escribir nada.
3. Inventario, Servicios y Ventas listan las categorías para elegirlas. Nadie comprueba al guardar un
   producto que su categoría exista en Impuestos: el bloque que lo pedía en Inventario está retirado en
   el hub (hub#610) y no se ejecuta, así que por el asistente o la API entra una clave inventada y el
   TPV marca después ese artículo como no vendible (INVENTORY-F01).
Entra: lo que ya está guardado en Reglas y Categorías.
Sale: lo que la línea de venta congela: categoría, tipo combinado, país, región y regla. La calificación (familia, clase, régimen y causa) no viaja en la venta: la resuelve Facturación al emitir, contra las reglas vigentes ese día, y queda en el desglose de la factura. Con la lista de reglas vacía, una línea con categoría se rechaza («no hay regla»); una línea sin categoría cae al tipo que traiga o a 0 % (es cosa de Ventas).
Si falla: si las reglas no se pueden leer, el hub rechaza antes de escribir (error de lectura no disponible; el aviso propio de Ventas solo salta en un runtime antiguo) y Facturación aborta sin gastar número; el cajero no cobra con un tipo supuesto. Servicios no comprueba la categoría al guardar.
Implicados: INVENTORY-F01, INVENTORY-F02, INVOICE-F01, INVOICE-F03, SALES-F01, SALES-F07, SERVICES-F01, SERVICES-F06, REC_FISCAL-F01, REC_FISCAL-F02, HUB-F11
QA: L-01, L-08

## Cobertura contra la referencia

| Elemento de la referencia | Estado | Flujo |
|---|---|---|
| Categoría fiscal por producto/servicio (no un % suelto) | hecho | F01, F02, F19 |
| Tipos general, reducido, superreducido y exento de España de fábrica | hecho | F16 |
| Tipos de otros países (Portugal ofrecido en Ajustes) | no hecho: ninguno de fábrica | F04 |
| Tipo por país y región; la región gana al país | hecho | F04, F11 |
| IGIC e IPSI como familias de impuesto | hecho (sin tipos de fábrica); la región no se fija en pantalla | F11 |
| Calificación: sujeta, exenta, no sujeta, inversión del sujeto pasivo | hecho | F05 |
| Varios impuestos sobre la misma base (recargo de equivalencia) | parcial: no mira al cliente | F06 |
| Precio con impuesto incluido o añadido | hecho en el cálculo; el ajuste vive en Ventas | F18 |
| Redondeo a mitad hacia arriba, dinero en céntimos enteros | hecho | F18 |
| Cierre del tique por tipo, no línea a línea | hecho, en Ventas | F18 |
| Vigencias por fecha y cambio de tipo programado | hecho | F07 |
| Una sola regla vigente por hueco | hecho (las anteriores se marcan) | F04, F10 |
| Editar una regla | no hecho a propósito: se pone fecha de fin y se crea otra | F07 |
| Archivar una categoría o un alias | no hecho | F02, F14 |
| Una venta ya hecha no cambia al cambiar el tipo | hecho en Ventas (copia en la línea); Facturación relee el tipo al emitir | F07 |
| Reglas por cliente o posición fiscal | no hecho (fuera del MVP) | — |
| Alias para importar | parcial | F14, F15 |

## Qué comparten los verticales

Todo el módulo es `comun`: no hay ningún flujo propio de restaurante ni de peluquería.

| Pieza compartida | Flujos que la usan |
|---|---|
| Catálogo de fábrica de España (categorías `restaurant.*` para la restauración, `service.*` y `product.*` para la peluquería y el comercio) | TAXES-F16, TAXES-F01, TAXES-F04 |
| Resolución regla-por-categoría (la región gana al país, vigencia por fecha) | TAXES-F04, TAXES-F06, TAXES-F07, TAXES-F11, TAXES-F18, TAXES-F19 |
| Guarda de solapes (una regla activa vigente por categoría, país y región) | TAXES-F04, TAXES-F07, TAXES-F08, TAXES-F10, TAXES-F12 |
| Calificación fiscal de la regla raíz | TAXES-F05, TAXES-F09, TAXES-F18, TAXES-F19 |
| Categorías y alias que también crea Inventario | TAXES-F02, TAXES-F14, TAXES-F15 |

## Datos: de quién es cada dato

- **Propios**: categorías fiscales, reglas (con sus componentes), alias, la tabla de nombres traducidos
  de las categorías de fábrica (igual en todos los negocios; no la edita nadie) y una tabla interna de la
  guarda de solapes que nunca guarda filas.
- **Lee de otro**: el país y la región del negocio, de Ajustes del hub (el runtime los inyecta al calcular;
  la consulta de primeros pasos lee el país directamente de los ajustes); el idioma, de la preferencia
  personal y de los ajustes del negocio. La zona horaria no se usa aquí.
- **Lo leen otros** por sus consultas públicas: Ventas y Facturación leen las reglas; Inventario y la
  pantalla de Departamentos de Ventas, además, para enseñar el %; Inventario, Servicios y Ventas, las
  categorías; Inventario, además, los alias. Ninguno toca las tablas.
- **Datos personales** (inventario RGPD): ninguna tabla guarda datos de clientes. Solo hay quién creó y
  cambió cada fila (el identificador del usuario) en categorías, reglas y alias; las filas sembradas o
  rellenadas por actualización llevan `system` o el usuario que instaló. Los avisos de los comandos
  (`taxes.*.created`, etc.) llevan los datos del comando y quién lo lanzó. No hay notas ni motivos libres.

## Reglas que no se rompen

- **Aislamiento**: toda lectura y escritura lleva el negocio; una regla o un componente de otro negocio
  nunca casa al crear, reactivar, acabar o reparar. (El lote del asistente no comprueba la raíz de un
  componente: TAXES-F12.)
- **Una regla que no cobra impuesto no lleva tipo**: exenta, no sujeta o con inversión del sujeto
  pasivo y tipo mayor que 0 se rechaza al crear (por pantalla, asistente y lote); lo mismo un componente
  con tipo bajo una raíz así, salvo un componente creado por lote. Las ya guardadas se marcan y se
  reparan (TAXES-F09).
- **Una sola regla activa vigente por categoría, país y región**: se rechaza al crear, reactivar, acabar
  y en el lote, también si dos personas guardan a la vez (el servidor las pone en cola).
- **El tipo está entre 0 y 100**, el país es de la lista ISO y la clave de categoría sigue su patrón;
  los comprueba el servidor al crear por pantalla o asistente.
- **Sin regla no hay tipo inventado**: sin regla aplicable el cálculo falla; el 0 % solo si el que
  llama lo pide.
- **Dinero**: céntimos enteros, redondeo a mitad hacia arriba sobre decimales exactos; el % se guarda como
  número decimal y se convierte antes de multiplicar; con el impuesto incluido, la cuota es la diferencia y lo cobrado no se mueve.
- **La región gana al país y nunca se usa la de otra región**: una región distinta de la del negocio
  no sirve de segunda opción.
- **No se borra nada**: no hay acción de borrar reglas, categorías ni alias; una regla se desactiva y
  las ventas y facturas ya hechas conservan su copia.
- **Permisos**: ver y calcular (empleado, cajero, responsable, administrador); crear, desactivar,
  reactivar, poner fecha de fin y reparar son de quien tiene gestionar impuestos (responsable,
  administrador). El servidor lo aplica aunque la pantalla enseñe el botón.
- **Fiscal**: este módulo no emite ni transmite nada; los códigos de régimen y exención viajan sin
  interpretarse. Ningún tipo de IGIC, IPSI o de otro país se siembra: un número inventado se declararía.

## Lo que NO hace, a propósito

- No fija el precio ni decide si va con el impuesto incluido: ese ajuste es de Ventas («Precios con IVA
  incluido por defecto»).
- No cierra el tique ni agrupa por tipo para la factura o el registro de la AEAT: eso es de Ventas y
  Facturación.
- No guarda el país ni la región del negocio.
- No edita una regla: el tipo se cambia con fecha de fin y una regla nueva.
- No borra reglas ni categorías.
- No traduce los códigos de exención ni de régimen ni habla con la AEAT.
- No siembra tipos de IGIC, IPSI, recargo de equivalencia ni de otros países.
- No tiene pestaña de Ajustes ni de Plan.

## Dudas abiertas

Se resuelven con `market-decision`; no las decide el worker.

1. ¿Una categoría ya creada y un alias deben poder renombrarse o archivarse desde la pantalla?
2. ¿El recargo de equivalencia debe depender del cliente? La norma lo repercute el proveedor al
   comerciante minorista (arts. 148 a 163 de la Ley 37/1992, sin contrastar aquí) y el motor lo suma a
   toda venta de la categoría.
3. ¿Debe haber un campo de región (Canarias, Ceuta, Melilla) en Ajustes del hub, y debe fijarse al dar
   de alta el negocio?
4. ¿Debe un negocio de Portugal traer sus tipos de fábrica, ya que Ajustes ofrece el país?
5. `restaurant.alcohol` se siembra al 21 %; la hostelería tributa al 10 % (art. 91.Uno.2). Mantener el
   21 % es una decisión de QA (`qa-hub §4`), sin contrastar con la asesoría: ¿se mantiene?
6. ¿Una categoría sin regla regional en un negocio con región debe avisar en vez de caer en silencio
   al IVA nacional?
7. ¿La lista de primeros pasos debe exigir una regla por cada categoría usada, y no solo una?
8. ¿Debe el alta de reglas por lote aplicar las mismas comprobaciones que la alta normal (componente y
   fechas)?

## Fuentes contrastadas

Contra `origin/main` v2.3.34 (05/10/2026). Una línea por discrepancia; manda el código.

- **`docs/overview.md`**: «6 canonical categories» y «14 shipped aliases»; el seed trae 10 categorías y 16 alias (F16).
- **`docs/overview.md` y el documento técnico** dicen que el tique y las facturas usan el contrato de cálculo; Ventas y Facturación resuelven con el mismo código compartido contra las reglas, sin llamar a ese comando (F18, F19).
- **`docs/limits.md`**: «no puedes desinstalar Taxes mientras inventory, services o sales»; también Facturación depende de él.
- **`docs/screens.md`** manda a «Settings → Taxes → Tax Rules» y «Settings → Business» para la región; las reglas están en **Impuestos → Reglas** y Ajustes no tiene campo de región (F11).
- **`docs/screens.md`** y el documento técnico llaman «Válida desde» y «Reglas fiscales» a lo que la pantalla española llama «Vigente desde» y «Reglas».
- **Manual (`hand-book`)**: «Completa en Ajustes del Hub > Negocio el país y, si corresponde, la región fiscal»: solo el país (F11). «El TPV no debe completar la venta con un tipo supuesto»: cierto para líneas con categoría; una línea sin categoría cae al tipo que traiga o a 0 % (F19).
- **`docs/concepts.md`**: «los alias se casan en minúsculas y sin espacios»: lo hace el importador, no la pantalla de Alias (F14). «Las categorías de sistema no se pueden borrar»: no hay borrado para ninguna, y la alta acepta marcar una categoría como de sistema (solo la usa quien llame sin pantalla) (F02).
- **`docs/concepts.md` y el manual**: «el lote omite las filas inválidas»: no todas; una categoría inexistente o un solape lo hacen fallar entero (F12). «Los componentes no se crean en lote»: el código no lo impide (F12).
- **QA `qa-hub §4`** y `qa-hub-beauty`: «`taxes` siembra IVA21/10/4/0»: no hay un tipo general al 0 %; hay 21, 10, 4 y dos categorías exentas al 0 % (F16). `qa-hub-beauty` pide `tax_rate_id` en el producto: ya no existe, es `tax_category_key` (ADR-0085).
- **Textos**: `taxType_sales_tax` sale como «Sales tax» en la pantalla española; el aviso de ayuda de Reglas dice «Etiqueta del componente» y el campo se llama «Etiqueta componente»; `locales/es.json` trae una clave `description` que `en.json` no tiene.
- **Formularios de Categorías y Alias**: sus `ion-input` e `ion-select` llevan `fill="outline"` sin `mode="md"` (el de Reglas sí), lo que la convención del repo (hub#760) no admite.
- **`docs/concepts.md`, `docs/limits.md` y el documento técnico** dicen que cada línea congela su impuesto al emitir el documento: la línea de venta guarda categoría, tipo, país, región y regla; la calificación y el tipo de la factura los resuelve Facturación al emitir contra las reglas vigentes ese día, y una diferencia de cuota con la venta rechaza la factura (F07, F19).
- **`docs/screens.md`** dice que quitar la región «no rompe» las reglas de IVA y que siguen sin casar con un negocio con región: sí casan, como reserva, para toda categoría sin regla regional (F11).
- **Pestañas**: ninguna de las tres declara permiso de navegación, así que se ven siempre; sin consulta falla la tabla, no se oculta la pestaña (F01).
- **Lote del asistente**: el esquema cierra país, calificación y tipo antes de ejecutar el código, por lo que una fila con formato inválido tumba el lote entero; las comprobaciones fila a fila del código solo alcanzan la calificación que no cobra impuesto con tipo mayor que 0 (F12).
- **`docs/overview.md`**: el cálculo lo usan «el TPV y las facturas»; solo el asistente lo llama, y su fecha por defecto es la UTC (F18).
- **Oleada 2 (Inventario, 05/10/2026)**: TAXES-F19 decía que Inventario comprueba que la categoría fiscal existe antes de guardar un producto; el bloque `validates` de su `module.json` lo declara, pero el hub lo tiene retirado (`manifest.rs`, `RETIRED_FIELDS`, hub#610) y no se ejecuta (F19). TAXES-F15 decía que, si no carga la lista de categorías, la importación de Inventario falla; el fallo se captura y la importación sigue (F15).
