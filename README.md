# INMUEBLES-SAE
**Consulta de Inventario de Inmuebles — SAE**

Duplicado de INMUEBLES-BROKERS con diseño rediseñado para SAE (paleta rosa/magenta,
logo SAE) y 2 campos nuevos conectados a la misma base de Supabase:

- **Expresión de Interés** (Sí/No) — columna `expresion_interes` en `inventario_SAE`,
  cargada desde "Expresion de interes.xlsx" (cruce por FMI).
- **Código de Subasta** — columna `codigo_subasta` en `inventario_SAE`, se muestra
  solo si el inmueble es una "unidad" (edificio con varias unidades). Se carga con
  `scrape_codigos_subasta.py` desde activosporcolombia.com.

## Migración de base de datos

1. Abre el SQL Editor de tu proyecto Supabase (niemyawlnebylpidfefh).
2. Ejecuta `01_migracion_supabase.sql` (agrega las columnas y carga expresión de interés).
3. Corre `python3 scrape_codigos_subasta.py` en tu computador (necesita internet real,
   este entorno de trabajo no tiene salida a internet general). Genera
   `02_codigos_subasta.sql`.
4. Ejecuta `02_codigos_subasta.sql` en el SQL Editor.

## Instalación y ejecución local

```bash
nvm use
npm install
npm run dev
```

## Roles de acceso

**Actualizado:** este sistema ya NO usa los usuarios `broker2026` /
`comercial2026`. Desde el panel de administración de usuarios (pestaña
"Administración", visible solo para rol `admin`), se administra la tabla
de autenticación de Supabase Auth **compartida por varios sistemas
internos de Activos por Colombia** (no exclusiva de este proyecto), con
correos institucionales reales y estos roles:

| Rol              | Descripción                                         |
|------------------|------------------------------------------------------|
| `admin`          | Acceso total + panel de administración de usuarios   |
| `comercial`      | Consulta de inventario                                |
| `comunicaciones` | Consulta de inventario                                |
| `juridico`       | Consulta de inventario                                |
| `sin_acceso`     | Cuenta existe pero sin permisos de consulta           |

La lógica de administración (crear, cambiar rol, habilitar/deshabilitar,
resetear contraseña, eliminar) vive en la Edge Function de Supabase
`admin-users`, que verifica en el servidor que quien llama tenga rol
`admin` antes de ejecutar cualquier acción — la verificación de rol en el
navegador (mostrar/ocultar la pestaña) es solo cosmética, no la barrera
de seguridad real.
