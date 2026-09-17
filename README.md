# Tairos.rc v2 — React + Supabase

Migración del prototipo de un solo archivo `legacy/tairos_dashboard_redesign.html`
a una aplicación React con TypeScript, Vite, Tailwind y Supabase.

## Puesta en marcha

```bash
npm install
npm run dev          # http://localhost:5173
```

La app **arranca sin configurar nada**: si no encuentra credenciales de Supabase
usa un adaptador de `localStorage` con los datos de demostración. El estado
actual (Supabase / local) se ve en la esquina inferior de la barra lateral.

## Estado: conectado a Supabase ✅

El proyecto ya está enlazado con una base real y **las cuatro migraciones están
aplicadas**. Lo que hay creado:

| | |
| --- | --- |
| Tablas | `transactions`, `work_orders`, `work_order_items`, `proformas`, `debts`, `debt_payments`, `cash_closings` |
| Vista | `debts_with_balance` |
| Funciones | `register_work_order`, `update_work_order`, `update_proforma`, `annul_proforma`, `update_debt`, `delete_debt_payment` |
| Secuencias | `voucher_seq` (OP-000001), `proforma_seq` (PF-1001) |

La base quedó **vacía a propósito**: se probó el circuito completo (pedido con
adelanto → asiento + deuda) y se borraron los datos de prueba. Si quieres
cargar los datos de demostración, ejecuta `supabase/seed.sql`.

### Migraciones

```bash
npm run db:status     # qué está aplicado y qué falta
npm run db:migrate    # aplicar lo pendiente
npm run db:baseline   # adoptar una base que ya tiene el esquema
```

`scripts/migrate.mjs` lleva un registro en la tabla `schema_migrations`: aplica
solo lo que falta, cada archivo dentro de una transacción, y **avisa si alguien
edita una migración ya aplicada** (la forma clásica de que dos entornos acaben
con esquemas distintos sin que nadie se entere).

`db:baseline` existe porque reaplicar migraciones sobre un esquema que ya las
tiene no es inocuo: `0001` recrea una vista que `0002` amplía, y Postgres lo
rechaza con `cannot drop columns from view`. Al adoptar una base existente hay
que registrar, no ejecutar.

### Dónde viven las credenciales

Separadas por destino, no por archivo:

| Dato | Dónde | Por qué |
| --- | --- | --- |
| URL + clave publicable | `.env.local` | Van al navegador a propósito |
| Contraseña de la base | `~/.pgpass` (fuera del repo, 600) | `psql` la lee sola; no está en el proyecto, así que no se puede commitear |
| Conexión de migración | `.env.db` (ignorado), **sin** contraseña | La URL del proyecto ya es pública: está en el bundle |
| Clave secreta | Gestor de contraseñas | La app nunca la necesita |

> **`.env.local` no es un archivo de secretos.** Cualquier variable con prefijo
> `VITE_` que el código referencie queda literalmente escrita en el JavaScript
> público. Comprobado: basta una referencia viva para que el valor aparezca
> íntegro en `dist/assets/index-*.js`.

### Para clonar el proyecto en otra máquina

1. Copia `.env.example` a `.env.local` y rellena `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY` (la clave **publicable**, no la secreta) desde
   **Supabase → Settings → API**.
2. `npm install && npm run dev`.

Sin esas variables la app arranca igual, en **modo local** sobre `localStorage`,
que es cómodo para desarrollo. En un build de producción aparece un aviso en
ámbar advirtiéndolo, porque desplegar así significa que cada visitante tiene su
propia copia privada.

> **Vite incrusta las variables al compilar.** En el panel del host hay que
> ponerlas **antes** del build; cambiarlas después no afecta a un sitio ya
> publicado — hay que recompilar y volver a desplegar.

---

## 🔴 Antes de publicar en una URL pública

**Las políticas RLS están abiertas a la clave publicable**, y esa clave viaja
dentro del JavaScript. Hoy eso significa que cualquiera que abra la página puede
extraerla y **leer, modificar y borrar toda la contabilidad** desde fuera de la
app.

Mientras siga así, este proyecto es apto para uso local o en una red privada,
**no para una dirección pública**. Lo que falta es activar Supabase Auth y
sustituir las siete políticas `using (true)` por políticas por usuario; el bloque
comentado al final de `supabase/migrations/0001_init.sql` tiene la versión lista.

