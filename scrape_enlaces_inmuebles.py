"""
Scraper de enlaces directos a la ficha del inmueble en activosporcolombia.com
-------------------------------------------------------------------------------
El sitio es una app Next.js que renderiza los resultados de busqueda con
JavaScript, asi que a diferencia de scrape_codigos_subasta.py (que usa
requests + BeautifulSoup) este script necesita un navegador real via Playwright.

Para cada FMI que tiene expresion de interes (tabla expresiones_interes en
Supabase), busca https://www.activosporcolombia.com/es/v2/buscar?query=<FMI>
y, si el inmueble esta publicado, extrae el enlace directo a su ficha
(/es/inmueble/<id>/<slug> o /es/unidad-inmobiliaria/<id>/<slug>).

Busca varios folios EN PARALELO (varias pestañas del mismo navegador a la
vez, ver CONCURRENCIA mas abajo) para que sea mas rapido.

Genera 06_enlaces_inmuebles.sql (respaldo/registro de lo aplicado) y, si
encuentra la clave service_role de Supabase, ADEMAS actualiza la base de
datos directamente (sin tener que pegar el .sql a mano en el SQL Editor).

Guarda progreso en enlaces_inmuebles_progreso.csv: si se interrumpe, la
siguiente corrida retoma solo los folios pendientes.

Requisitos:
    pip install playwright requests
    playwright install chromium

Para que actualice Supabase automaticamente (opcional):
    1) Entra a https://supabase.com/dashboard/project/niemyawlnebylpidfefh/settings/api
    2) Copia la clave "service_role" (NO la "anon" — esa es otra).
    3) Crea un archivo llamado 'supabase_service_role.key' en esta misma
       carpeta, y pega ADENTRO solo la clave, sin nada mas.
    4) Ese archivo ya esta en .gitignore: nunca se sube a GitHub. Esa
       clave tiene acceso total a la base de datos, ¡no la compartas ni
       la pegues en ningun otro lado!
    Si no creas ese archivo, el script sigue funcionando igual que antes:
    solo genera el .sql para que lo pegues tu mismo en Supabase.

Uso:
    python3 scrape_enlaces_inmuebles.py
"""
import asyncio
import csv
import os
import re
import sys

try:
    import requests
except ImportError:
    requests = None

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None

SUPABASE_URL = "https://niemyawlnebylpidfefh.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
    "Im5pZW15YXdsbmVieWxwaWRmZWZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTAxNzUs"
    "ImV4cCI6MjA5NDE2NjE3NX0.sUV59NOKURYE6kPDETaM_rddX_cDRltlu7xblC-OJF4"
)

BASE = "https://www.activosporcolombia.com/es/v2/buscar"
OUT_SQL = "06_enlaces_inmuebles.sql"
OUT_CSV = "enlaces_inmuebles.csv"
PROGRESS_FILE = "enlaces_inmuebles_progreso.csv"

# CONCURRENCIA: cuantas busquedas en paralelo. Subir este numero lo hace mas
# rapido pero satura mas el servidor del sitio; si empiezas a ver muchos
# "error" en la salida, bajalo.
CONCURRENCIA = 8

LINK_RE = re.compile(r"/es/(?:inmueble|unidad-inmobiliaria)/\d+/[^\s\"'>]+")

SERVICE_ROLE_KEY_FILE = "supabase_service_role.key"


def obtener_service_role_key():
    """Busca la clave service_role primero en la variable de entorno
    SUPABASE_SERVICE_ROLE_KEY y despues en el archivo local
    'supabase_service_role.key' (ignorado por git). Si no encuentra
    ninguna, devuelve None y el script sigue en modo manual (solo .sql)."""
    env_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if env_key:
        return env_key.strip()
    if os.path.exists(SERVICE_ROLE_KEY_FILE):
        with open(SERVICE_ROLE_KEY_FILE, "r", encoding="utf-8") as f:
            key = f.read().strip()
            return key or None
    return None


