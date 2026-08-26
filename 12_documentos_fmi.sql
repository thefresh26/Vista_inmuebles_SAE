-- ============================================================
-- DOCUMENTOS POR FMI — Vista_inmuebles_SAE / Vista_inmuebles_SAE_backend
-- Ejecutar completo en Supabase → SQL Editor
-- (Desactiva la traducción automática de Chrome antes de pegar)
-- ============================================================

-- 1) TABLA: relación muchos-a-muchos entre documentos y folios (FMI).
--    Una misma carta de "manifestación de intención de compra" puede
--    listar varios predios/FMI a la vez, así que un documento puede
--    quedar asociado a más de un FMI, y en teoría un FMI podría llegar
--    a tener más de un documento con el tiempo.
create table if not exists public.documentos_fmi (
  id bigint generated always as identity primary key,
  fmi text not null,
  nombre_archivo text not null,
  url text not null,
  storage_path text,
  origen text,                    -- carpeta/región/mes de origen en SharePoint (trazabilidad)
  creado_en timestamptz not null default now()
);

create index if not exists documentos_fmi_fmi_idx on public.documentos_fmi (upper(fmi));

alter table public.documentos_fmi enable row level security;

-- Nadie lee esta tabla directamente desde el cliente: se expone solo a
-- través de buscar_folios (más abajo), igual que inventario_SAE y
-- expresiones_interes. Las cargas se hacen con la service_role key.
-- (No se crea policy de SELECT => select queda bloqueado por defecto
-- para "anon"/"authenticated" directo sobre la tabla)


-- 2) FUNCIÓN RPC buscar_folios: se agrega el campo "documentos" (jsonb),
--    un arreglo con {nombre, url} por cada documento ligado al FMI.
--    Hay que borrar la función anterior porque cambia la forma de las
--    columnas de salida (Postgres no permite CREATE OR REPLACE cuando
--    cambian/agregan columnas del RETURNS TABLE).
drop function if exists public.buscar_folios(text[]);

create or replace function public.buscar_folios(p_folios text[])
returns table (
  fmi text,
  codigo_subasta text,
  enlace_inmueble text,
  interesados int,
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


-- 3) Verificación rápida (opcional, puedes correr esto para probar):
-- select * from public.buscar_folios(array['50N-20448275']);