## Scripts

| Comando             | Qué hace                                             |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo con recarga en caliente        |
| `npm run build`     | Chequeo de tipos + bundle de producción en `dist/`    |
| `npm run preview`   | Sirve el bundle de producción                         |
| `npm run typecheck` | Solo TypeScript                                       |
| `npm run smoke`     | Pruebas de la lógica de negocio (255 comprobaciones)   |

## Estructura

```
src/
├── types/            Modelo de dominio (Transaction, Proforma, Debt, …)
├── lib/
│   ├── supabase.ts   Cliente y detección de configuración
│   ├── ledgerRows.ts Une asientos y pedidos al crédito en una sola lista
│   ├── debtAlerts.ts Resumen de quién debe y a quién debes, con urgencias
│   │                 y los mensajes que cuenta el robot
│   ├── format.ts     Moneda, fechas y parseo de montos escritos a mano
│   ├── excel.ts      Estilos, márgenes y descarga de .xlsx
│   ├── reports.ts    Las hojas de cada informe
│   ├── clipboard.ts  Copiado con fallback
│   ├── voice.ts      Web Speech API (síntesis y reconocimiento)
│   └── voiceParser.ts Interpreta el dictado y arma el asiento
├── data/
│   ├── adapter.ts        Contrato único de acceso a datos
│   ├── supabaseAdapter.ts Implementación Supabase (snake_case ↔ camelCase)
│   ├── localAdapter.ts   Implementación localStorage
│   ├── seed.ts           Datos de demostración
│   └── index.ts          Elige el adaptador según el entorno
├── store/DataProvider.tsx  Estado global + estadísticas derivadas
├── hooks/            useToast, useSpeaker, useRecognizer
├── components/
│   ├── ui/           Modal accesible, StatCard, Badge, MicButton
│   ├── receipt/      Comprobante imprimible, compartido por libro y ficha
│   ├── assistant/    El robotcito de deudas y su globo de diálogo
│   ├── layout/       Sidebar, Topbar, DashboardLayout (con menú móvil)
│   └── gateway/      Pantalla de bienvenida y cerebro animado
└── features/
    ├── registro/     Libro contable diario + modal de nueva orden
    ├── movimientos/  Historial auditado + ficha de detalle
    ├── proformas/    Cotizaciones y conversión en venta
    ├── deudas/       Cuentas por cobrar/pagar con abonos parciales
    └── arqueo/       Cuadre de caja y resumen ejecutivo
```

### Pedidos, adelantos y saldos

Un **pedido** (`work_orders`) es lo que el cliente encarga. Puede tener varios
trabajos, cada uno con su monto (`work_order_items`), y un adelanto. De un
pedido nacen hasta dos registros:

| Situación                        | Asiento en el libro | Cuenta en Deudas   |
| -------------------------------- | ------------------- | ------------------ |
| Paga todo (S/390 de S/390)       | Ingreso S/390       | —                  |
| Adelanta una parte (S/200)       | Ingreso S/200       | Por cobrar S/190   |
| Se lo lleva al crédito (S/0)     | —                   | Por cobrar S/390   |

`transactions.amount` sigue significando **dinero que se movió de verdad**, que
es lo que alimenta el balance y el arqueo. El total del trabajo vive en el
pedido, no en el asiento. Por eso, con adelanto 0 no se crea ningún asiento: no
entró plata.

Todo esto ocurre dentro de la función `register_work_order`, una sola
transacción de Postgres: si algo falla a mitad, no queda un pedido a medias.
En Egresos la lógica es la misma en espejo — el saldo va a **por pagar**.

### Cómo se accede a los datos

La UI solo conoce `db` (de `src/data`). `db` es el adaptador de Supabase o el de
`localStorage`, según haya credenciales. Cambiar de backend no toca ni un
componente.

## Qué cambió respecto al prototipo HTML

**Corregido**

- **Persistencia real.** Antes todo vivía en variables JS y se perdía al recargar.
- **XSS.** Las tablas se construían con `innerHTML` e interpolaban texto del
  usuario sin escapar. React escapa por defecto.
- **IDs colisionables.** `Date.now()` y `Math.random()` podían repetirse. Ahora
  hay secuencias en Postgres (`OP-000001`, `PF-1001`) y contadores equivalentes
  en el adaptador local.
