# Cliente SOAP mínimo del SRI

Primera implementación local para consultar **una sola clave de acceso** mediante el servicio oficial `AutorizacionComprobantesOffline` del SRI.

## Requisitos

- Windows
- Node.js 20 o superior
- Una clave de acceso legítima de 49 dígitos

## Instalación

En PowerShell, dentro de esta carpeta:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Abra `.env` y coloque la clave:

```dotenv
SRI_ENVIRONMENT=production
SRI_ACCESS_KEY=SU_CLAVE_DE_49_DIGITOS
```

Use `production` para una factura real. `test` consulta únicamente el ambiente de certificación.

## Verificar el servicio sin consultar una clave

```powershell
npm.cmd run check:wsdl
```

## Consultar una clave

```powershell
npm.cmd run consultar
```

Los resultados se guardan en `output/`:

- `CLAVE.soap.xml`: respuesta SOAP completa para diagnóstico.
- `CLAVE.xml`: XML firmado contenido en la autorización.

La carpeta `output/` y el archivo `.env` están excluidos de Git.

## Comprobación de TypeScript

```powershell
npm.cmd run check
```

## Probar el TXT y XML de ejemplo

```powershell
npm.cmd run probar:archivos
npm.cmd test
```

El importador detecta archivos tabulados del SRI, valida cada clave y el parser acepta tanto una respuesta `<autorizacion>` como un XML cuyo nodo raíz sea `<factura>`.

## Procesar el lote por SOAP

Configure `SRI_INPUT_FILE`, `SRI_CONCURRENCY` y `SRI_MAX_RETRIES` en `.env`. Luego ejecute:

```powershell
npm.cmd run procesar:lote
```

Los XML se guardan en `output/xml`, las respuestas de diagnóstico en `output/soap` y el resultado completo en un archivo `output/lote-*.json`. Los XML existentes se validan y no se vuelven a descargar.

## Interfaz web local

```powershell
npm.cmd run web
```

Abra `http://localhost:3000`. La interfaz permite importar el TXT, consultar el lote y cargar varios XML manuales. Cada XML se valida y se asocia por su clave interna; no se confía en el nombre del archivo.

Después de procesar al menos un XML, el botón **Generar Excel** descarga `compras-AAAA-MM.xlsx` con una sola hoja `Facturas`. La columna `DETALLE` muestra el primer producto o servicio de cada comprobante.

## Base de datos MySQL

1. Abra MySQL Workbench y conéctese a su servidor local.
2. Abra y ejecute completamente `database/defac-base.sql`.
3. Configure `DB_USER` y `DB_PASSWORD` en `.env`.
4. Verifique la conexión:

```powershell
npm.cmd run check:db
```

La base se llama `defac-base`. El script crea empresas, lotes de compras/ventas, facturas, impuestos, detalles, formas de pago y trazabilidad del procesamiento.

Este proyecto no automatiza el portal del SRI, CAPTCHA ni autenticación interactiva.

# DEFAC v3: retenciones de ventas

Antes de usar **Ventas → Retenciones**, ejecute `retenciones-nueva-tablas.sql` en MySQL Workbench. El importador consulta las claves del TXT mediante el SOAP del SRI y solo guarda comprobantes autorizados cuyo `codDocSustento` sea `01` y cuyo `numDocSustento` identifique una factura. Admite una o varias líneas de retención de renta e IVA y evita duplicados por empresa y clave de acceso.

## Registro, inicio de sesión y permisos

Prepare las tablas una vez, después de crear la base principal:

```powershell
npm.cmd run auth:migrate
npm.cmd run web
```

También puede ejecutar `database/auth-nuevas-tablas.sql` sobre `defac-base` desde Workbench. Es una migración aditiva: no borra ni asigna empresas o facturas existentes.

Abra `http://localhost:3000/register` para crear su cuenta (nombre, correo y contraseña de 12–128 caracteres). No use la contraseña del SRI. Después puede entrar por `/login` y cerrar sesión desde la cabecera. El correo es un identificador; esta fase no incluye verificación de correo, recuperación de contraseña ni MFA.

Cada cuenta comienza sin empresas. Las empresas que cree quedan vinculadas a ella. No existe un administrador automático basado en “el primero que se registra”. Para conceder acceso a una empresa anterior, un operador con acceso local al servidor debe ejecutar, indicando explícitamente correo e ID:

```powershell
npm.cmd run auth:grant -- tu-correo@ejemplo.com 1
```

Ese comando comparte acceso completo a la empresa indicada, no copia sus datos. No lo ejecute para usuarios desconocidos ni para todas las empresas por defecto. No hay endpoint público para conceder permisos. La empresa activa se guarda por usuario. Listas, importaciones, lotes y reportes exigen una sesión y permiso sobre la empresa.

### Configuración de acceso

- `APP_ORIGIN`: origen exacto usado por el navegador; por defecto `http://localhost:3000`. Cambiarlo si cambia el puerto o dominio. Las peticiones de escritura exigen ese `Origin` y `X-Defac-Request: 1` para proteger contra CSRF. La interfaz los envía automáticamente.
- `AUTH_ALLOW_REGISTRATION=false`: cierra el registro de nuevas cuentas. Por defecto se permite para la demo.
- `APP_TRUST_PROXY=loopback`: usar solo detrás de un proxy HTTPS local de confianza; no se confía por defecto en encabezados de IP enviados por clientes.
- Antes de publicar: `APP_ORIGIN=https://tu-dominio` y `NODE_ENV=production`. La aplicación rechaza arrancar en producción sin un origen HTTPS. Mantenga Node.js y MySQL accesibles solo desde localhost y use un proxy HTTPS.

Contraseñas: scrypt con sal aleatoria (N=131072, r=8, p=1), siguiendo la [guía OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Sesiones: token aleatorio en cookie HttpOnly/SameSite=Strict, Secure al usar HTTPS; solo se almacena su hash en MySQL, con expiración absoluta de 8 horas y revocación al salir. No se guardan contraseñas ni tokens de acceso en localStorage. Los límites de intentos se conservan en MySQL.

Para verificar con MySQL local (crea dos cuentas y una empresa sintéticas, y elimina únicamente esos registros al terminar):

```powershell
$env:AUTH_INTEGRATION='true'
npx.cmd vitest run src/auth/auth.integration.test.ts src/auth/password.test.ts
Remove-Item Env:AUTH_INTEGRATION
```

Esta fase sigue siendo local: no publica datos ni crea recursos en Oracle. Antes de exponer la demo, faltan configurar HTTPS, usar datos ficticios, preparar copias de seguridad, adaptar el generador Excel a Linux y revisar la operación del servidor. El login no sustituye estas tareas.
