# Autenticación (Etapa 3)

Este documento explica cómo se entra al backend, cómo funcionan las sesiones y cómo se controla lo que cada persona puede hacer. Tiene cuatro partes:

- **Ingreso con Google (bloque 2):** `POST /api/auth/google` comprueba el token de Google, encuentra o crea la cuenta y abre una sesión.
- **Sesiones (bloque 1):** abrir, comprobar, renovar y cerrar una sesión. Es la base sobre la que se apoya el ingreso.
- **Quién soy y salir (cierre):** `GET /api/auth/me` y `POST /api/auth/logout`.
- **Permisos y roles (cierre):** `requirePermission` y el comando `npm run user:role`.

## Ingreso con Google

### El recorrido de una petición

1. El frontend manda `{ "credential": "<token de Google>" }` a `POST /api/auth/google`. El cuerpo se valida (texto de 1 a 4096 caracteres); los demás campos que da el botón de Google se ignoran.
2. **Límite:** 10 intentos por minuto y dirección IP, contados aparte de los 30 de las rutas. La petición número 11 recibe 429 con `Retry-After`, sin mirar el token y **sin escribir nada** en `auth_logs`. Se cuenta antes de verificar, para que un ataque no gaste llamadas a Google ni a la base. Funciona con la dirección de `True-Client-IP` (ver el README).
3. **La librería oficial de Google** (`google-auth-library`) comprueba la firma, el emisor, el vencimiento y que el token se emitió para **nuestro** ID de cliente (`GOOGLE_CLIENT_ID`). Descarga las claves públicas de Google, las guarda y sigue su rotación.
4. **Nuestras comprobaciones** (`src/auth/google-identity.ts`), en este orden:
   - el token trae `sub` y correo, y el correo tiene forma de correo y solo caracteres ASCII imprimibles;
   - `email_verified` es verdadero;
   - el token se emitió hace **10 minutos o menos** (Google le da una hora de vida; acortarla reduce lo que serviría uno robado). Se tolera hasta 60 segundos de diferencia entre relojes si el token parece del futuro.
5. **La cuenta**, en una sola transacción (`src/repositories/user.repository.ts`):

   | Situación                                                    | Qué pasa                                                                                                | Eventos en `auth_logs`            |
   | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
   | El `sub` ya está en `oauth_accounts`                         | Entra con esa cuenta                                                                                    | `login`                           |
   | `sub` nuevo y ninguna cuenta tiene ese correo                | Se crea la cuenta, su enlace con Google y el rol `usuario`, todo junto                                  | `register` y `login`              |
   | `sub` nuevo y una cuenta activa tiene ese correo, sin enlace | Se enlaza el `sub` a esa cuenta, porque Google verificó el correo; conserva sus roles                   | `account_linked` y `login`        |
   | La cuenta existe pero está desactivada o borrada             | No entra ni se enlaza; no se cambia nada. Responde 403                                                  | `login_failed` (`user_inactive`)  |
   | La cuenta con ese correo ya está enlazada a **otro** `sub`   | No se enlaza nada. Responde 401. El correo pudo pasar a otra persona (pasa con cuentas de organización) | `login_failed` (`email_conflict`) |

6. **La sesión** la abre el servicio del bloque 1 (`SessionService.open`) y la respuesta lleva el identificador **una sola vez**.

Si dos ingresos de la misma persona nueva llegan a la vez, el segundo choca con una llave única (el correo o el enlace con Google); se captura ese choque (código `P2002` de Prisma) y se repite la transacción una vez, que ya encuentra lo que hizo el primero. Puede pasar también que el otro ingreso termine justo entre la búsqueda por identidad de Google y la búsqueda por correo: entonces la cuenta con ese correo ya trae un enlace, y si es **el mismo** `sub` la persona entra normalmente; solo un enlace con **otro** `sub` es el conflicto de correo (401). Nunca queda una cuenta sin rol ni sin enlace: si falta el rol `usuario` (la migración 08 sin aplicar), todo se deshace.

