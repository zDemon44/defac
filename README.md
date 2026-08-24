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

Este proyecto no automatiza el portal del SRI, CAPTCHA ni autenticación interactiva.
