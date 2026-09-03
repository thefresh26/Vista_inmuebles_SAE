-- ============================================================
-- DASHBOARD DE EXPRESIONES DE INTERÉS — función de estadísticas
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- ============================================================
--
-- La tabla expresiones_interes se llena automáticamente cada día desde
-- el Excel de Jeff (ver actualizacion_expresion_interes/actualizar_expresion_interes.py).
-- La columna "analista" no trae un nombre limpio: trae texto libre
-- ("IC ALEXANDRA BALZA / SANTIAGO TOBON", "IC NOVA BROKER", etc.), y la
-- columna "broker" también es texto libre (a veces nombre del broker,
-- a veces teléfono/notas). La clasificación se hace así:
--   - si la columna "broker" tiene algo, O el texto de "analista"
--     contiene la palabra "broker"                    -> lo trajo un broker externo
--   - si no, y "analista" contiene "jeffrey"/"guerrero" -> lo gestionó Jeffrey Guerrero
--   - si no, y "analista" contiene "alexandra"/"balza"  -> lo gestionó Alexandra Balza
--   - cualquier otro caso (u otro analista, texto vacío) -> "otros"
--
-- Esta regla se acordó con el usuario en dos partes:
-- 1) "cuando aparece el broker es que ellos lo trajeron, cuando no, es
--    que los analistas le hicieron el requerimiento y seguimiento".
-- 2) Verificado con datos reales (2026-09-03): de las 2398 filas, 660
--    tienen la columna "broker" con dato, pero solo 34 de esas también
--    dicen "broker" en el texto de "analista". De las 626 restantes,
--    603 tienen además el nombre de Jeffrey o Alexandra en "analista"
--    (el broker trajo el cliente y el analista le dio seguimiento) y 23
--    no tienen ningún nombre. El usuario confirmó que en ambos casos el
--    broker es quien trajo al cliente, así que la columna "broker" llena
--    manda sobre el texto de "analista" para esta clasificación.
-- No es perfecta (el texto es libre y a veces inconsistente), pero es
-- la mejor señal disponible hoy.

create or replace function public.estadisticas_expresiones_interes()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total_expresiones', (select count(*) from expresiones_interes),
    'total_fmi_distintos', (select count(distinct fmi) from expresiones_interes),
    'total_clientes_nombrados', (select count(distinct cliente) from expresiones_interes where cliente is not null and btrim(cliente) <> ''),
    'broker', (select count(*) from expresiones_interes where analista ilike '%broker%' or (broker is not null and btrim(broker) <> '')),
    'jeff', (select count(*) from expresiones_interes where not (analista ilike '%broker%' or (broker is not null and btrim(broker) <> '')) and (analista ilike '%jeffrey%' or analista ilike '%guerrero%')),
    'ale', (select count(*) from expresiones_interes where not (analista ilike '%broker%' or (broker is not null and btrim(broker) <> '')) and (analista ilike '%alexandra%' or analista ilike '%balza%')),
    'otros', (select count(*) from expresiones_interes where not (analista ilike '%broker%' or (broker is not null and btrim(broker) <> '')) and not (analista ilike '%jeffrey%' or analista ilike '%guerrero%' or analista ilike '%alexandra%' or analista ilike '%balza%')),
    'sin_broker_con_mail', (select count(*) from expresiones_interes where not (analista ilike '%broker%' or (broker is not null and btrim(broker) <> '')) and mail is not null and btrim(mail) <> ''),
    'top_fuentes', (select coalesce(json_agg(t), '[]'::json) from (
        select analista, count(*) as cantidad
        from expresiones_interes
        where analista is not null and btrim(analista) <> ''
        group by analista
        order by count(*) desc
        limit 15
    ) t)
  );
$$;

-- Mismo nivel de permiso que buscar_folios: solo usuarios logueados.
revoke all on function public.estadisticas_expresiones_interes() from public;
grant execute on function public.estadisticas_expresiones_interes() to authenticated;

-- Verificación rápida (opcional):
-- select estadisticas_expresiones_interes();