### Lo que responde

```json
{
  "token": "<43 caracteres, se muestra una sola vez>",
  "expiresAt": "2026-11-17T12:00:00.000Z",
  "user": {
    "id": "…",
    "email": "ana@example.com",
    "fullName": "Ana Pérez",
    "avatarUrl": "https://…",
    "roles": ["usuario"]
  }
}
```

La respuesta lleva `Cache-Control: no-store`. Los roles salen en orden alfabético.

| Estado | Código                      | Cuándo                                                                                                                                                                                    |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`           | Falta `credential` o no es un texto de 1 a 4096 caracteres                                                                                                                                |
| 400    | `INVALID_JSON`              | El cuerpo no es JSON                                                                                                                                                                      |
| 401    | `INVALID_GOOGLE_TOKEN`      | Cualquier problema del token: firma, otra app, vencido, de hace más de 10 minutos, sin `sub` o sin correo, correo sin verificar, o correo de otra identidad. **Siempre el mismo mensaje** |
| 403    | `ACCOUNT_DISABLED`          | Google confirmó a la persona, pero su cuenta está desactivada o borrada. Es distinto del 401 porque quien llega aquí ya demostró quién es                                                 |
| 429    | `TOO_MANY_REQUESTS`         | Más de 10 intentos en un minuto desde la misma dirección                                                                                                                                  |
| 503    | `AUTH_PROVIDER_UNAVAILABLE` | No se pudieron traer las claves de Google. **No es un 401:** "no pude comprobar" no es "el token es malo"                                                                                 |
| 503    | `AUTH_NOT_CONFIGURED`       | Falta `GOOGLE_CLIENT_ID`                                                                                                                                                                  |
| 503    | `DATABASE_UNAVAILABLE`      | La base no responde                                                                                                                                                                       |

El 401 es igual para todos los motivos a propósito: quien prueba tokens robados o inventados no aprende nada de la respuesta. El motivo real solo queda en `auth_logs`.

### Qué se copia de Google a la cuenta

| Dato           | Cuándo                  | Regla                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correo         | Solo al crear la cuenta | Se guarda en minúsculas (la base lo exige). **Nunca se cambia solo**: la identidad de la persona es el `sub`, no el correo. Si Google cambia el correo de un `sub`, la cuenta sigue con el viejo                                                                                                              |
| Nombre         | En cada ingreso         | Se recortan los espacios, se quitan los caracteres de control y los que invierten la dirección del texto, y se corta a 150 caracteres sin partir un emoji. Si Google no manda nombre, al crear la cuenta se usa la parte del correo antes de la `@`, y en ingresos posteriores se conserva el nombre guardado |
| Foto           | En cada ingreso         | Solo una dirección `https://` con host, de 2048 caracteres o menos, sin usuario ni contraseña, sin espacios ni caracteres de control. Si no cumple, o Google no manda foto, queda en `null`. Así `avatar_url` nunca puede traer `javascript:` ni `data:`                                                      |
| Último ingreso | En cada ingreso         | `users.last_login_at`, en la misma transacción que el nombre y la foto                                                                                                                                                                                                                                        |

### Qué se registra en `auth_logs`

| Evento           | Éxito | Cuándo                                                                                                                         |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `register`       | sí    | Se creó la cuenta                                                                                                              |
| `account_linked` | sí    | Se enlazó Google a una cuenta que ya existía                                                                                   |
| `login`          | sí    | Se abrió la sesión                                                                                                             |
| `login_failed`   | no    | Con `reason`: `invalid_token`, `email_unverified`, `token_too_old`, `user_inactive`, `email_conflict` o `provider_unavailable` |

No se registran los 400, los 429, `AUTH_NOT_CONFIGURED` ni la base caída. Ninguna fila guarda el token de Google, el identificador de sesión ni el correo. La dirección IP solo se guarda en los fallos y con su último número cortado. Si el registro no se puede escribir, la persona entra igual.