- **Abonos parciales.** El botón "Abonar" ejecutaba `Math.min(saldo, saldo)`, es
  decir liquidaba siempre el 100%. Ahora hay tabla `debt_payments`, historial de
  abonos y validación contra el saldo.
- **Navegación móvil.** El botón hamburguesa no tenía `onclick` y la barra
  lateral era `hidden md:flex`: en el móvil no había forma de cambiar de pestaña.
- **Clases de Tailwind v4 sobre el CDN v3** (`shadow-2xs`, `backdrop-blur-xs`) y
  el color `brand-300`, que se usaba 11 veces sin estar definido en la paleta.
- **Filtros de estado inertes.** "Pendientes" y "Anulados" nunca podían coincidir
  porque ningún flujo creaba esos estados. Ahora se puede anular un asiento.
- **Búsqueda global** que reescribía el input en minúsculas mientras tecleabas.
- **Atajo ⌘K** dibujado pero nunca implementado.
- **Fecha del encabezado** y del reporte, que estaban escritas a mano.
- **Exportación**: el CSV del prototipo iba sin BOM (acentos rotos en Excel),
  sin escapar comillas, sin `revokeObjectURL` y era vulnerable a inyección de
  fórmulas. Ahora se exporta a **.xlsx** con formato, y ninguno de esos
  problemas aplica.
- **Micrófono** que solo sabía arrancar; volver a pulsarlo lanzaba
  `InvalidStateError` dentro de un `catch` vacío.
- **`document.execCommand('copy')`** obsoleto → `navigator.clipboard` con fallback.
- **Borrado sin confirmación** en el libro contable.
- **Accesibilidad**: los modales ahora tienen `role="dialog"`, cierre con Escape
  y clic en el fondo, trampa de foco y devolución del foco al cerrar.
- **Arqueo sin fondo de apertura**, que hacía imposible cuadrar una caja real.
  También se puede contar por denominación, y el cierre queda guardado en
  `cash_closings` en vez de solo mostrar un toast.

**Cambio de criterio**

- **Se quitó la llamada a Gemini.** El prototipo llamaba a la API con
  `apiKey = ""`, así que cada frase lanzaba un fetch condenado a fallar antes de
  caer en la voz del navegador, y una clave en el cliente sería visible para
  cualquiera. Ahora se usa Web Speech API directamente y la base de conocimiento
  del asistente vive en `src/components/gateway/knowledge.ts`. Si más adelante
  quieres voces neuronales, crea una Edge Function que guarde la clave del lado
  servidor y reemplaza `speak()` en `src/lib/voice.ts`.

## Formulario «Nuevo Orden»

Vive en un modal, no al lado de la tabla: el libro ocupa todo el ancho y el
botón **+ Nueva orden** de la cabecera abre el formulario encima. Al guardar se
cierra y la fila aparece detrás, sin cambiar de pantalla. Es el mismo patrón que
ya usaban Proformas («Nueva proforma») y Deudas («Nueva cuenta»).

Orden de los campos:

1. **Cliente / Proveedor** (la etiqueta cambia según sea Ingreso o Egreso)
2. **Teléfono** — opcional. Aparece en el detalle con enlace para llamar y para
   escribir por WhatsApp, que es como se persigue un saldo pendiente
3. **Concepto / trabajos** — una o varias líneas, cada una con su monto; el
   total se calcula solo
4. **Adelanto** — casilla opcional; si se marca, aparece el monto y el aviso de
   cuánto quedará pendiente. El botón «Sin adelanto» pone 0 (venta al crédito)
5. Categoría y método de pago

El campo **voucher se eliminó**: el correlativo (`OP-000001`) lo asigna Postgres.

### La tabla «Asientos del día»

Es una lista unificada de todo lo que se registró hoy: los asientos reales y
además los pedidos al crédito, que no generaron asiento porque no se movió
dinero. La columna **Estado** dice en qué situación está el cobro:

| Estado      | Cuándo                                  | ¿Suma a caja?    |
| ----------- | --------------------------------------- | ---------------- |
| `PAGADO`    | El cliente pagó todo                    | Sí               |
| `PARCIAL`   | Pagó un adelanto y queda saldo          | Solo el adelanto |
| `PENDIENTE` | No pagó nada: se entregó al crédito     | **No**           |
| `ANULADO`   | Asiento anulado                         | No               |