def aplicar_a_supabase(enlaces_previos, service_key):
    """Actualiza enlace_inmueble directamente en inventario_SAE via la API
    REST de Supabase (PostgREST), usando la clave service_role (que se
    salta las politicas de RLS). Devuelve (ok, error) contando cuantas
    filas se actualizaron bien y cuantas fallaron."""
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    ok, error = 0, 0
    total = len(enlaces_previos)
    for i, (fmi, enlace) in enumerate(sorted(enlaces_previos.items()), start=1):
        try:
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/inventario_SAE",
                params={"fmi": f"eq.{fmi}"},
                headers=headers,
                json={"enlace_inmueble": enlace},
                timeout=20,
            )
            if resp.ok:
                ok += 1
            else:
                error += 1
                print(f"  [{i}/{total}] {fmi} -> ERROR HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            error += 1
            print(f"  [{i}/{total}] {fmi} -> ERROR: {e}")
    return ok, error


def get_fmis_con_interes():
    """Trae la lista de FMI distintos desde la tabla expresiones_interes,
    paginando porque la API de Supabase limita cada respuesta a 1000 filas."""
    fmis = set()
    page_size = 1000
    offset = 0
    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/expresiones_interes?select=fmi",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range": f"{offset}-{offset + page_size - 1}",
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        fmis.update(row["fmi"] for row in data if row.get("fmi"))
        if len(data) < page_size:
            break
        offset += page_size
    return sorted(fmis)


def cargar_progreso():
    """Lee enlaces_inmuebles_progreso.csv si existe (de una corrida anterior
    interrumpida) y devuelve un dict fmi -> estado y otro fmi -> enlace
    (solo para los encontrados)."""
    estados = {}
    enlaces = {}
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                fmi = row.get("fmi")
                if not fmi:
                    continue
                estados[fmi] = row.get("estado", "")
                if row.get("enlace"):
                    enlaces[fmi] = row["enlace"]
    return estados, enlaces


async def buscar_enlace(page, fmi):
    """Busca el FMI en el sitio y devuelve el enlace directo si esta publicado."""
    url = f"{BASE}?query={fmi}&limit=1"
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    try:
        await page.wait_for_selector("text=Cargando búsqueda...", state="detached", timeout=15000)
    except Exception:
        pass
    html = await page.content()
    match = LINK_RE.search(html)
    if match:
        return "https://www.activosporcolombia.com" + match.group(0)
    return None


async def procesar_fmi(browser, sem, fmi, progreso_writer, contador):
    async with sem:
        context = await browser.new_context(user_agent="Mozilla/5.0 (compatible; SAE-scraper/1.0)")
        page = await context.new_page()
        try:
            enlace = await buscar_enlace(page, fmi)
            if enlace:
                estado = "encontrado"
            else:
                estado = "no_publicado"
        except Exception as e:
            enlace = None
            estado = "error"
            print(f"  {fmi} -> error: {e}")
        finally:
            await context.close()

        contador["n"] += 1
        marca = enlace if enlace else ("no publicado" if estado == "no_publicado" else "ERROR")
        print(f"[{contador['n']}/{contador['total']}] {fmi} -> {marca}")
        progreso_writer.writerow([fmi, estado, enlace or ""])
        return fmi, enlace


async def run():
    fmis = get_fmis_con_interes()
    estados_previos, enlaces_previos = cargar_progreso()
    pendientes = [f for f in fmis if f not in estados_previos]

    print(f"Total folios con expresion de interes: {len(fmis)}")
    if estados_previos:
        print(f"Ya procesados en una corrida anterior: {len(fmis) - len(pendientes)}")
    print(f"Pendientes por buscar: {len(pendientes)} (concurrencia: {CONCURRENCIA})")

    if pendientes:
        es_nuevo = not os.path.exists(PROGRESS_FILE)
        progreso_file = open(PROGRESS_FILE, "a", encoding="utf-8", newline="", buffering=1)
        progreso_writer = csv.writer(progreso_file)
        if es_nuevo:
            progreso_writer.writerow(["fmi", "estado", "enlace"])

        contador = {"n": 0, "total": len(pendientes)}
        sem = asyncio.Semaphore(CONCURRENCIA)

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                tareas = [
                    procesar_fmi(browser, sem, fmi, progreso_writer, contador)
                    for fmi in pendientes
                ]
                resultados = await asyncio.gather(*tareas)
                await browser.close()
        finally:
            progreso_file.close()

        for fmi, enlace in resultados:
            if enlace:
                enlaces_previos[fmi] = enlace
    else:
        print("Nada pendiente, ya se habia procesado todo antes.")

    with open(OUT_CSV, "w", encoding="utf-8") as f:
        f.write("fmi,enlace_inmueble\n")
        for fmi, enlace in sorted(enlaces_previos.items()):
            f.write(f"{fmi},{enlace}\n")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("-- Generado por scrape_enlaces_inmuebles.py\n")
        f.write("-- Enlace directo a la ficha del inmueble, solo para folios publicados\n\n")
        f.write('ALTER TABLE "inventario_SAE" ADD COLUMN IF NOT EXISTS enlace_inmueble text;\n\n')
        for fmi, enlace in sorted(enlaces_previos.items()):
            fmi_esc = fmi.replace("'", "''")
            enlace_esc = enlace.replace("'", "''")
            f.write(
                f'UPDATE "inventario_SAE" SET enlace_inmueble = \'{enlace_esc}\' '
                f"WHERE fmi = '{fmi_esc}';\n"
            )

    service_key = obtener_service_role_key()
    aplicado_auto = None
    if service_key and enlaces_previos:
        print()
        print(f"Clave service_role encontrada — aplicando {len(enlaces_previos)} enlaces directo en Supabase...")
        ok, error = aplicar_a_supabase(enlaces_previos, service_key)
        aplicado_auto = (ok, error)
        print(f"Aplicado en Supabase: {ok} OK, {error} con error.")

    imprimir_pasos_finales(enlaces_previos, fmis, aplicado_auto)


def verificar_requisitos():
    """Revisa que las librerias necesarias esten instaladas ANTES de hacer
    cualquier otra cosa. Sin esto, el script fallaba con un traceback poco
    claro apenas se intentaba importar playwright/requests."""
    faltantes = []
    if requests is None:
        faltantes.append("requests")
    if async_playwright is None:
        faltantes.append("playwright")

    if faltantes:
        print("=" * 60)
        print("FALTAN DEPENDENCIAS — no se puede continuar")
        print("=" * 60)
        print(f"No tienes instalado: {', '.join(faltantes)}")
        print()
        print("Corre esto en cmd, PARADO EN ESTA MISMA CARPETA, y vuelve a")
        print("ejecutar el script:")
        print()
        print("    pip install playwright requests")
        print("    playwright install chromium")
        print()
        print("=" * 60)
        return False
    return True


def imprimir_pasos_iniciales():
    print("=" * 60)
    print("SCRAPER DE ENLACES DE INMUEBLES — SAE")
    print("=" * 60)
    print()
    print("QUE HACE ESTE SCRIPT (automatico, no necesitas intervenir):")
    print("  1) Trae de Supabase los FMI que tienen expresion de interes.")
    print("  2) Busca cada uno en activosporcolombia.com (varios a la vez).")
    print(f"  3) Genera '{OUT_SQL}' con los UPDATE (respaldo/registro).")
    print(f"  4) Guarda progreso en '{PROGRESS_FILE}' por si se corta a la mitad.")
    print()
    if obtener_service_role_key():
        print("Se detecto la clave service_role: al terminar, este script va")
        print("a actualizar la base de datos DIRECTAMENTE, sin pasos manuales.")
    else:
        print("No se detecto la clave service_role, asi que la base de datos NO")
        print(f"se modifica sola: al final tendras que pegar '{OUT_SQL}' tu mismo")
        print("en el SQL Editor de Supabase (ver instrucciones al terminar).")
    print()
    print("Esto puede tardar varios minutos si son muchos folios.")
    print("=" * 60)
    print()


def imprimir_pasos_finales(enlaces_previos, fmis, aplicado_auto):
    print()
    print("=" * 60)
    print("TERMINADO")
    print("=" * 60)
    print(f"{len(enlaces_previos)}/{len(fmis)} folios publicados con enlace directo.")
    print()
    print("Archivos generados en esta misma carpeta:")
    print(f"  - {OUT_CSV}  (solo para revisar los resultados)")
    print(f"  - {OUT_SQL}  (respaldo/registro de lo aplicado)")
    print()

    if aplicado_auto is not None:
        ok, error = aplicado_auto
        print("YA SE APLICO AUTOMATICAMENTE EN SUPABASE — no tienes que hacer nada mas.")
        print(f"  {ok} filas actualizadas correctamente.")
        if error:
            print(f"  {error} filas con error (revisa el detalle mas arriba).")
            print(f"  Si quieres, tambien puedes pegar '{OUT_SQL}' en el SQL Editor")
            print("  como respaldo, solo para esas filas que fallaron.")
    else:
        print("SIGUIENTE PASO (manual, en Supabase):")
        print(f"  1) Abre {OUT_SQL} y copia todo su contenido.")
        print("  2) Entra al SQL Editor de tu proyecto en Supabase:")
        print("     https://supabase.com/dashboard/project/niemyawlnebylpidfefh/sql")
        print("  3) Pega el contenido y dale 'Run' para aplicar los cambios.")
        print()
        print("  (Si prefieres que esto se aplique solo la proxima vez, revisa")
        print("   las instrucciones al inicio de este archivo sobre la clave")
        print("   service_role.)")

    print()
    print(f"(Progreso guardado en {PROGRESS_FILE} — si interrumpes el script,")
    print(" la proxima corrida retoma solo los folios pendientes.)")
    print("=" * 60)


def main():
    if not verificar_requisitos():
        sys.exit(1)
    imprimir_pasos_iniciales()
    asyncio.run(run())


if __name__ == "__main__":
    main()
