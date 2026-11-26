# Pequeño Capricho · Juguetería

App de ventas, caja y stock para el local **Pequeño Capricho** (Alta Gracia, Córdoba).
Se instala en el celular y en la compu (PWA), tiene login y guarda todo en la nube (Supabase).

Pensada para usarse fácil: botones grandes, palabras simples, "Vender" es lo primero que se ve.

## Qué hace

| Pantalla | Para qué |
|---|---|
| **Vender** | Precio, producto del stock (opcional), cantidad, rubro y cómo pagó. Con débito o crédito: posnet (Mercado Pago o Getnet) y recargo %. Calcula el total a cobrar y guarda el recargo aparte. Descuenta el stock y avisa si quedan 2 o menos. |
| **Hoy** | Total del día por medio de pago (tarjetas separadas por posnet), recargos cobrados, comisiones, neto a acreditar, ganancia, y la lista de ventas con "Anular". Con ‹ › se ven otros días. |
| **Caja** | Apertura con el efectivo inicial, cierre con efectivo esperado, contado y diferencia ("Faltan $500"). Se puede reabrir. |
| **Stock** | Productos con foto, cantidad, costo, precio de venta y ganancia. Buscador, filtro por rubro y "Poco stock". |
| **Más › Tickets** | Foto del ticket del posnet, guardada en la nube y enviada por email (al momento o en un resumen a la noche). Opcional: revisión con IA del monto y el posnet. |
| **Más › Historial** | Cierres y totales por día, semana y mes. |
| **Más › Ajustes** | Comisiones de cada posnet, correo para tickets, aviso de stock bajo, rubros y copia de seguridad. |

Si se corta internet, la venta se guarda en el aparato y se sube sola cuando vuelve la conexión.

Mantiene las costumbres del prototipo: la venta arranca en Efectivo, recuerda el último posnet y recargo usados, y en Stock hay botones − / + para cada producto.

---

## 1. Probarla ya (modo de prueba, sin nube)

Si `js/config.js` está vacío, la app arranca en **modo de prueba**: los datos quedan solo en ese navegador y trae productos de ejemplo.

```bash
npm start            # o: python3 -m http.server 5173
# abrir http://localhost:5173
```

Se entra con cualquier correo y clave. Si el correo empieza con `ayudante` se prueba el rol de ayudante (solo ve Stock).

## 2. Ponerla en marcha con la nube (Supabase)

### 2.1 Crear el proyecto
1. Crear una cuenta en <https://supabase.com> y un proyecto nuevo (región **South America (São Paulo)**). El plan gratis alcanza.
2. En **SQL Editor › New query**, pegar todo `supabase/migrations/001_esquema.sql` y tocar **Run**.

### 2.2 Usuarios y clave corta
1. **Authentication › Sign In / Providers**: dejar *Email* activado, **desactivar "Allow new users to sign up"** (así nadie más se puede registrar) y desactivar *Confirm email*.
2. **Authentication › Users › Add user › Create new user**: el correo de la dueña y una clave de **6 números** (Supabase pide 6 como mínimo).
3. Darle el rol de dueña (en **SQL Editor**):

   ```sql
   update perfiles set rol = 'duena', nombre = 'Nombre de la dueña'
   where id = (select id from auth.users where email = 'correo@de-la-duena.com');
   ```

   Roles: `duena` (vende, caja, stock, ajustes), `ayudante` (stock/catálogo; más adelante pedidos online), `admin` (todo). Los usuarios nuevos quedan como `ayudante` hasta que se les cambie.

La sesión queda abierta en el aparato: la clave se pide solo la primera vez (o si se toca "Cerrar sesión").

### 2.3 Conectar la app
En **Project Settings › API** copiar la *Project URL* y la *anon public key* a `js/config.js`:

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

La anon key es pública por diseño; lo que protege los datos son los permisos de la base (RLS), que ya vienen en el SQL.

### 2.4 Publicarla (GitHub Pages)
1. En GitHub: **Settings › Pages › Source: GitHub Actions**.
2. Cada vez que se sube un cambio a `main`, `.github/workflows/publicar.yml` corre las pruebas y publica la app en `https://USUARIO.github.io/peque-o-capricho/`.

### 2.5 Instalarla
- **Android (Chrome):** abrir el link › menú ⋮ › **Agregar a la pantalla principal** / **Instalar app**.
- **iPhone (Safari):** botón Compartir › **Agregar a inicio**.
- **Compu (Chrome/Edge):** ícono de instalar en la barra de direcciones.

Queda con el ícono del logo y se abre como una app.

### 2.6 Pasar los datos del prototipo
La app vieja (el prototipo de un solo archivo) guarda los datos solo en el aparato donde se usó. Para traerlos:

1. En la app vieja: **Stock › Copiar copia de seguridad**.
2. En la app nueva: **Más › Ajustes › Traer datos de la app vieja**, pegar y tocar **Traer datos**.

