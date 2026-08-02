"""
Scraper de codigo de subasta (v2, con Playwright)
-----------------------------------------------------------
El scrape_codigos_subasta.py original usaba requests + BeautifulSoup, pero
activosporcolombia.com renderiza los resultados con JavaScript (Next.js),
asi que ese scraper nunca vio datos reales. Este script lo reemplaza usando
Playwright, y ademas reutiliza los enlaces ya encontrados en
enlaces_inmuebles_progreso.csv (generado por scrape_enlaces_inmuebles.py)
para no tener que volver a buscar folio por folio.

Para cada FMI cuyo enlace apunta a una pagina "unidad-inmobiliaria" (edificio
con varias unidades), visita esa pagina UNA VEZ por edificio (varios FMI
pueden compartir el mismo edificio) y extrae el codigo de subasta desde el
<title>, por ejemplo:
    "Unidad inmobiliaria en Medellin - UNI-0090-2025 | Activos por Colombia"
    -> UNI-0090-2025

Genera 07_codigos_subasta_v2.sql listo para pegar en el SQL Editor de
Supabase (actualiza la columna codigo_subasta en inventario_SAE).

Requisitos:
    pip install playwright requests
    playwright install chromium   (si no lo hiciste ya)

Uso:
    python3 scrape_codigos_subasta_v2.py
"""
import asyncio
import csv
import os
import re
from playwright.async_api import async_playwright

ENLACES_FILE = "enlaces_inmuebles_progreso.csv"
if not os.path.exists(ENLACES_FILE):
    ENLACES_FILE = "enlaces_inmuebles.csv"  # fallback si no existe el de progreso

OUT_SQL = "07_codigos_subasta_v2.sql"
OUT_CSV = "codigos_subasta_v2.csv"

CONCURRENCIA = 8
CODIGO_RE = re.compile(r"UNI-\d{4}-\d{4}")


def cargar_enlaces_unidad():
    """Lee el CSV de enlaces y devuelve dict: url_unidad -> lista de FMI
    que pertenecen a ese edificio."""
    edificios = {}
    with open(ENLACES_FILE, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            fmi = row.get("fmi")
            enlace = row.get("enlace") or row.get("enlace_inmueble")
            if not fmi or not enlace:
                continue
            if "/unidad-inmobiliaria/" not in enlace:
                continue
            edificios.setdefault(enlace, []).append(fmi)
    return edificios


async def obtener_codigo(browser, sem, url):
    async with sem:
        context = await browser.new_context(user_agent="Mozilla/5.0 (compatible; SAE-scraper/1.0)")
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_selector("text=Cargando", state="detached", timeout=15000)
            except Exception:
                pass
            title = await page.title()
            match = CODIGO_RE.search(title)
            codigo = match.group(0) if match else None
        except Exception as e:
            print(f"  error en {url}: {e}")
            codigo = None
        finally:
            await context.close()
        return url, codigo


async def run():
    edificios = cargar_enlaces_unidad()
    urls = list(edificios.keys())
    total_fmi = sum(len(v) for v in edificios.values())
    print(f"Edificios (unidad-inmobiliaria) distintos a revisar: {len(urls)}")
    print(f"FMI que pertenecen a alguno de esos edificios: {total_fmi}")

    sem = asyncio.Semaphore(CONCURRENCIA)
    resultados = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        tareas = [obtener_codigo(browser, sem, url) for url in urls]
        for i, coro in enumerate(asyncio.as_completed(tareas), 1):
            url, codigo = await coro
            resultados[url] = codigo
            print(f"[{i}/{len(urls)}] {codigo or 'sin codigo'} <- {url}")
        await browser.close()

    fmi_a_codigo = {}
    for url, fmis in edificios.items():
        codigo = resultados.get(url)
        if codigo:
            for fmi in fmis:
                fmi_a_codigo[fmi] = codigo

    with open(OUT_CSV, "w", encoding="utf-8") as f:
        f.write("fmi,codigo_subasta\n")
        for fmi, codigo in sorted(fmi_a_codigo.items()):
            f.write(f"{fmi},{codigo}\n")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("-- Generado por scrape_codigos_subasta_v2.py\n")
        f.write("-- Actualiza codigo_subasta para FMIs que pertenecen a una unidad inmobiliaria\n\n")
        for fmi, codigo in sorted(fmi_a_codigo.items()):
            fmi_esc = fmi.replace("'", "''")
            f.write(
                f'UPDATE "inventario_SAE" SET codigo_subasta = \'{codigo}\' '
                f"WHERE fmi = '{fmi_esc}';\n"
            )

    print(f"\nListo: {len(fmi_a_codigo)}/{total_fmi} FMI con codigo de subasta encontrado.")
    print(f"-> {OUT_CSV}")
    print(f"-> {OUT_SQL}  (pegar y ejecutar en el SQL Editor de Supabase)")


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