**El estado es automático.** Se deriva del dinero registrado y no se puede
cambiar a mano: no hay desplegable ni botón de «marcar pagado». Así el estado
nunca puede contradecir a la caja ni al saldo que muestra Deudas.

#### Cuando un cliente pendiente ya pagó

Toda fila con saldo vivo — `PENDIENTE` o `PARCIAL` — lleva su botón **Cobrar**
(o *Pagar*, en egresos) en la columna Acciones. Abre el modal de abono, donde
el atajo **«Ya pagó todo · S/ 25.00»** rellena el saldo completo de un clic; si
solo trajo una parte, escribes el monto.

Al guardar, el dinero entra a caja y el estado se actualiza solo:

```
S/ 40.00 · cobrado + S/15.00   🟡 PARCIAL  falta S/25.00   [Cobrar]
                    │
                    ▼  se registra el cobro de S/25.00
S/ 40.00 · cobrado + S/40.00   🟢 PAGADO
```

El abono queda además como su propio asiento (+S/25.00), porque es dinero que
entró ese día. Un pedido que estaba `PENDIENTE` y se cobra entero retira su fila
del libro: su importe ya está representado por el asiento del cobro.

`PENDIENTE` y `PARCIAL` son las mismas palabras que usa la pestaña Deudas, para
no tener que traducir entre las dos pantallas.

**La columna Monto muestra el monto general del trabajo**, no lo que se cobró.
Cuando las dos cifras difieren, debajo aparece cuánto entró de verdad:

```
CONCEPTO              MONTO              ESTADO
Adelanto de: 1 mll    S/ 40.00           🟡 PARCIAL
                      cobrado + S/15.00     falta S/ 25.00
```

Las tres cifras siempre cuadran: cobrado + falta = monto general. El signo
`+`/`−` aparece únicamente cuando el importe entero se movió; en un adelanto o
una venta al crédito, ponerlo sería mentir sobre la caja.

Las filas sin cobrar van en rojo claro, sin signo, y quedan fuera de Ingresos,
Egresos y del arqueo. Traen su propio botón de **Cobrar / Pagar**, que abre el
mismo modal de abono que la pestaña Deudas.

Como la columna Monto ya no es dinero real, el pie de la tabla cierra con lo que
sí lo es: **Entró a caja · Salió · Pendiente**. Eso es lo que debe cuadrar con
las tarjetas de Ingresos y Egresos y con el arqueo.

Cuando un pedido al crédito termina de cobrarse, su fila desaparece: a partir de
ahí el dinero ya está representado por los asientos de abono, y dejarla visible
haría parecer que el importe entró dos veces.

`buildLedgerRows` en [`src/features/registro/ledgerRows.ts`](src/features/registro/ledgerRows.ts)
arma esta lista y es función pura, así que está cubierta por `npm run smoke`.

### Ver detalle, corregir y descargar

El **detalle vive en una sola pantalla**: la ficha de Movimientos. El libro no
lo duplica; sus filas llevan las acciones de trabajo:

| Acción | Dónde | Qué hace |
| ------ | ----- | -------- |
| 💰 **Cobrar** | Libro | Registra el cobro del saldo pendiente |
| ✏️ **Editar** | Libro | Corrige la orden: cliente, teléfono, trabajos, montos, categoría y método |
| ⊘ 🗑 **Anular / eliminar** | Libro | Sobre el asiento |
| 👁 **Ver detalle** | Movimientos | Ficha completa: desglose, teléfono con llamada y WhatsApp, cobrado y saldo |
| 🖨 **Comprobante** | Movimientos | Desde la ficha: imprime en papel o guarda como PDF |

El libro se queda con las acciones de trabajo; consultar e imprimir viven en
Movimientos. Ojo con un límite: **Movimientos solo lista asientos**, así que una
orden entregada al crédito no aparece ahí — su desglose se ve al editarla.

**La edición recalcula todo.** Al guardar, el asiento del adelanto se reajusta y
el saldo de la deuda se recalcula solo. Cubre también los cambios de situación:

| Corrección | Qué pasa |
| ---------- | -------- |
| El adelanto pasa de 0 a un monto | Nace el asiento que no existía |
| El adelanto pasa a 0 | Se borra el asiento: ese dinero nunca se movió |
| El total pasa a igualar el adelanto | Se borra la cuenta pendiente |
| El total sube | El saldo pendiente sube con él |