Se traen los productos (nombre, cantidad, costo y precio) y todas las ventas, con su recargo y posnet. Las ventas viejas **no** descuentan stock. Se puede repetir sin miedo: las ventas no se duplican y el stock queda como en la app vieja. Las cajas del prototipo no se pueden traer, porque su copia no las incluye.

## 3. Fotos de tickets por email

Se usa [Resend](https://resend.com) para mandar los emails (gratis hasta 3.000 por mes).

1. Crear un Gmail nuevo para el local (ej. `pequenocapricho.tickets@gmail.com`).
2. Crear la cuenta de Resend **con ese mismo Gmail** y sacar una API key. Sin dominio propio, Resend solo deja mandar al correo de la cuenta, que es justo lo que se necesita. Si más adelante hay dominio propio, se verifica en Resend y se configura `EMAIL_REMITENTE`.
3. Instalar la [CLI de Supabase](https://supabase.com/docs/guides/cli) y, desde esta carpeta:

   ```bash
   supabase login
   supabase link --project-ref TU-PROYECTO
   supabase secrets set RESEND_API_KEY=re_xxx CRON_SECRET=una-clave-larga-inventada
   supabase functions deploy enviar-ticket
   supabase functions deploy leer-ticket
   supabase functions deploy cierre-diario --no-verify-jwt
   ```

4. En **SQL Editor** correr `supabase/cron.sql` (antes, reemplazar `TU-PROYECTO` y `TU-CLAVE-SECRETA`). Programa el cierre de cada noche a las **23:30**: manda el resumen del día con las fotos que no se enviaron y guarda la copia de seguridad.
5. En la app: **Más › Ajustes**, cargar el correo del local y elegir "Al momento" o "Un resumen a la noche".

## 4. Revisar tickets con IA (opcional)

El botón **🤖 Revisar con IA** (en Tickets) lee la foto con Claude y compara monto y posnet con la venta vinculada.

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
```

La clave se saca en <https://console.anthropic.com>. Cada lectura cuesta alrededor de un centavo de dólar. Si no se configura, el resto de la app funciona igual.

## 5. Copias de seguridad

- Todo vive en la base de datos de Supabase.
- Cada noche `cierre-diario` guarda una copia completa en **Storage › respaldos › AAAA-MM-DD.json**.
- En **Más › Ajustes › Bajar copia** se puede bajar una copia al aparato cuando se quiera.
- Ojo: en el plan gratis, Supabase pausa los proyectos que pasan una semana sin uso. Con uso diario no pasa; si se pausa, se reactiva desde el panel.

## 6. Comisiones

En **Más › Ajustes** se carga el porcentaje total (con IVA) que cobra cada posnet: Mercado Pago débito/crédito, Getnet débito/crédito y QR. Con eso "Hoy" muestra lo neto a acreditar. Los valores del modo de prueba son solo ejemplos: hay que poner los del contrato de cada posnet.

## 7. Pensado para vender online más adelante

La base ya está preparada:

- **Usuarios con permisos distintos** (`perfiles.rol`): la dueña vende y maneja la caja; una ayudante puede manejar el catálogo sin ver la plata.
- **Stock compartido**: un solo stock, y cada cambio queda registrado en `movimientos_stock` (venta, anulación, reposición, ajuste). Una venta online descuenta del mismo stock.
- `ventas.canal` (`local` / `online`), y `productos.publicar_online` + `descripcion` para armar un catálogo.
- Las fotos de productos están en un depósito público, listas para usar en un catálogo.

Para arrancar, lo más simple es Tienda Nube o el catálogo de WhatsApp Business, cargando los productos con `publicar_online = true`. Después se puede sincronizar el stock con su API.

## 8. Para el desarrollador

```
index.html, manifest.webmanifest, sw.js   PWA (sin paso de compilación)
css/app.css                               estilos, colores de marca, modo claro/oscuro
js/app.js                                 login, menú y cambio de pantallas
js/calculos.js                            cuentas (recargo, comisiones, caja, historial) - con pruebas
js/importar.js                            convierte la copia del prototipo - con pruebas
js/estado.js                              datos compartidos y ventas sin internet
js/api/supabase.js | demo.js              conexión a la nube | modo de prueba
js/views/*.js                             una pantalla por archivo
supabase/migrations/001_esquema.sql       tablas, permisos (RLS) y funciones
supabase/functions/*                      email de tickets, cierre diario, lectura con IA
tests/                                    npm test
icons/                                    logo e íconos de la app
```

- `npm test` corre las pruebas de los cálculos.
- Las cuentas importantes (recargo, comisión, descuento de stock, cierre de caja) las hace la base de datos en `registrar_venta`, `anular_venta` y `cerrar_caja`; `js/calculos.js` repite las mismas cuentas para mostrarlas en pantalla.
- **Al cambiar archivos de la app, subir `VERSION` en `sw.js`** para que los celulares bajen la versión nueva (les aparece "Hay una versión nueva · Actualizar").
- Para reemplazar el logo: cambiar los PNG de `icons/` (mismo nombre y tamaño).
