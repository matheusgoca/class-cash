"""Gera os PNGs/ICO da marca a partir do símbolo (ícone School do lucide num quadrado teal).

Sem dependências: usa o Edge (headless) para rasterizar e monta o .ico na mão (PNG embutido).
Uso (Windows, a partir da raiz do repo):  python scripts/gen-brand-assets.py
Saídas: public/favicon.ico, public/apple-touch-icon.png, public/email/logo-64.png, public/og-image.png
"""
import os
import struct
import subprocess
import sys
import tempfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = os.environ.get("EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
TEAL = "#186E64"

# Paths exatos do lucide-react instalado (icons/school.js), viewBox 24, traço 2.
SCHOOL = (
    '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/>'
    '<path d="m18 10 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7.382a1 1 0 0 1 .553-.894L6 10"/>'
    '<path d="M18 5v17"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="M6 5v17"/>'
    '<circle cx="12" cy="9" r="2"/>'
)


def symbol(size, radius_ratio=0.25, bg=TEAL, x=0, y=0, ring=False):
    """Quadrado `size` com o ícone em metade da largura, centralizado (32 px dentro de 64)."""
    s = size / 2 / 24  # o ícone ocupa 50% do quadrado
    off = size / 4
    edge = ' stroke="#ffffff" stroke-opacity="0.35" stroke-width="3"' if ring else ''  # contorno só onde o fundo é teal
    rect = f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size * radius_ratio}" fill="{bg}"{edge}/>'
    g = (f'<g transform="translate({x + off} {y + off}) scale({s})" fill="none" stroke="#ffffff" '
         f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{SCHOOL}</g>')
    return rect + g


def shot(svg_body, w, h, out):
    html = (f'<!doctype html><html><body style="margin:0;background:transparent">'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'style="display:block" font-family="Arial, Helvetica, sans-serif">{svg_body}</svg></body></html>')
    with tempfile.TemporaryDirectory() as d:
        page = os.path.join(d, "p.html")
        open(page, "w", encoding="utf-8").write(html)
        subprocess.run([EDGE, "--headless", "--disable-gpu", "--hide-scrollbars",
                        "--default-background-color=00000000", f"--window-size={w},{h}",
                        f"--screenshot={out}", "file:///" + page.replace("\\", "/")],
                       capture_output=True, timeout=90, check=True)
    dim = struct.unpack(">II", open(out, "rb").read()[16:24])
    if dim != (w, h):
        sys.exit(f"{out}: saiu {dim}, esperado {(w, h)}")


def write_ico(pngs, out):
    head = struct.pack("<HHH", 0, 1, len(pngs))
    entries, blobs, offset = b"", b"", 6 + 16 * len(pngs)
    for size, path in pngs:
        data = open(path, "rb").read()
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    open(out, "wb").write(head + entries + blobs)


def main():
    pub = os.path.join(ROOT, "public")
    os.makedirs(os.path.join(pub, "email"), exist_ok=True)
    shot(symbol(64, 0.25), 64, 64, os.path.join(pub, "email", "logo-64.png"))
    # apple-touch-icon: o iOS aplica a própria máscara, então sem cantos arredondados (quadrado cheio).
    shot(symbol(180, 0), 180, 180, os.path.join(pub, "apple-touch-icon.png"))
    with tempfile.TemporaryDirectory() as d:
        parts = []
        for n in (16, 32, 48):
            p = os.path.join(d, f"{n}.png")
            shot(symbol(n, 0.25), n, n, p)
            parts.append((n, p))
        write_ico(parts, os.path.join(pub, "favicon.ico"))
    # og-image 1200x630: gradiente atual, símbolo, nome e subtítulo.
    og = (
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">'
        '<stop offset="0%" stop-color="#0F4F48"/><stop offset="100%" stop-color="#1E8A7C"/></linearGradient></defs>'
        '<rect width="1200" height="630" fill="url(#bg)"/>'
        + symbol(152, 0.25, bg="#186E64", x=524, y=150, ring=True)
        + '<text x="600" y="380" font-size="72" font-weight="800" text-anchor="middle" fill="#ffffff" letter-spacing="-1">Class Cash</text>'
        '<text x="600" y="440" font-size="30" font-weight="400" text-anchor="middle" fill="#ffffff" fill-opacity="0.8">'
        'Gestão financeira escolar simplificada</text>'
    )
    shot(og, 1200, 630, os.path.join(pub, "og-image.png"))
    # og-image.svg: mesma arte, para manter a fonte editável junto do PNG.
    open(os.path.join(pub, "og-image.svg"), "w", encoding="utf-8").write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" '
        'font-family="Arial, Helvetica, sans-serif">' + og + '</svg>\n')
    for f in ("favicon.ico", "apple-touch-icon.png", "email/logo-64.png", "og-image.png", "og-image.svg"):
        print(f, os.path.getsize(os.path.join(pub, f)), "bytes")


if __name__ == "__main__":
    main()