Lo único que se rechaza es **dejar el total por debajo de lo ya cobrado**, porque
eso dejaría un saldo negativo y la caja sin cuadrar. En ese caso el mensaje pide
anular el asiento y volver a registrarlo. El tipo (Ingreso/Egreso) tampoco se
puede cambiar al corregir. Toda orden corregida queda marcada con la fecha en su
ficha.

La comprobación vive en `update_work_order` (Postgres) y en `updateWorkOrder`
(adaptador local), y ambas hacen el trabajo en **una sola transacción**: un
rechazo no deja nada a medias.

#### El comprobante

El botón *Comprobante* de la ficha de Movimientos abre el diálogo del navegador, desde donde imprimes en
papel o guardas como PDF. No hay ninguna librería de PDF en el proyecto: el
comprobante se monta en `#print-root` y una regla `@media print` esconde el
resto del documento. Sale con los trabajos, el adelanto y el saldo pendiente.

## Corregir proformas y cuentas

Mismo criterio que en el libro: se corrige lo que no ha movido dinero, y lo que
sí lo movió se protege.

### Proformas

| Estado | Acciones |
| ------ | -------- |
| `Vigente` | 🛒 Cobrar · ✏️ Editar (cliente, detalle, monto, vigencia) · ⊘ Anular |
| `Convertida` | Ninguna: ya generó un asiento, se corrige en el libro |
| `Anulada` | Ninguna |

**Anular** es nuevo. El estado `Anulada` existía en la base pero nada lo usaba,
así que una cotización que el cliente rechazaba se quedaba como vigente para
siempre inflando el total cotizado.

### Deudas / Cobros

Hay dos tipos de cuenta que se ven iguales en la tabla pero no lo son:

- **Creadas a mano** — se editan con ✏️: cliente, concepto, monto y vencimiento.
  El saldo se recalcula solo. No se admite dejar el total por debajo de lo ya
  abonado.
- **Nacidas de una orden** — su total lo calcula el pedido (`total − adelanto`).
  En vez del lápiz llevan un icono de enlace 🔗 que explica que se corrigen
  desde el libro, donde cuadran. La base también lo rechaza, no solo la interfaz.

### Deshacer un abono

En el modal de abono, cada abono del historial trae su papelera. Borrarlo
**retira también el asiento que generó**, en la misma transacción: si solo se
fuera uno de los dos, la caja quedaría descuadrada. Es la corrección más
probable en el día a día — teclear 200 donde iban 20.

## Avisos de deudas y cobros

Dos piezas que no se estorban:

**El robot**, abajo a la derecha. Dibujado en SVG dentro del proyecto
([`RobotAvatar`](src/components/assistant/RobotAvatar.tsx)), así que se ve
nítido a cualquier tamaño, usa los colores de marca, parpadea solo y mueve la
boca mientras habla.

Aparece al entrar y **cuenta sus avisos uno tras otro**, escribiéndolos letra a
letra como si hablara. Al terminar se desvanece y desaparece. **No tiene ningún
control**: ni voz, ni botones, ni enlaces. Es un recordatorio que pasa y se va.

Cuenta como mucho **cuatro avisos** —el resumen y las tres cuentas más
urgentes—, para no quedarse hablando un minuto entero cuando hay doce deudas.
El límite es `MAX_AVISOS` en [`DebtBot`](src/components/assistant/DebtBot.tsx).

Si el sistema pide menos animación (`prefers-reduced-motion`), cada mensaje
aparece entero en vez de escribirse.

**La campana**, en la cabecera, es donde queda el detalle una vez que el robot
se ha ido: *Te deben* y *Tú debes* con nombre, importe y antigüedad, la
posición neta, y el botón de escuchar.

Se llegó aquí descartando dos intentos: la campana abriéndose sola al entrar
tapaba el libro con siete cuentas, y una cinta en movimiento continuo no se
podía leer cómodo ni pulsar.

### Qué cuenta el robot

`buildBotMessages` arma la lista: primero el saludo (*«Te deben S/1,090 de 6
clientes. Tú debes S/320 a proveedores. Lo más urgente: Constructora del
Centro, S/400, hace 7 días.»*) y después una cuenta por globo, de la más urgente
a la menos.

### Los colores del globo

