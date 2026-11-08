# Sesiones (Etapa 3, bloque 1)

Este documento explica cómo funcionan las sesiones del backend. Todavía no hay ningún endpoint de ingreso: llega en el bloque 2 (Google). Aquí está la base sobre la que se apoya: abrir, comprobar, renovar y cerrar una sesión.

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

- `sessions.ip_address` queda sin uso.
- No hay borrado automático de registros viejos en `auth_logs`: Render gratuito no tiene tareas programadas.
- Los restos de sesiones de una cuenta abandonada (como máximo 5 por cuenta) se borran cuando esa persona vuelve a ingresar.
- Un cliente que repita un identificador revocado escribe una fila por petición en `auth_logs`.
- El diagrama `er-diagram.png` sigue mostrando el nombre viejo `refresh_token_hash`; el SVG ya está corregido.
