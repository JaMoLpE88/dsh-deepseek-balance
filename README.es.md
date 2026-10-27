# dsh-deepseek-balance

[![npm](https://img.shields.io/npm/v/@jamolpe88/dsh-deepseek-balance?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/@jamolpe88/dsh-deepseek-balance)
[![GitHub release](https://img.shields.io/github/v/release/JaMoLpE88/dsh-deepseek-balance?style=flat-square&logo=github&label=release)](https://github.com/JaMoLpE88/dsh-deepseek-balance/releases)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4B8BBE?style=flat-square)](#compatibilidad)
[![platform](https://img.shields.io/badge/platform-Windows%2011-0078D6?style=flat-square)](#compatibilidad)
[![dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/jamolpe88/dsh-deepseek-balance)

**Saldo de DeepSeek Platform en el compositor de DeepSeek Harness.** Cada divisa con saldo de la cuenta vive en una píldora compacta entre el control de permisos y el selector de modelo; al pulsarla se abre un panel con el saldo recargado, el regalado y el total por divisa, el total combinado y los enlaces oficiales de uso y recarga.

Sin configuración. El plugin usa la credencial `DEEPSEEK_API_KEY` que DSH ya tiene guardada — o la cuenta de DeepSeek con sesión iniciada si no hay clave. Sin cookies, sin scraping y sin página de ajustes.

**English** → [README.md](README.md)

**Página del proyecto** → [jmolo.es/proyectos/dsh-deepseek-balance](https://jmolo.es/proyectos/dsh-deepseek-balance/)

![Panel de detalles del saldo de DeepSeek sobre el compositor de DeepSeek Harness](assets/balance-panel.png)

*El panel: un bloque por divisa con su saldo recargado, regalado y total, el total combinado, la última actualización, la cadencia de refresco, el origen de los datos y los enlaces oficiales de uso y recarga. El fondo del chat está desenfocado por privacidad.*

![Píldora del saldo de DeepSeek en el compositor de DeepSeek Harness](assets/balance-pill.png)

*La píldora compacta: la marca de DeepSeek y el saldo de cada divisa con saldo, separadas por `·`. Se coloca entre el control de permisos y el selector de modelo y solo se ve con un modelo de DeepSeek.*

## Qué hace

- Muestra el saldo de cada divisa de la cuenta en una píldora compacta: `[logo] $8.23 🎁 ¥120.00`.
- Marca la parte regalada con un icono de regalo; la recargada va sin icono. Una divisa sin saldo no se muestra.
- Abre un panel al pulsar: **recargado**, **regalado** y **total** por divisa — con los ceros incluidos, porque el detalle es justo lo que aporta el panel.
- Añade el total combinado en el mismo panel: `$8.23 + ¥120.00`, porque las divisas no se suman entre sí. Sin nada disponible pone **Sin saldo** en rojo, y también se pone en rojo cuando la API avisa de que el saldo ya no cubre las llamadas.
- Enlaza directamente a las páginas oficiales de Platform: **Uso** y **Recargar**.
- Refresca el saldo cada 60 segundos y cuando la ventana vuelve a estar visible.
- Aparece solo mientras el modelo activo pertenece a un provider de DeepSeek (`deepseek-official` o `deepseek-account`). Con otros providers no muestra nada.
- Aparece en una sesión nueva y vacía antes del primer prompt, siguiendo el provider que muestra el selector de modelo del compositor.

## Qué no hace

- No lee cookies de Platform ni scrapea la página de uso.
- No pide una clave ni guarda ninguna en el plugin.
- No muestra cuenta atrás de caducidad: ningún endpoint accesible de DeepSeek expone la fecha de vencimiento del saldo regalado.
- No guarda historial de saldo, gráficas, telemetría ni almacenamiento local.
- No añade herramientas, comandos ni cambios al agente.
- No muestra nada si el modelo activo no es de DeepSeek.

## Por qué no hay ajustes

Si hay un modelo de DeepSeek seleccionado, el provider está configurado y su credencial ya está disponible para DSH. El plugin resuelve esa credencial en el Host y lee la API oficial del saldo. Sin clave usa la cuenta de DeepSeek con sesión iniciada. Si no hay ningún modelo de DeepSeek seleccionado, no hay nada útil que mostrar y no pinta nada.

No hay fichero de configuración, ni campo de clave, ni editor de umbrales, ni preferencia de refresco. Es lo que es: el saldo que la cuenta ya conoce.

## Requisitos

- **DSH Desktop** `>= 0.2.1-rc.3`, perfil `desktop` (probado en `0.2.1-rc.3`, Windows 11).
- Un provider **DeepSeek** configurado en **Ajustes → Modelos** (`DEEPSEEK_API_KEY`), o una cuenta de DeepSeek con sesión iniciada en el harness.
- Node 22+ (DSH trae su propio runtime).

Si no existe ninguna de las dos cosas no puedes seleccionar un modelo de DeepSeek, así que el plugin nunca aparece. Es intencionado.

## Instalación

Desde npm:

```bash
dsh plugin --profile desktop add @jamolpe88/dsh-deepseek-balance
```

Desde el repositorio:

```bash
dsh plugin --profile desktop add github:JaMoLpE88/dsh-deepseek-balance
```

Desde un checkout local, mientras desarrollas:

```bash
dsh plugin --profile desktop add C:\ruta\a\dsh-deepseek-balance
```

Recarga la ventana de DSH después de instalar. La píldora aparece en el compositor de cualquier sesión cuyo modelo activo use un provider de DeepSeek.

## Uso

1. Selecciona un modelo del provider **DeepSeek**.
2. La píldora aparece centrada en la fila del compositor, entre el control de permisos y el selector de modelo.
3. Púlsala para abrir el panel de detalles.
4. Usa **Refrescar** para una lectura inmediata; si no, el plugin se actualiza cada 60 segundos y al volver a la ventana.

Haz clic fuera del panel, pulsa **Escape** o vuelve a pulsar la píldora para cerrarlo.

## Cómo funciona

La mitad Host llama al endpoint oficial del saldo con la clave del provider:

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <DEEPSEEK_API_KEY>
```

Responde por divisa:

```json
{
  "is_available": true,
  "balance_infos": [
    { "currency": "USD", "total_balance": "8.23", "granted_balance": "0.00", "topped_up_balance": "8.23" }
  ]
}
```

Sin clave, la mitad Host lee la cuenta con sesión iniciada (`deepseekAccount.getBalance`), que devuelve los monederos recargados y regalados por divisa; el plugin normaliza las dos fuentes a la misma forma, así que la interfaz nunca cambia.

- La clave se resuelve desde el servicio de credenciales de DSH (`DEEPSEEK_API_KEY`) en cada lectura; `DEEPSEEK_API_KEY` del entorno del proceso es el respaldo.
- Los resultados se cachean 55 segundos para que el sondeo de 60 segundos y varias ventanas compartan una sola petición.
- Si falla el origen, se conservan los últimos saldos y se marcan como **obsoletos** en lugar de vaciar la píldora.
- La mitad de navegador lee dos rutas del mismo origen: `/api/deepseek-balance` y `/api/deepseek-balance/refresh`. La clave nunca llega al navegador.
- La visibilidad sigue el provider que muestra el selector de modelo del compositor — la selección pendiente, la usada o el modelo por defecto con el que enviaría una sesión nueva — así que la píldora ya está en una sesión nueva vacía.
- Los importes usan el símbolo propio de la divisa y el mismo formato que la web de DeepSeek Platform: dos decimales redondeados a la baja, **punto decimal y coma para los miles** (`$1,234.56`), sin depender del idioma del navegador.

## Diagnóstico

Con DSH en marcha, en la misma URL que la interfaz (el puerto cambia en cada arranque):

```bash
curl http://127.0.0.1:59863/api/deepseek-balance
```

Devuelve los saldos, su origen, un código de error y la marca de frescura — nunca la clave:

```json
{
  "updatedAt": 1793091987909,
  "source": "api-key",
  "currencies": [
    { "currency": "USD", "toppedUp": "8.22", "granted": "0.00", "total": "8.22" }
  ],
  "available": true,
  "error": null,
  "stale": false
}
```

Usa `/api/deepseek-balance/refresh` para saltarte la caché de 55 segundos y forzar una lectura. Cuando `error` no es `null`, `stale` indica si los saldos son los últimos buenos o no hay ninguno.

## Compatibilidad

| | |
|---|---|
| DSH | `>= 0.2.1-rc.3` (la única versión probada por el autor) |
| Node | `>= 22` |
| SO | Windows 11 (probado); macOS y Linux sin probar |
| Perfil | `desktop` |
| Provider | DeepSeek configurado en **Ajustes → Modelos**, o cuenta de DeepSeek con sesión iniciada |
| Catálogo | [listado en dsh-plugin.org](https://dsh-plugin.org/plugins/jamolpe88/dsh-deepseek-balance) |
| Página del proyecto | [jmolo.es/proyectos/dsh-deepseek-balance](https://jmolo.es/proyectos/dsh-deepseek-balance/) |

Estado de validación: **probado en Windows 11 con DSH Desktop 0.2.1-rc.3** (2026-10-27). La píldora aparece solo con un modelo de DeepSeek, el panel se abre, el desglose por divisa y el total combinado siguen la API real, el filtro por provider la oculta con otros modelos y el refresco manual funciona.

Sin validar: macOS, Linux, otras versiones de DSH y el perfil web.

## Límites

- **Windows 11 es la única plataforma probada.** macOS y Linux no están validados.
- **Solo con DeepSeek.** Sin ese provider no hay datos útiles, así que el plugin no pinta nada.
- **Sin caducidad.** DeepSeek informa del saldo regalado sin fecha; la cuenta atrás se descartó en lugar de inventarla.
- **Dos divisas hoy.** DeepSeek documenta y devuelve `CNY` y `USD`; el plugin pinta cualquier código que reciba, con el propio código como símbolo cuando el navegador no lo conoce.
- **Sin historial ni gráficas.** Solo los saldos actuales.
- **Depende del endpoint de DeepSeek.** Si cambia su forma, las entradas no reconocidas se descartan y la píldora informa de un error `parse`.
- **Sin cambios en el agente.** No añade herramientas, comandos ni providers.

## Privacidad

- Sin cookies ni scraping de la sesión del navegador.
- La clave de API nunca sale del proceso Host: el navegador solo recibe importes y códigos de divisa.
- Sin fichero de configuración, sin almacenamiento local, sin telemetría y sin peticiones a terceros más allá del endpoint oficial del saldo y los enlaces de Platform que pulses.
- El Host no registra la clave ni la incluye en los mensajes de error.

## Problemas

**La píldora no aparece.**
Comprueba que el modelo activo pertenece a un provider **DeepSeek**. El plugin no pinta nada para otros providers a propósito.

**La píldora muestra un punto rojo y un error.**
Abre el panel para ver el código y la pista:

| Código | Significado |
|---|---|
| `missing-key` | DSH no tiene `DEEPSEEK_API_KEY` ni hay cuenta de DeepSeek con sesión. Configura el provider en **Ajustes → Modelos**. |
| `signed-out` | La sesión de la cuenta caducó; vuelve a iniciarla o añade una clave de API. |
| `invalid-key` | La clave del provider fue rechazada (401). Revísala o cámbiala en **Ajustes → Modelos**. |
| `forbidden` | La clave no puede leer el saldo (403). |
| `account` | No se pudo leer la cuenta con sesión iniciada. |
| `rate-limited` | La API del saldo está limitando peticiones; prueba en un momento. |
| `timeout` / `network` | El Host no pudo llegar a `api.deepseek.com`; reintenta con **Refrescar**. |
| `parse` | La respuesta no contenía saldos reconocibles. |

El plugin no tiene ajustes propios: los problemas del provider se arreglan en los ajustes de modelos de DSH.

## Desarrollo

```bash
npm test        # node --test
npm run check   # comprobación de sintaxis del Host y del Cliente
```

Los tests cubren el parser de la API, el parser de monederos de la cuenta, la suma de importes, el mapeo de errores HTTP, la caché, el camino sin clave, el camino sin sesión y el respaldo de datos obsoletos. La mitad de cliente es un bundle `client.js` plano (sin build) y se verifica en el Harness en marcha.

Instalación local:

```bash
dsh plugin --profile desktop add C:\ruta\a\dsh-deepseek-balance
```

## Marcas de terceros

DeepSeek y el logo de DeepSeek son marcas de DeepSeek. El logo se usa solo para identificar el servicio DeepSeek Platform; no está cubierto por la licencia MIT que se aplica al código fuente. Ver [NOTICE](NOTICE).

## Licencia

[MIT](LICENSE) © 2026 JaMoLpE88