Cada mensaje va **troceado por tipo de dato** (`BotChunk`) para poder pintar
cada parte de un color y que se lea de un vistazo sin tener que leer la frase
entera:

| Trozo | Color | Ejemplo |
| ----- | ----- | ------- |
| `nombre` | Negro, negrita | **Constructora del Centro** |
| `cobro` | Verde | **S/ 400.00** que te deben |
| `pago` | Rojo | **S/ 320.00** que debes |
| `tiempo` | Ámbar | *hace 18 días* |
| `texto` | Gris | el resto de la frase |

El globo lleva además un **marco degradado en movimiento lento**, con la paleta
cambiando según la urgencia: cian → turquesa → lima en el saludo, rojo →
naranja → ámbar si hay algo vencido, ámbar → amarillo → lima si lleva tiempo.

El campo `text` guarda el mensaje en plano, que es lo que se lee en voz alta y
lo que comprueban las pruebas.

### Cómo decide qué es urgente

`dueDate` es opcional, y las cuentas que nacen de una orden nunca lo traen. Si
el aviso dependiera solo de vencimientos, casi ninguna cuenta llegaría a
marcarse. Por eso hay dos señales:

| Señal | Cuándo | Marca |
| ----- | ------ | ----- |
| **Vencida** | Tiene fecha de vencimiento y ya pasó | 🔴 |
| **Antigua** | Lleva 15 días o más registrada | 🟡 |
| Reciente | Nada de lo anterior | ⚪ |

El orden es: primero lo vencido (por días de atraso), luego lo más viejo, y a
igualdad el importe mayor.

### El asistente

El cerebro de la bienvenida sigue igual, con una diferencia: cuando le
preguntas por deudas o cobros responde con **tus cifras reales** en vez de la
explicación del módulo. Entiende las formas naturales de preguntarlo —«quién me
debe», «cuánto debo yo», «mis morosos», «saldos por cobrar»— y lo dice en voz
alta con nombres e importes. Para cualquier otro tema responde como siempre.

La lógica vive en [`src/lib/debtAlerts.ts`](src/lib/debtAlerts.ts) y es pura, así
que está cubierta por `npm run smoke`.

## Exportar a Excel

Todo lo que se descarga sale en **.xlsx real** — no un CSV renombrado. Hay tres
botones:

| Dónde | Qué baja |
| ----- | -------- |
| **Cabecera**, junto a la campana 📗 | El informe general: todo el negocio en 8 hojas |
| Movimientos → **Excel** | Los movimientos con los filtros que tengas puestos |
| Proformas → **Excel** | Las cotizaciones |

El informe general vive en la barra superior porque es global: se descarga
desde cualquier pestaña sin tener que ir a Arqueo primero. El icono muestra un
girador mientras se genera.

El informe general trae: **Resumen** (portada con los totales), **Movimientos**,
**Órdenes**, **Trabajos** (una fila por trabajo), **Proformas**, **Deudas**,
**Abonos** y **Arqueos**.

### El formato

Cada hoja sale lista para imprimir o pasar a PDF sin tocar nada:

- **Márgenes** ajustados: 0.45" laterales en las hojas de datos (apaisadas),
  0.7" en el resumen (vertical)
- **A4 con ajuste al ancho** de página, para que no se parta una tabla en dos
- **Cabecera repetida en cada página** al imprimir (`printTitlesRow`)
- **Panel congelado** bajo la cabecera, para que no se pierda al desplazarse
- **Autofiltro** en las columnas
- **Pie de página** con «Página N de M» y la fecha
- Anchos de columna por contenido, filas cebra y bordes finos
- Los importes son **números con formato de soles**, no texto: se pueden sumar
  en Excel. Las fechas son fechas de verdad, no cadenas.

### Sobre el peso

ExcelJS ocupa unos 270 kB comprimidos, así que se carga con `import()` dinámico
y Vite lo deja en su propio trozo: **no entra en el arranque de la app**, solo se
descarga la primera vez que pulsas exportar. El bundle principal solo creció
10 kB.

Un efecto secundario de pasar de CSV a xlsx: en un CSV, una celda que empieza
por `=` la ejecuta Excel como fórmula, y había que neutralizarla. En xlsx un
texto es texto —una fórmula necesita marcarse aparte— así que ese riesgo
desaparece. Hay una prueba que lo comprueba.

