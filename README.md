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
