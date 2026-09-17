# Migraciones preparadas pero NO aplicadas

Esta carpeta está **fuera** de `supabase/migrations/`, que es la que recorre
`npm run db:migrate`. Lo que hay aquí está escrito y verificado, pero no se
aplica hasta que se decida — moverlo a `migrations/` es lo que lo activa.

## `0006_roles.sql` — gerente, cajero y contador

Reparte permisos por rol en la propia base: el cajero registra pero no anula ni
cierra caja; el contador solo consulta. Incluye la tabla `profiles`, el disparador
que crea el perfil al darse de alta una cuenta (el primero nace gerente, porque si
no nadie podría ascender a nadie) y las políticas por tabla.

**Verificado** contra PostgreSQL 17 con las tres cuentas y las seis acciones:

| Rol | ver | registrar | corregir | borrar | cerrar caja | ascenderse |
| --- | --- | --- | --- | --- | --- | --- |
| gerente | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| cajero | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| contador | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

**Por qué está aquí y no aplicado:** de momento solo hace falta que entre el
administrador. Con `0005_cerrar_rls.sql` basta — cierra el acceso anónimo, que es
el agujero real. Los roles se activan cuando entre más gente a usar el sistema.

**Para activarlo:** mover el archivo a `supabase/migrations/`, ejecutar
`npm run db:migrate`, y conectar la interfaz para que cada quien vea solo los
botones que puede usar (hoy la pantalla de Configuración lo muestra como pendiente).