## Paginación de las tablas

Las cuatro tablas —Asientos del día, Movimientos, Proformas y Deudas— muestran
**25 filas por página**, con los controles bajo la tabla. Se ocultan solos
cuando todo cabe en una página.

Lo importante: **los datos se cargan enteros y los filtros actúan sobre todo el
historial**, no sobre la página visible. Por eso siguen siendo exactos:

- las tarjetas de Ingresos, Egresos y Balance
- el pie de «Asientos del día» (Entró a caja · Salió · Pendiente)
- los totales de Movimientos filtrados
- **lo que se exporta a Excel**: baja todo lo filtrado, no las 25 de la página

Al cambiar un filtro o la búsqueda se vuelve a la página 1, y si la lista encoge
(cobras una cuenta y desaparece su fila) no te quedas en una página vacía.

### Arqueo: desde el último cierre

El efectivo esperado cuenta **solo los movimientos posteriores al último cierre
de caja**, no todo el historial. Antes sumaba al fondo de apertura los
movimientos de días ya cerrados, que ya estaban dentro de ese fondo, e inventaba
un faltante que crecía cada día:

| Día | Apertura | Movimientos | Mostraba | Real |
| --- | --- | --- | --- | --- |
| 1 | S/100 | +240 −210 | S/130 ✅ | S/130 |
| 2 | S/130 | +30 (de ayer) +50 | S/210 ❌ | S/180 |

La lógica vive en [`src/lib/cashArqueo.ts`](src/lib/cashArqueo.ts), es pura y
está cubierta por las pruebas. El fondo de apertura se precarga con el efectivo
contado en el último cierre, que es con lo que abre el turno siguiente: dejarlo
en blanco reintroducía el mismo error por otra puerta.

### El fallo que apareció al revisar esto

Las consultas eran `.select('*')` sin `range()`, y **Supabase corta en 1000
filas por defecto** (`max_rows`). A partir de mil movimientos, los listados
habrían devuelto datos incompletos **en silencio**, y como `computeStats`
calcula los totales sobre esos arrays, el balance y el arqueo habrían empezado a
mentir sin que nada lo indicara. Para ~20 movimientos al día eso son unos dos
meses.

Ahora todos los listados se piden **por tramos de 1000 hasta agotar la tabla**
(`traerTodo` en `supabaseAdapter`), con un freno a las 200 000 filas que lanza
un error explícito en vez de devolver datos a medias.

De paso desapareció el `.limit(30)` que tenía la bitácora de arqueos, que
recortaba la lista sin decirlo.

## Tema claro y oscuro

El selector está en la cabecera, junto a la campana, con tres opciones:

| Opción | Qué hace |
| ------ | -------- |
| **Claro** | Fuerza el tema claro |
| **Oscuro** | Fuerza el tema oscuro |
| **Como el sistema** | Sigue la preferencia del navegador y **reacciona si cambia sola** (por ejemplo al anochecer) |

La elección se guarda en `localStorage` **por dispositivo**, no en la base: es
una preferencia de esta pantalla, no del negocio. Si el navegador bloquea el
almacenamiento, el tema sigue funcionando y solo dura lo que la pestaña.

### Cómo está hecho

Tailwind en modo `darkMode: 'class'`: [`useTheme`](src/hooks/useTheme.tsx) pone
o quita la clase `dark` en `<html>`. Además fija `color-scheme`, que es lo que
hace que los **controles nativos** —desplegables, calendarios, barras de
desplazamiento— también se oscurezcan; sin eso quedan blancos sobre fondo negro.

Las 477 variantes `dark:` de la interfaz se aplicaron con un mapeo sistemático
(superficie, texto, borde y cada color de estado), no a mano, para que no
quedaran huecos. Tres archivos se dejaron fuera a propósito:

- **`OrderReceipt`** — se imprime en papel blanco. Hay además una regla
  `@media print` que fuerza el tema claro al imprimir, para que un comprobante
  no salga con fondo negro.
- **`WelcomeGateway`** — ya era oscura por diseño.
- **`RobotAvatar`** — es un SVG con sus propios colores, y funciona en ambos.

## Configuración

Pestaña propia bajo el grupo **Sistema** en la barra lateral. Seis secciones,
cada una marcada con lo que de verdad hace:

