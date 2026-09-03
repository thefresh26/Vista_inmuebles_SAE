-- ============================================================
-- DASHBOARD DE EXPRESIONES DE INTERÉS — función de estadísticas
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- ============================================================
--
-- La tabla expresiones_interes se llena automáticamente cada día desde
-- el Excel de Jeff (ver actualizacion_expresion_interes/actualizar_expresion_interes.py).
-- La columna "analista" no trae un nombre limpio: trae texto libre
-- ("IC ALEXANDRA BALZA / SANTIAGO TOBON", "IC NOVA BROKER", etc.), y la
-- columna "broker" también es texto libre (a veces nombre/empresa del
-- broker, ej. "KALIMA LOGISTICS", a veces teléfono/notas).
--
-- Clasificación (tiles de resumen, "broker"/"jeff"/"ale"/"otros"):
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
--
-- Ranking "top_fuentes" (quién trajo cada expresión de interés):
--   Antes se agrupaba solo por el texto de "analista", así que un broker
--   como "KALIMA LOGISTICS" (que vive en la columna "broker", no en
--   "analista") nunca aparecía ahí, aunque sí se contaba en el tile de
--   "Traídas por brokers". Ahora cada fila calcula su "fuente" real:
--     - si "broker" tiene dato -> el nombre del broker (columna "broker")
--     - si no, y el texto menciona a Jeffrey/Guerrero -> "Jeffrey Guerrero"
--     - si no, y el texto menciona a Alexandra/Balza  -> "Alexandra Balza"
--     - cualquier otro caso -> el texto de "analista" tal cual (se
--       limpia del lado del front-end, ver limpiarFuente() en app.js)
--   junto con su categoría (broker/jeff/ale/otros), para que el
--   dashboard pinte y filtre cada barra con el color correcto sin tener
--   que adivinarlo del texto.
-- No es perfecto (el texto es libre y a veces inconsistente, y la
-- columna "broker" también puede traer notas o teléfonos en vez de un
-- nombre limpio), pero es la mejor señal disponible hoy.

create or replace function public.estadisticas_expresiones_interes()
returns json
language sql
security definer
set search_path = public
as $$
  with clasificado as (
    select
      case
        when broker is not null and btrim(broker) <> '' then upper(btrim(broker))
        when analista ilike '%jeffrey%' or analista ilike '%guerrero%' then 'Jeffrey Guerrero'
        when analista ilike '%alexandra%' or analista ilike '%balza%' then 'Alexandra Balza'
        else coalesce(nullif(btrim(analista), ''), 'Sin dato')
      end as fuente,
      case
        when (broker is not null and btrim(broker) <> '') or analista ilike '%broker%' then 'broker'
        when analista ilike '%jeffrey%' or analista ilike '%guerrero%' then 'jeff'
        when analista ilike '%alexandra%' or analista ilike '%balza%' then 'ale'
        else 'otros'
      end as categoria
    from expresiones_interes
    where analista is not null and btrim(analista) <> ''
       or (broker is not null and btrim(broker) <> '')
  )
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
        select fuente as analista, categoria, count(*) as cantidad
        from clasificado
        group by fuente, categoria
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
