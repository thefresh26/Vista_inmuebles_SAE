-- ============================================================
-- DASHBOARD DE ARRIENDOS — Portafolio de territoriales
-- Ejecutar en Supabase → SQL Editor (proyecto niemyawlnebylpidfefh)
-- ============================================================
--
-- Esta es una tabla NUEVA e independiente de expresiones_interes: viene
-- del archivo "Portafolio final de territoriales.xlsx" (hoja
-- "PORTAFOLIO FINAL GENERAL") y NO trae datos de quién se interesó en
-- cada folio (no tiene cliente/analista/broker) — es el catálogo de
-- inmuebles disponibles para arriendo, con su territorial, ubicación y
-- valor estimado de arriendo. Se llena/actualiza vía
-- actualizacion_arriendo/actualizar_arriendo.py, que reemplaza el
-- contenido completo cada vez que corre (igual patrón que
-- expresiones_interes: TRUNCATE + INSERT).

create table if not exists public.arriendos_portafolio (
  id bigint generated always as identity primary key,
  item int,
  territorial text,
  fmi text not null,
  departamento text,
  ciudad text,
  direccion text,
  tipo_inmueble text,
  fecha_aprobado_estimado date,
  valor_estimado_maximo numeric,
  valor_estimado_medio numeric,
  valor_estimado_minimo numeric,
  fecha_avaluo date,
  valor_avaluo numeric,
  creado_en timestamptz not null default now()
);

create index if not exists arriendos_portafolio_fmi_idx on public.arriendos_portafolio (upper(fmi));

alter table public.arriendos_portafolio enable row level security;

-- Igual que expresiones_interes: nadie lee la tabla directamente desde el
-- cliente, todo pasa por la función RPC de abajo (no se crea policy de
-- SELECT => select queda bloqueado por defecto para "anon"/"authenticated"
-- directo sobre la tabla). Las cargas se hacen con la service_role key
-- (o con la connection string directa, como en el script de sync).

-- ============================================================
-- FUNCIÓN RPC: estadisticas_arriendos()
-- ============================================================
create or replace function public.estadisticas_arriendos()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total_folios', (select count(*) from arriendos_portafolio),
    'con_valor_estimado', (select count(*) from arriendos_portafolio where valor_estimado_medio is not null),
    'sin_valor_estimado', (select count(*) from arriendos_portafolio where valor_estimado_medio is null),
    'con_avaluo', (select count(*) from arriendos_portafolio where valor_avaluo is not null),
    'sin_avaluo', (select count(*) from arriendos_portafolio where valor_avaluo is null),
    'ultima_actualizacion', (select max(creado_en) from arriendos_portafolio),
    'top_territorial', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(nullif(upper(btrim(territorial)), ''), 'SIN DATO') as territorial, count(*) as cantidad
        from arriendos_portafolio
        group by coalesce(nullif(upper(btrim(territorial)), ''), 'SIN DATO')
        order by count(*) desc
        limit 30
    ) t),
    'top_tipo_inmueble', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(nullif(upper(btrim(tipo_inmueble)), ''), 'SIN DATO') as tipo, count(*) as cantidad
        from arriendos_portafolio
        group by coalesce(nullif(upper(btrim(tipo_inmueble)), ''), 'SIN DATO')
        order by count(*) desc
        limit 30
    ) t),
    'top_departamento', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(nullif(upper(btrim(departamento)), ''), 'SIN DATO') as departamento, count(*) as cantidad
        from arriendos_portafolio
        group by coalesce(nullif(upper(btrim(departamento)), ''), 'SIN DATO')
        order by count(*) desc
        limit 40
    ) t)
  );
$$;

-- Mismo nivel de permiso que las otras funciones del dashboard: solo
-- usuarios logueados.
revoke all on function public.estadisticas_arriendos() from public;
grant execute on function public.estadisticas_arriendos() to authenticated;

-- Verificación rápida (opcional):
-- select estadisticas_arriendos();