| Sección | Estado |
| ------- | ------ |
| **Apariencia** — tema claro/oscuro/sistema | ✅ Funciona |
| **Datos y respaldo** — modo actual, nº de registros, informe Excel, restablecer demo | ✅ Funciona |
| **Usuarios y accesos** — personas y roles previstos | ⏳ Necesita el login |
| **Datos del negocio** — nombre, RUC, dirección | ⏳ Próximamente |
| **Comprobantes y tributación** — series, correlativo, IGV | ⏳ Próximamente |
| **Caja y contabilidad** — valores por defecto | ⏳ Próximamente |

Las secciones pendientes se muestran **atenuadas y sin poder pulsarse**, con una
insignia que lo dice. Se prefirió esto a poner controles que no hacen nada: una
pantalla de ajustes llena de botones muertos confunde más de lo que ayuda.

La sección de usuarios lleva además un aviso explícito de que **hoy el sistema
no pide contraseña** y cualquiera que abra la dirección entra con todos los
permisos — el mismo riesgo que aparece en la auditoría, dicho donde toca.

## Preparado para desplegar

Una auditoría de despliegue encontró varios problemas; esto es lo que se hizo.

### Resiliencia
- **`ErrorBoundary`** montado por fuera de todos los proveedores, así que caza
  también los fallos de los propios proveedores. Antes, cualquier excepción de
  renderizado dejaba la página en blanco sin mensaje. Ahora hay pantalla de
  recuperación, botón de recargar y el detalle técnico en un desplegable.
  Se reaplica el tema oscuro por su cuenta, porque si el fallo ocurre en el
  primer render el proveedor de tema nunca llegó a montarse.
- **Aviso de datos locales** en builds de producción sin Supabase configurado.
  La condición se resuelve al compilar, así que en desarrollo ni se evalúa y en
  un build conectado desaparece del bundle.

### Sin dependencias de red externas
Font Awesome y las tipografías venían de `cdnjs` y Google Fonts: sin internet la
app se quedaba **sin ningún icono**, y muchos botones son solo icono. Ahora se
empaquetan desde `@fontsource` y `@fortawesome/fontawesome-free`. El build no
contiene ni una referencia a CDN.

Nota de tamaño: `dist/` incluye `.ttf` y `.woff` además de `.woff2`. Son
respaldos que **ningún navegador actual llega a pedir** —woff2 va primero en cada
`@font-face`— así que ocupan en el host pero no consumen ancho de banda del
usuario. Se dejan a propósito: podarlos exigiría reescribir los `@font-face` a
mano y arriesgar la carga de fuentes a cambio de nada visible.

### Sin destello de tema
El tema se aplicaba en un efecto de React, o sea después del primer pintado: en
modo oscuro había un fogonazo blanco en cada carga. Ahora un script síncrono en
el `<head>` se adelanta. La clave y la regla viven en
[`src/lib/tema.ts`](src/lib/tema.ts), del que tiran el hook y el `ErrorBoundary`;
el script inline la repite porque corre antes que los módulos, y lo dice en un
comentario.

### Configuración de hosts
- `base: './'` en Vite: el mismo `dist` sirve en dominio raíz y en subruta sin
  recompilar. Es seguro **porque no hay enrutador de cliente**; si algún día
  entra uno con rutas anidadas, hay que pasar a base absoluta.
- `vercel.json` y `netlify.toml`: build `npm run build` → `dist`, Node 20,
  `/assets/*` cacheado un año (llevan hash) e `index.html` sin cachear.
- **Sin reescritura SPA, a propósito**: no hay rutas profundas que rescatar, y un
  catch-all convertiría los 404 honestos en páginas fantasma con código 200.
- `engines: node >=18` en `package.json`.
- CI en `.github/workflows/ci.yml`: tipos, pruebas y build en cada push y PR.

## Pendiente / siguientes pasos

- Autenticación con Supabase Auth y RLS por usuario (el SQL ya lo contempla).
- IGV y numeración correlativa de comprobantes electrónicos.
- Cierre por período (mensual) y reportes históricos.
- Realtime de Supabase para que dos cajeros vean los mismos datos al instante.
- Filtro por periodo. Hoy todo se carga entero, lo que mantiene los totales
  exactos pero no escala más allá de unas decenas de miles de filas; a partir de
  ahí conviene acotar por fechas y calcular los totales con consultas de
  agregación en Postgres.
