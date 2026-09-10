-- ============================================================
-- Estado ACTIBID en la consulta de folios — Vista_inmuebles_SAE
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- DESPUÉS de 14_estado_actibid.sql (necesita que exista la columna
-- expresiones_interes.estado_actibid).
-- ============================================================
--
-- Antes buscar_folios() solo devolvía la CANTIDAD de expresiones de
-- interés por FMI (interesados), sin mostrar el estado ACTIBID. Ahora
-- también devuelve el estado ACTIBID más reciente cargado para ese FMI
-- (si un mismo FMI tiene más de una expresión de interés con distinto
-- estado a lo largo del tiempo, se muestra el más nuevo según
-- created_at). Si el FMI no tiene ninguna expresión de interés, o
-- ninguna trae dato de estado ACTIBID, queda en null (el front-end
-- muestra "Sin dato").
--
-- Hay que borrar la función anterior porque cambia la forma de las
-- columnas de salida (Postgres no permite CREATE OR REPLACE cuando
-- cambian/agregan columnas del RETURNS TABLE).
drop function if exists public.buscar_folios(text[]);

create or replace function public.buscar_folios(p_folios text[])
returns table (
  fmi text,
  codigo_subasta text,
  enlace_inmueble text,
  interesados int,
  estado_actibid text,
  documentos jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    i.fmi,
    i.codigo_subasta,
    i.enlace_inmueble,
    coalesce(count(e.fmi) filter (where e.analista is not null and e.analista <> ''), 0)::int as interesados,
    (
      select e2.estado_actibid
      from expresiones_interes e2
      where upper(e2.fmi) = upper(i.fmi)
        and e2.estado_actibid is not null and btrim(e2.estado_actibid) <> ''
      order by e2.created_at desc
      limit 1
    ) as estado_actibid,
    coalesce(
      (select jsonb_agg(jsonb_build_object('nombre', d.nombre_archivo, 'url', d.url) order by d.creado_en)
       from public.documentos_fmi d
       where upper(d.fmi) = upper(i.fmi)),
      '[]'::jsonb
    ) as documentos
  from "inventario_SAE" i
  left join expresiones_interes e on upper(e.fmi) = upper(i.fmi)
  where upper(i.fmi) = any (select upper(x) from unnest(p_folios) as x)
  group by i.fmi, i.codigo_subasta, i.enlace_inmueble;
$$;

-- Mismo permiso que ya tenía: solo usuarios logueados pueden ejecutarla.
revoke all on function public.buscar_folios(text[]) from public;
grant execute on function public.buscar_folios(text[]) to authenticated;


-- Verificación rápida (opcional, puedes correr esto para probar):
-- select * from public.buscar_folios(array['50N-20448275']);
