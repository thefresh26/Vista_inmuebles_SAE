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

Mismos usuarios que INMUEBLES-BROKERS: `broker2026` / `comercial2026`.
