-- ============================================================
-- DASHBOARD DE EXPRESIONES DE INTERÉS — función de estadísticas
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- ============================================================
--
-- La tabla expresiones_interes se llena automáticamente cada semana desde
-- el Excel de Jeff (ver actualizacion_expresion_interes/actualizar_expresion_interes.py).
-- La columna "analista" no trae un nombre limpio: trae texto libre
-- ("IC ALEXANDRA BALZA / SANTIAGO TOBON", "IC NOVA BROKER", etc.), y la
-- columna "broker" también es texto libre (a veces nombre/empresa del
-- broker, ej. "KALIMA LOGISTICS", a veces un correo o teléfono puesto
-- ahí por error).
--
-- Clasificación (tiles de resumen y ranking, "broker"/"jeff"/"ale"/"steven"/"otros"):
--   - si "broker" tiene dato, NO es un correo electrónico (eso suele ser
--     el correo del cliente puesto ahí por error) Y no es el nombre de
--     Jeffrey ni de Alexandra puesto ahí por error  -> lo trajo un broker externo
--   - si no, y "analista" contiene "broker" (y esa frase no nombra
--     también a Jeffrey/Alexandra/Steven, ni con typos comunes)
--                                                      -> lo trajo un broker externo
--   - si no, y "analista" o "broker" contienen "jeffrey"/"guerrero"    -> Jeffrey Guerrero
--   - si no, y "analista" o "broker" contienen "alexandra"/"balza"
--     (o typos comunes: alexandrra, alexanddra, alexandea, " alexa ")  -> Alexandra Balza
--   - si no, y "analista" o "broker" contienen "steven"+"valencia"      -> Steven Valencia
--   - cualquier otro caso (otro analista, texto vacío)                  -> "Otros"
--
-- Historial de decisiones tomadas con el usuario (para no repetir el
-- mismo error si se vuelve a tocar esta función):
-- 1) "cuando aparece el broker es que ellos lo trajeron, cuando no, es
--    que los analistas le hicieron el requerimiento y seguimiento".
-- 2) Un correo electrónico en la columna "broker" (ej. un cliente que
--    puso su propio correo ahí por error) NO cuenta como broker real —
--    se trata igual que si "broker" estuviera vacío.
-- 3) "broker" con el nombre de Jeffrey/Alexandra (typos incluidos) NO
--    cuenta como broker — es un error de captura, es el analista.
-- 4) Jeffrey, Alexandra y Steven son analistas fijos reconocidos por
--    nombre, no brokers ni "otros".
--
-- Ranking "top_fuentes" (quién trajo cada expresión de interés):
--   El nombre se limpia dentro de la misma consulta (se quita el
--   prefijo "IC ", se corta todo lo que venga después de un separador
--   de nota como " - ", "--", "/" o "," y se quita un "BROKER" suelto
--   al final) antes de agrupar, para que variantes del mismo broker
--   ("IC NOVA BROKER", "IC NOVA - PROXIMO VENTA", "NOVA, GIOVANNI...")
--   queden agrupadas en una sola fila. Se excluyen del ranking (no de
--   los tiles) los "nombres" que en realidad son solo un teléfono o un
--   correo electrónico — no aportan información útil.
-- No es perfecto (el texto es libre y a veces inconsistente), pero es
-- la mejor señal disponible hoy. El front-end (app.js) hace una segunda
-- pasada de limpieza/alias por seguridad.

