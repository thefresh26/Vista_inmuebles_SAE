"""
Scraper de codigo de subasta desde activosporcolombia.com
-----------------------------------------------------------
Recorre el listado publico de activosporcolombia.com/es/v2/buscar
(6.300+ propiedades, ~350 paginas) y extrae, para cada inmueble que
sea "unidad inmobiliaria" (edificio con varias unidades), el FMI y
su codigo de subasta (ej: UNI-0007-2025).

Genera 02_codigos_subasta.sql listo para pegar en el SQL Editor de
Supabase (actualiza la columna codigo_subasta en inventario_SAE).

Requisitos: pip install requests beautifulsoup4

Uso:
    python3 scrape_codigos_subasta.py
"""
import re
import time
import requests
from bs4 import BeautifulSoup

BASE = "https://activosporcolombia.com/es/v2/buscar"
TOTAL_PAGES = 360   # margen sobre las ~352 paginas reales (6327 props / ~18 por pagina)
OUT_SQL = "02_codigos_subasta.sql"
OUT_CSV = "codigos_subasta.csv"

# patron: .../unidad-inmobiliaria/<id>/<slug>  seguido en el texto de CODIGO y FMI
LINK_RE = re.compile(r"/es/unidad-inmobiliaria/(\d+)/")

def parse_page(html):
    """Devuelve lista de (fmi, codigo_subasta) encontrados en la pagina."""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for a in soup.select("a[href*='/unidad-inmobiliaria/']"):
        text = a.get_text(" ", strip=True)
        # el texto de cada tarjeta termina en "...•CODIGO•FMI"
        parts = [p.strip() for p in text.split("•") if p.strip()]
        if len(parts) < 2:
            continue
        codigo = None
        fmi = None
        for p in parts:
            if re.match(r"^UNI-\d{4}-\d{4}$", p):
                codigo = p
            elif re.match(r"^[0-9A-Za-z]{2,4}-[0-9]{4,}$", p) and not p.startswith("UNI-"):
                fmi = p
        if codigo and fmi:
            out.append((fmi, codigo))
    return out

def main():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; SAE-scraper/1.0)"})
    results = {}
    for page in range(1, TOTAL_PAGES + 1):
        try:
            resp = session.get(BASE, params={"page": page}, timeout=20)
            resp.raise_for_status()
        except Exception as e:
            print(f"[!] pagina {page}: error {e}")
            continue
        found = parse_page(resp.text)
        for fmi, codigo in found:
            results[fmi] = codigo
        print(f"pagina {page}/{TOTAL_PAGES} -> {len(found)} unidades (acumulado {len(results)})")
        time.sleep(0.4)  # ser amable con el servidor

    # CSV
    with open(OUT_CSV, "w", encoding="utf-8") as f:
        f.write("fmi,codigo_subasta\n")
        for fmi, codigo in sorted(results.items()):
            f.write(f"{fmi},{codigo}\n")

    # SQL
    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("-- Generado por scrape_codigos_subasta.py\n")
        f.write("-- Actualiza codigo_subasta solo para FMIs que son unidad inmobiliaria\n\n")
        for fmi, codigo in sorted(results.items()):
            fmi_esc = fmi.replace("'", "''")
            f.write(
                f"UPDATE inventario_SAE SET codigo_subasta = '{codigo}' "
                f"WHERE fmi = '{fmi_esc}';\n"
            )

    print(f"\nListo: {len(results)} unidades encontradas.")
    print(f"-> {OUT_CSV}")
    print(f"-> {OUT_SQL}  (pegar y ejecutar en el SQL Editor de Supabase)")

if __name__ == "__main__":
    main()
