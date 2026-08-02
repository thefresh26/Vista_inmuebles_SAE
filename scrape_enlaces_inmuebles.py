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

Genera 06_enlaces_inmuebles.sql listo para pegar en el SQL Editor de Supabase
(agrega y actualiza la columna enlace_inmueble en inventario_SAE).

Guarda progreso en enlaces_inmuebles_progreso.csv: si se interrumpe, la
siguiente corrida retoma solo los folios pendientes.

Requisitos:
    pip install playwright requests
    playwright install chromium

Uso:
    python3 scrape_enlaces_inmuebles.py
"""
import asyncio
import csv
import os
import re
import requests
from playwright.async_api import async_playwright

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

    print(f"\nListo: {len(enlaces_previos)}/{len(fmis)} folios publicados con enlace directo.")
    print(f"-> {OUT_CSV}")
    print(f"-> {OUT_SQL}  (pegar y ejecutar en el SQL Editor de Supabase)")
    print(f"(Progreso guardado en {PROGRESS_FILE} — si interrumpes el script, la proxima corrida retoma donde quedo)")


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