### Configuración y Google Cloud

- **Backend:** la variable `GOOGLE_CLIENT_ID` (en `.env` y en el panel de Render). Es opcional: sin ella el endpoint responde 503 y el resto de la API funciona.
- **Google Cloud** (proyecto `urban-road-monitor`, con una cuenta dedicada al proyecto): un cliente de tipo aplicación web, `urban-road-monitor-web`, con los orígenes `http://localhost`, `http://localhost:5173` y la URL de producción de Vercel, sin URIs de redirección, y con solo los alcances `openid`, correo y perfil. El secreto del cliente no se usa.
- **Un solo cliente para local y producción:** el backend de producción solo acepta tokens emitidos para su ID de cliente, así que una prueba real hecha desde una página en `localhost` necesita estar en el mismo cliente. Al terminar el proyecto conviene quitar los orígenes de `localhost`.
- **Estado de la app: Prueba.** Mientras esté en Prueba solo pueden entrar las cuentas agregadas como usuarios de prueba en Google Cloud (hasta 100) y la pantalla de Google avisa que la app está en pruebas. Publicarla exige llenar la página principal, la política de privacidad y el dominio autorizado en Información de la marca; queda pendiente hasta que exista la página de privacidad. Sin verificación de marca la pantalla de Google no muestra el nombre ni el logo de la app, solo el dominio.

### Pruebas del ingreso

- `google-token-verifier.test.ts` usa la librería real de Google con tokens firmados por una clave creada en la prueba (`src/test/google-test-keys.ts`): firma, otra app, otro emisor, vencido, firma de otra clave, contenido cambiado y Google caído.
- `google-identity.test.ts` y `profile-rules.test.ts` cubren las reglas puras con sus bordes (10 minutos exactos, 60 segundos, 150 caracteres, 2048 caracteres).
- `user.repository.integration.test.ts`, `auth.integration.test.ts` y `account.integration.test.ts` (todo el recorrido: ingreso, `/me`, un rol dado, y salir) corren contra PostgreSQL real (ver "Pruebas con base de datos" en el README), incluida una colisión provocada a propósito entre dos transacciones.

## Quién soy y salir

### `GET /api/auth/me`

Necesita sesión. Responde 200 con `{ "user": { id, email, fullName, avatarUrl, roles, permissions } }`: lo mismo que el ingreso más los **permisos** que dan sus roles (códigos como `detections.create`, en orden alfabético; quien solo tiene `usuario` no tiene ninguno). Los roles y los permisos se leen en cada petición, sin guardarlos en la sesión, así que un rol dado o quitado se nota en la siguiente petición. Lleva `Cache-Control: no-store`.

- **401** (siempre el mismo cuerpo): sin sesión, o sesión desconocida, vencida, cerrada o de una cuenta desactivada.
- **503** `DATABASE_UNAVAILABLE`: la base no responde. Nunca es un 401.

### `POST /api/auth/logout`

Necesita sesión y no lleva cuerpo. Cierra **solo la sesión que hace la petición** (la misma persona en otro aparato sigue dentro), escribe `logout` en `auth_logs` (sin dirección IP) y responde **204**. Si la sesión ya estaba cerrada, responde el 401 de siempre. Si no se puede escribir el registro, la sesión queda cerrada igual.

## Permisos y roles

| Rol             | Permisos                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| `usuario`       | ninguno: es la base, la tiene toda cuenta                                              |
| `colaborador`   | `detections.create`, `potholes.report_repair`, `routes.view_history`, `trips.view_own` |
| `administrador` | los nueve, incluido `users.manage`                                                     |

### `requirePermission('codigo')`

Es el middleware para las rutas que exigen un permiso (el primer uso real llega en la Etapa 4; hoy solo lo ejercitan rutas de prueba):