create or replace function public.estadisticas_expresiones_interes()
returns json
language sql
security definer
set search_path = public
as $$
  with clasificado as (
    select
      mail,
      analista,
      broker,
      (
        -- Broker real: la columna "broker" tiene dato, no es un correo
        -- electronico (eso normalmente es el correo del cliente puesto
        -- ahi por error, no un broker) y no es el nombre de Jeffrey ni de
        -- Alexandra puesto ahi por error.
        (broker is not null and btrim(broker) <> ''
          and btrim(broker) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
          and not (coalesce(broker,'') ilike '%jeffrey%' or coalesce(broker,'') ilike '%guerrero%' or coalesce(broker,'') ilike '%alexandra%' or coalesce(broker,'') ilike '%balza%')
        )
        or (
          -- Broker solo por texto: "analista" dice "broker" y la columna
          -- "broker" esta vacia (o solo tiene un correo, que no cuenta
          -- como dato real de broker). Pero si esa misma frase TAMBIEN
          -- nombra a Jeffrey o Alexandra (incluyendo typos comunes), son
          -- ellos quienes lo gestionaron (son analistas, no brokers) — la
          -- palabra "broker" ahi no manda.
          (broker is null or btrim(broker) = '' or btrim(broker) ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
          and coalesce(analista,'') ilike '%broker%'
          and not (
            coalesce(analista,'') ilike '%jeffrey%' or coalesce(analista,'') ilike '%guerrero%'
            or coalesce(analista,'') ilike '%alexandra%' or coalesce(analista,'') ilike '%balza%'
            or coalesce(analista,'') ilike '%alexandrra%' or coalesce(analista,'') ilike '%alexanddra%'
            or coalesce(analista,'') ilike '%alexandea%' or coalesce(analista,'') ilike '% alexa %'
            or coalesce(analista,'') ilike '% alexa/%'
          )
        )
      ) as es_broker,
      (coalesce(analista,'') ilike '%jeffrey%' or coalesce(analista,'') ilike '%guerrero%'
        or coalesce(broker,'') ilike '%jeffrey%' or coalesce(broker,'') ilike '%guerrero%') as es_jeff,
      (coalesce(analista,'') ilike '%alexandra%' or coalesce(analista,'') ilike '%balza%'
        or coalesce(analista,'') ilike '%alexandrra%' or coalesce(analista,'') ilike '%alexanddra%'
        or coalesce(analista,'') ilike '%alexandea%' or coalesce(analista,'') ilike '% alexa %'
        or coalesce(analista,'') ilike '% alexa/%'
        or coalesce(broker,'') ilike '%alexandra%' or coalesce(broker,'') ilike '%balza%') as es_ale,
      -- Tercer analista reconocido: Steven Valencia.
      ((coalesce(analista,'') ilike '%steven%' and coalesce(analista,'') ilike '%valencia%')
        or (coalesce(broker,'') ilike '%steven%' and coalesce(broker,'') ilike '%valencia%')) as es_steven
    from expresiones_interes
  ),
  con_fuente as (
    select
      case
        when es_broker and broker is not null and btrim(broker) <> '' then
          -- el broker SI quedo registrado (columna "broker" con dato): se
          -- limpia y se usa su nombre real.
          nullif(upper(btrim(
            regexp_replace(
              regexp_replace(
                regexp_replace(btrim(broker), '^ic\s+', '', 'i'),
                '(\s+-\s+|--|/|,).*$', ''
              ),
              '\s*-?\s*broker\s*$', '', 'i'
            )
          )), '')
        when es_broker then
          -- se detecto un broker solo porque el texto de "analista" dice
          -- "broker", pero la columna "broker" esta vacia -> no hay forma
          -- confiable de sacar el nombre real de ahi, asi que se deja
          -- generico en vez de mostrar un nombre que puede confundir.
          'Broker (mencionado en texto, sin nombre)'
        when es_jeff then 'Jeffrey Guerrero'
        when es_ale then 'Alexandra Balza'
        when es_steven then 'Steven Valencia'
        else nullif(upper(btrim(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(btrim(analista), ''), '^ic\s+', '', 'i'),
              '(\s+-\s+|--|/|,).*$', ''
            ),
            '\s*-?\s*broker\s*$', '', 'i'
          )
        )), '')
      end as fuente_bruta,
      case
        when es_broker then 'broker'
        when es_jeff then 'jeff'
        when es_ale then 'ale'
        when es_steven then 'steven'
        else 'otros'
      end as categoria
    from clasificado
    where analista is not null and btrim(analista) <> ''
       or (broker is not null and btrim(broker) <> '')
  )
  select json_build_object(
    'total_expresiones', (select count(*) from expresiones_interes),
    'total_fmi_distintos', (select count(distinct fmi) from expresiones_interes),
    'total_clientes_nombrados', (select count(distinct cliente) from expresiones_interes where cliente is not null and btrim(cliente) <> ''),
    'broker', (select count(*) from clasificado where es_broker),
    'jeff', (select count(*) from clasificado where not es_broker and es_jeff),
    'ale', (select count(*) from clasificado where not es_broker and not es_jeff and es_ale),
    'steven', (select count(*) from clasificado where not es_broker and not es_jeff and not es_ale and es_steven),
    'otros', (select count(*) from clasificado where not es_broker and not es_jeff and not es_ale and not es_steven),
    'sin_broker_con_mail', (select count(*) from clasificado where not es_broker and mail is not null and btrim(mail) <> ''),
    'ultima_actualizacion', (select max(created_at) from expresiones_interes),
    'top_fuentes', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(fuente_bruta, 'Sin dato') as analista, categoria, count(*) as cantidad
        from con_fuente
        -- se excluyen del ranking los "nombres" que en realidad son solo
        -- numeros/telefonos (puros digitos y simbolos, sin ninguna letra)
        -- o un correo electronico: no aportan informacion util y le
        -- quitaban espacio a brokers reales con nombre. El conteo de la
        -- categoria "broker" en los tiles NO cambia, esto solo afecta la
        -- lista visible del ranking.
        where not (
          coalesce(fuente_bruta,'') ~ '[0-9]'
          and coalesce(fuente_bruta,'') !~ '[A-Za-zÀ-ÿ]'
        )
        and coalesce(fuente_bruta,'') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
        group by coalesce(fuente_bruta, 'Sin dato'), categoria
        order by count(*) desc
        limit 40
    ) t)
  );
$$;

-- Mismo nivel de permiso que buscar_folios: solo usuarios logueados.
revoke all on function public.estadisticas_expresiones_interes() from public;
grant execute on function public.estadisticas_expresiones_interes() to authenticated;

-- Verificación rápida (opcional):
-- select estadisticas_expresiones_interes();
