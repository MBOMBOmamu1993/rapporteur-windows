# Tuiles du paquet Microsoft Store (build/appx), tirées de icon-mac.png.
#
# Sans dossier build/appx, electron-builder met ses images d'EXEMPLE dans le
# paquet, et la certification les refuse (10.1.1.11 « On Device Tiles », 23/09/2026).
# Ici : le micro orange seul, sur fond transparent, pour les tuiles (Windows les
# pose sur appx.backgroundColor #141413) ; l'icône entière, carré arrondi compris,
# pour la barre des tâches (Square44x44Logo) et le Store (StoreLogo).
#
# Relancer après tout changement d'icône : python tuiles-store.py
from pathlib import Path
from PIL import Image

ICI = Path(__file__).parent
SORTIE = ICI / "build" / "appx"
SORTIE.mkdir(parents=True, exist_ok=True)
for f in SORTIE.glob("*.png"):
    f.unlink()

icone = Image.open(ICI / "icon-mac.png").convert("RGBA")
FOND = (20, 20, 19)
ORANGE = (204, 120, 92)

# Le micro seul : l'alpha se lit sur la distance au fond sombre, ce qui garde
# l'anticrénelage des bords sans halo noir.
x0, y0, x1, y1 = 300, 245, 724, 808
zone = icone.crop((x0, y0, x1, y1))
micro = Image.new("RGBA", zone.size)
src, dst = zone.load(), micro.load()
for y in range(zone.size[1]):
    for x in range(zone.size[0]):
        r, g, b, a = src[x, y]
        t = max(0.0, min(1.0, (r - FOND[0]) / (ORANGE[0] - FOND[0])))
        dst[x, y] = (*ORANGE, round(255 * t * a / 255))
micro = micro.crop(micro.getbbox())


def tuile(l, h, part):
    """Le micro centré sur une tuile l × h, à `part` de la hauteur."""
    img = Image.new("RGBA", (l, h), (0, 0, 0, 0))
    mh = round(h * part)
    mw = round(micro.size[0] * mh / micro.size[1])
    m = micro.resize((mw, mh), Image.LANCZOS)
    img.alpha_composite(m, ((l - mw) // 2, (h - mh) // 2))
    return img


def icone_entiere(c):
    return icone.resize((c, c), Image.LANCZOS)


ECHELLES = (100, 125, 150, 200, 400)
TUILES = {
    # nom : (largeur, hauteur de base, part de la hauteur occupée par le micro)
    "Square150x150Logo": (150, 150, 0.56),
    "Wide310x150Logo": (310, 150, 0.56),
    "LargeTile": (310, 310, 0.50),
    "SmallTile": (71, 71, 0.62),
}
for nom, (l, h, part) in TUILES.items():
    for e in ECHELLES:
        tuile(round(l * e / 100), round(h * e / 100), part).save(SORTIE / f"{nom}.scale-{e}.png")

for e in ECHELLES:
    icone_entiere(round(50 * e / 100)).save(SORTIE / f"StoreLogo.scale-{e}.png")
    icone_entiere(round(44 * e / 100)).save(SORTIE / f"Square44x44Logo.scale-{e}.png")
for t in (16, 24, 32, 48, 256):
    icone_entiere(t).save(SORTIE / f"Square44x44Logo.targetsize-{t}.png")
    icone_entiere(t).save(SORTIE / f"Square44x44Logo.targetsize-{t}_altform-unplated.png")

print(len(list(SORTIE.glob("*.png"))), "images dans", SORTIE)