| Situación                         | Respuesta                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Sin sesión válida                 | **401**, el mismo de `requireSession`                                                      |
| Sesión válida pero sin el permiso | **403** `FORBIDDEN` ("You do not have permission to do this"), sin escribir en `auth_logs` |
| Sesión válida con el permiso      | la ruta sigue, y la persona está en `getAuth(res)`                                         |
| La base no responde               | **503** `DATABASE_UNAVAILABLE`                                                             |

Comprueba el permiso con **una sola consulta** y en cada petición. Un código mal escrito (`detections.creat`) hace fallar el arranque del servidor en vez de negar a todos sin avisar: el formato se revisa al crear la ruta.

### Cambiar roles: `npm run user:role`

No hay pantalla ni endpoint para esto a propósito: dar un rol cambia lo que una persona puede hacer, así que se hace a mano, con cuidado, desde un computador con acceso a la base.

```
npm run user:role -- add correo@gmail.com colaborador
npm run user:role -- remove correo@gmail.com colaborador
```

- Usa la `DATABASE_URL` del archivo `.env`, como los demás comandos. **Antes de cambiar nada muestra a qué servidor y base apunta**, la cuenta, y los roles de hoy y de después, y pide escribir `SI`. Cualquier otra respuesta cancela.
- La cuenta debe existir: la persona tiene que haber ingresado una vez con Google. Una cuenta desactivada no recibe roles.
- El rol `usuario` no se quita. Para impedir que alguien entre, se desactiva su cuenta.
- **No se puede quitar el último administrador activo**, tampoco si dos personas lo intentan a la vez (el segundo intento se rechaza). El primer administrador se da a mano con este mismo comando, ya que la persona ingresó con Google.
- Cada cambio queda en `auth_logs` como `role_changed`, con `reason` `added_<rol>` o `removed_<rol>`.
- Si no hay nada que cambiar (ya tiene el rol, o no lo tiene), lo dice y no pregunta nada.

## Sesiones

## El identificador de sesión

- Es una cadena aleatoria de 32 bytes (256 bits) escrita en base64url: siempre 43 caracteres.
- Se entrega **una sola vez**, cuando la sesión se abre. El frontend lo guarda y lo manda en cada petición protegida: `Authorization: Bearer <identificador>`.
- La base **nunca guarda el identificador**: guarda su SHA-256 en hexadecimal (64 caracteres) en `sessions.token_hash`. Quien lea la base no puede usarlo.
- Un texto que no tiene ese formato se rechaza sin preguntarle nada a la base.

## Cuánto dura

| Regla                                             | Valor                        | Dónde se cambia              |
| ------------------------------------------------- | ---------------------------- | ---------------------------- |
| Duración desde la apertura o la última renovación | 7 días                       | `src/auth/session-config.ts` |
| Tope desde que se abrió, se use o no              | 30 días                      | `src/auth/session-config.ts` |
| Renovación                                        | como máximo una vez por hora | `src/auth/session-config.ts` |
| Sesiones abiertas por persona                     | 5                            | `src/auth/session-config.ts` |

La tabla `sessions` no tiene una columna de "último uso". La renovación se deduce de `expires_at`: una sesión renovada hace menos de una hora vence en más de 7 días menos 1 hora, y entonces no se escribe nada.

## Abrir una sesión

`SessionRepository.open` trabaja en una sola transacción:

1. Bloquea la fila de la persona (`FOR UPDATE`), para que dos ingresos suyos se ejecuten uno tras otro.
2. Borra **sus** sesiones ya vencidas o revocadas. Nunca toca las de otras personas.
3. Si todavía tiene 5 abiertas, revoca la que vence primero (la menos usada, porque cada uso empuja el vencimiento hacia adelante).
4. Inserta la nueva.

Cerrar sesión marca `revoked_at` y no borra la fila: la sesión deja de servir en el mismo instante y la fila se borra en el siguiente ingreso de esa persona.

## Comprobar una sesión

