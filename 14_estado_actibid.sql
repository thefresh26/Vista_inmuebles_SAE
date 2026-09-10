-- ============================================================
-- Nueva columna: ESTADO ACTIBID (por expresión de interés)
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- ANTES de correr el script de sincronización con este cambio, y antes
-- de actualizar la función estadisticas_expresiones_interes() (ver
-- 13_estadisticas_expresiones.sql).
-- ============================================================
--
-- Viene de la hoja SEMAFORO_ANALISTAS del Excel de Jeff, columna
-- "ESTADO ACTIBID" (texto libre: "proxima Venta", "Subasta finalizada",
-- "Borrador", y varios más). Se guarda tal cual llega del Excel; la
-- limpieza/agrupación para el ranking se hace en la función de
-- estadísticas (mayúsculas + "Sin dato" cuando está vacía).

alter table expresiones_interes add column if not exists estado_actibid text;