`requireSession` (en `src/middlewares/`) protege una ruta. Una sola consulta (`findByTokenHash`) busca la sesión por su huella y une su usuario, así que desactivar a alguien surte efecto en la siguiente petición, sin importar cómo se haya desactivado.

| Situación                                                                                    | Respuesta                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Sin encabezado, formato incorrecto, sesión desconocida, vencida, revocada o persona inactiva | **401**, siempre con el mismo cuerpo y los mismos encabezados |
| La base no responde                                                                          | **503** `DATABASE_UNAVAILABLE`                                |

La diferencia entre 401 y 503 importa: el frontend solo cierra la sesión local con un 401. Con un 503 conserva el identificador y reintenta.

Las rutas públicas (el mapa y las rutas) no usan este middleware y **nunca leen** el encabezado `Authorization`, así que una sesión rota no las afecta.

Dentro de una ruta protegida, la persona se lee con `getAuth(res)`:

```ts
router.get('/me', requireSession(), (req, res) => {
  const { userId, email, fullName } = getAuth(res);
  res.json({ userId, email, fullName });
});
```

## Qué se registra

El motivo real de un rechazo solo queda en `auth_logs` (columna `reason`), nunca en la respuesta:

- Se registra el rechazo de una sesión que **existe** (`expired`, `revoked` o `user_inactive`). Un identificador que nadie tiene no se registra.
- `auth_logs` y `sessions` guardan el `user_agent` cortado a 255 caracteres.
- La IP solo se guarda en los fallos y con su último número cortado (`203.0.113.0`). `sessions.ip_address` no se usa.
- Ninguna tabla guarda tokens ni el correo de quien falló. `reason` es un código corto en minúsculas y no acepta texto libre.

## Pruebas

Las pruebas con SQL real corren contra un PostgreSQL local aparte, solo si existe `TEST_DATABASE_URL`. Ver "Pruebas con base de datos" en el README. Sin esa variable se omiten y `npm test` sigue pasando. Los archivos de prueba corren uno tras otro (`fileParallelism: false`), porque comparten la base y la vacían antes de cada prueba.

## Pendientes conocidos

- **Un token de Google robado sirve hasta 10 minutos.** No hay `nonce`: protegería de un token interceptado, pero exigiría un endpoint nuevo, estado en el servidor (que en Render gratuito se pierde al dormirse) y trabajo extra del frontend. Quien pudiera leer el token desde la página también podría leer la sesión en `localStorage`.
- **Si Google cambia el correo de una cuenta, la nuestra conserva el viejo.** Actualizarlo solo podría chocar con la llave única de `users.email`.
- **Las cuentas de Google con letras fuera de ASCII en el correo no pueden ingresar** (401 `invalid_token`). Se rechazan a propósito, para que el `lower()` de PostgreSQL y el de JavaScript no discrepen a mitad de un ingreso.
- **Un cuerpo de más de 100 KB responde 413 `PAYLOAD_TOO_LARGE`** (ya no 500), pero se lee antes de que el limitador lo cuente.
- **La app de Google está en modo Prueba** hasta que se publique con la página de privacidad (ver arriba).
- **No hay botón para borrar la cuenta.** El borrado se pide por correo y se hace a mano; no se borra la fila, porque `app_user` no puede borrar usuarios.
- Las dos dependencias indirectas `gcp-metadata` y `google-logging-utils` están fijadas en `overrides` de `package.json` porque sus versiones más nuevas tenían menos de dos semanas al instalarlas; se pueden quitar en el siguiente bloque de dependencias.
- `sessions.ip_address` queda sin uso.
- No hay borrado automático de registros viejos en `auth_logs`: Render gratuito no tiene tareas programadas.
- Los restos de sesiones de una cuenta abandonada (como máximo 5 por cuenta) se borran cuando esa persona vuelve a ingresar.
- Un cliente que repita un identificador revocado escribe una fila por petición en `auth_logs`.
- El diagrama `er-diagram.png` sigue mostrando el nombre viejo `refresh_token_hash`; el SVG ya está corregido.
