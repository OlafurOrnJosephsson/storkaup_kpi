#!/usr/bin/env python3
"""
vorumynd.py - Vinnur vorumyndir i 1000x1000 jpg fyrir vef Storkaups.

Notkun:
    python vorumynd.py INN UT [valkostir]
    python vorumynd.py inn ut --size 1000 --margin 0.04 --quality 88

Skref: EXIF-snuningur -> hreinsun jpeg-kekkja -> hvitun bakgrunns ->
snyrting ad voru -> uppskolun (Real-ESRGAN ef uppsett, annars Lanczos) -> skerping -> litrettun ->
midjun a ferkantadan flot -> jpg.

Uppskolun: AI er notud sjalfgefid ef realesrgan-ncnn-vulkan er undir pim/.tools
og varan tharf ad staekka >= --ai-min-scale. Hun er alltaf keyrd a studli sem
modelid styður og hver umferd er sannreynd (sja image_fidelity) - annars
fellur vinnslan a Lanczos og skrifar thad i vinnsluskra.
"""
from __future__ import annotations

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, ImageEnhance, ImageFilter

try:  # HEIC/HEIF stundum fra iPhone
    import pillow_heif  # type: ignore
    pillow_heif.register_heif_opener()
except Exception:
    pass

try:  # AVIF er ekki studd af öllum Pillow-útgáfum
    import pillow_avif  # type: ignore  # Skráir AVIF-opnara í Pillow.
except Exception:
    pillow_avif = None

try:
    import cv2  # type: ignore
except Exception:
    cv2 = None

SUFFIXES = {".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp", ".bmp",
            ".tif", ".tiff", ".gif", ".heic", ".heif", ".avif"}


# ---------------------------------------------------------------- hjalparklasi
@dataclass
class Report:
    rows: list[dict] = field(default_factory=list)

    def add(self, **kw):
        self.rows.append(kw)

    def write(self, path: Path):
        if not self.rows:
            return
        cols = ["skra", "utkoma", "upprunaleg", "vara_px", "skerpa", "stokkun",
                "uppskalari", "bakgrunnur", "gaedi", "athugasemd"]
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, delimiter=";")
            w.writeheader()
            for r in self.rows:
                w.writerow({c: r.get(c, "") for c in cols})


@dataclass
class UpscaleResult:
    image: Image.Image
    factor: float
    method: str
    ai: bool = False
    note: str = ""


# ---------------------------------------------------------------- grunnadgerdir
def load_rgb(path: Path) -> Image.Image:
    """Opnar mynd, rettir EXIF-snuning og flettir gagnsaei a hvitt."""
    if path.suffix.lower() == ".avif" and ".avif" not in Image.registered_extensions():
        raise RuntimeError(
            "AVIF-studning vantar. Keyrdu: python -m pip install pillow-avif-plugin"
        )
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
        flat.alpha_composite(im)
        im = flat.convert("RGB")
    else:
        im = im.convert("RGB")
    return im


def denoise(im: Image.Image, strength: int) -> Image.Image:
    """Mildar jpeg-blokkir og korn. strength 0 = sleppt."""
    if strength <= 0 or cv2 is None:
        return im
    a = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
    a = cv2.fastNlMeansDenoisingColored(a, None, strength, strength, 7, 21)
    return Image.fromarray(cv2.cvtColor(a, cv2.COLOR_BGR2RGB))


def sharpness_score(im: Image.Image) -> float:
    """Skerpumal myndar (breytileiki Laplace-svorunar).

    Lagt tal = oskorp mynd. Thetta er onnur breyta en upplausn: 1000x1000
    mynd sem var stokkud ur thumbnail maelist lag, og engin uppskolun bjargar
    henni - tha vantar betri frummynd fra framleidanda.
    """
    if cv2 is None:
        return -1.0
    gray = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def product_sharpness(src: Image.Image,
                      box: tuple[int, int, int, int] | None) -> float:
    """Skerpa vorunnar sjalfrar, an hvita flatarins umhverfis.

    Maeling a heilli mynd er villandi: hrein, skorp vara a stórum hvitum flot
    hefur lagan breytileika einfaldlega vegna thess ad flesta pixlar eru
    flatir. Thess vegna er maelt innan snyrtikassans, a omedhondladri frummynd
    (denoise myndi lakka maelinguna).
    """
    return sharpness_score(src.crop(box) if box else src)


def bg_stats(a: np.ndarray, band: int = 6) -> tuple[np.ndarray, float]:
    """Skilar medallit ramma myndarinnar og breytileika hans."""
    edges = np.concatenate([
        a[:band].reshape(-1, 3), a[-band:].reshape(-1, 3),
        a[:, :band].reshape(-1, 3), a[:, -band:].reshape(-1, 3),
    ])
    return np.median(edges, axis=0), float(edges.std(axis=0).mean())


def whiten_background(im: Image.Image, tol: int, feather: float) -> tuple[Image.Image, str]:
    """
    Ef bakgrunnurinn er nalaegt einlitum (ljosum) tone: gerir hann hreint hvitan.
    Skilar (mynd, lysing) - lysing er 'hvitadur', 'ljosleitur' eda 'oskilgreindur'.
    """
    a = np.asarray(im).astype(np.float32)
    med, spread = bg_stats(a.astype(np.uint8))
    brightness = float(med.mean())

    if brightness < 150 or spread > 26:
        # Ekki einlitur ljos bakgrunnur (dokkur bakgrunnur eda motif) - latum i frid.
        return im, "oskilgreindur"

    # Fjarlaegd hvers pixils fra bakgrunnslitnum.
    dist = np.linalg.norm(a - med.reshape(1, 1, 3), axis=2)
    # Mjuk grima: 1.0 = bakgrunnur, 0.0 = vara.
    mask = np.clip(1.0 - (dist - tol) / max(feather, 1e-3), 0.0, 1.0)
    mask[dist <= tol] = 1.0

    # Bara pixlar naerri bjartleika bakgrunnsins fa hvitun (ver dokkri voru).
    lum = a.mean(axis=2)
    mask *= np.clip((lum - (brightness - 40)) / 30.0, 0.0, 1.0)

    if cv2 is not None:
        mask = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.2)

    m = mask[:, :, None]
    out = a * (1 - m) + 255.0 * m

    # Mild lyfting a ljosustu tonum vorunnar sjalfrar (rettir gulnun/gratona).
    hi = float(np.percentile(out, 99.5))
    if 200 < hi < 252:
        out = np.clip(out * (255.0 / hi), 0, 255)

    return Image.fromarray(out.astype(np.uint8)), "hvitadur"


def product_bbox(im: Image.Image, thresh: int = 12) -> tuple[int, int, int, int] | None:
    """Finnur ferning utan um voruna med thvi ad bera saman vid bakgrunnslit."""
    a = np.asarray(im).astype(np.float32)
    med, _ = bg_stats(a.astype(np.uint8))
    diff = np.linalg.norm(a - med.reshape(1, 1, 3), axis=2)
    mask = (diff > thresh).astype(np.uint8)

    if cv2 is not None:
        k = max(3, (min(im.size) // 200) | 1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    if mask.sum() < (mask.size * 0.002):  # nanast tomt -> ekki snyrta
        return None
    ys, xs = np.nonzero(mask)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    # Ef "varan" thekur nanast alla myndina er ekkert ad snyrta.
    if (box[2] - box[0]) > im.width * 0.985 and (box[3] - box[1]) > im.height * 0.985:
        return None
    return box


def resize_long_side(im: Image.Image, target: int) -> Image.Image:
    """Skalar lengri kant myndar i target med Lanczos."""
    if max(im.size) == target:
        return im
    if im.width >= im.height:
        new = (target, max(1, round(im.height * target / im.width)))
    else:
        new = (max(1, round(im.width * target / im.height)), target)
    return im.resize(new, Image.LANCZOS)


def lanczos_upscale(im: Image.Image, target: int) -> Image.Image:
    """Hraðvirk og örugg Lanczos-stækkun, í tveimur þrepum þegar þarf."""
    factor = target / max(im.size)
    if abs(factor - 1.0) < 0.01:
        return im
    if factor > 2.0:
        mid = tuple(max(1, round(d * (factor ** 0.5))) for d in im.size)
        im = im.resize(mid, Image.LANCZOS)
    return resize_long_side(im, target)


def find_realesrgan_executable(configured: Path | None) -> Path | None:
    """Finnur valkvætt, staðbundið Real-ESRGAN keyrsluforrit."""
    candidates: list[Path] = []
    if configured is not None:
        candidates.append(configured)
    elif os.environ.get("REALESRGAN_EXE"):
        candidates.append(Path(os.environ["REALESRGAN_EXE"]))
    else:
        tools = Path(__file__).with_name(".tools")
        candidates.append(tools / "realesrgan" / "realesrgan-ncnn-vulkan.exe")
        candidates.extend(tools.glob("**/realesrgan-ncnn-vulkan.exe"))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def model_native_scales(models_dir: Path, model: str) -> list[int]:
    """Skilar theim staekkunarstudlum sem modelid styður i raun.

    Real-ESRGAN-modelin eru thjalfud a fastan studul. `realesrgan-x4plus` er
    eitt 4x-model; se bedid um `-s 2` eda `-s 3` skilar ncnn-utgafan **skemmdri
    mynd** med sjaanlegum flisasamskeytum - hun villar ekki og skilar rettum
    malum, svo ekkert i utkomunni segir fra thvi. Thess vegna er alltaf bedid
    um studul sem modelid styður og Lanczos latid um sidasta bilid.
    """
    scales = [s for s in (2, 3, 4) if (models_dir / f"{model}-x{s}.param").is_file()]
    if not scales and (models_dir / f"{model}.param").is_file():
        scales = [4]
    return scales or [4]


def image_fidelity(candidate: Image.Image, source: Image.Image) -> float:
    """Ber uppskalada mynd vid frummynd sina; 1.0 = sama mynd.

    Skalar tilloguna nidur i upprunastaerd og maelir normaliserada
    kross-samsvorun. Rett uppskolun heldur ~0.99 (AI baetir smaatridum vid en
    breytir ekki myndinni); flisasamsetningarvilla fellur nidur i 0.4-0.6.
    """
    small = candidate.resize(source.size, Image.LANCZOS)
    a = np.asarray(small).astype(np.float32).mean(axis=2)
    b = np.asarray(source).astype(np.float32).mean(axis=2)
    a = a - a.mean()
    b = b - b.mean()
    denom = float(np.sqrt(float((a ** 2).sum()) * float((b ** 2).sum())))
    if denom <= 0.0:
        return 1.0            # alflatur flotur - ekkert ad bera saman
    return float((a * b).sum() / denom)


def realesrgan_pass(
    im: Image.Image, executable: Path, models_dir: Path, model: str,
    scale: int, tile: int, timeout: int,
) -> Image.Image:
    """Keyrir eina umferd af Real-ESRGAN a studli sem modelid styður.

    Forritið er viljandi valkvætt: það er ekki sótt sjálfkrafa og engin mynd
    fer af tölvunni. NCNN-útgáfan skrifar PNG í tímamöppu sem er eytt strax.
    """
    with tempfile.TemporaryDirectory(prefix="vorumynd-realesrgan-") as temp:
        folder = Path(temp)
        source = folder / "input.png"
        result = folder / "output.png"
        im.save(source, "PNG")
        cmd = [
            str(executable), "-i", str(source), "-o", str(result),
            "-n", model, "-s", str(scale), "-f", "png",
        ]
        if models_dir.is_dir():
            cmd.extend(["-m", str(models_dir)])
        if tile:
            cmd.extend(["-t", str(tile)])
        try:
            run = subprocess.run(
                cmd, capture_output=True, text=True, check=False,
                timeout=timeout,
            )
        except OSError as exc:
            raise RuntimeError(f"gat ekki ræst Real-ESRGAN: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"Real-ESRGAN tók lengur en {timeout} sek.") from exc
        if run.returncode != 0 or not result.is_file():
            detail = (run.stderr or run.stdout).strip().replace("\n", " ")
            raise RuntimeError(f"Real-ESRGAN mistókst ({detail[:160]})")
        try:
            with Image.open(result) as enhanced:
                return enhanced.convert("RGB").copy()
        except Exception as exc:
            raise RuntimeError(f"gat ekki lesið Real-ESRGAN niðurstöðu: {exc}") from exc


def realesrgan_upscale(
    im: Image.Image, target: int, executable: Path, model: str,
    tile: int, timeout: int, max_passes: int, min_gain: float,
) -> tuple[Image.Image, int]:
    """Staekkar med Real-ESRGAN og skalar svo nakvaemlega i target.

    Ein 4x-umferd naegir ekki fyrir litlar vorur: 150px vara i 920px flot er
    6.1x, svo eftir eina umferd tekur Lanczos sidustu 1.5x og myndin mjuknar
    aftur. Tha er onnur umferd keyrd og skalad nidur - thad er skarpara en ad
    toga upp med Lanczos.

    Skilar (mynd, fjoldi AI-umferda). Hver umferd er sannreynd; skili ncnn
    skemmdri mynd er villu kastad og kallandi fellur a Lanczos.
    """
    models_dir = executable.parent / "models"
    scales = model_native_scales(models_dir, model)
    out = im
    passes = 0
    while passes < max_passes:
        remaining = target / max(out.size)
        if remaining <= 1.01:
            break
        if passes and remaining < min_gain:
            break             # naegilega naerri - Lanczos klarar sidasta bilid
        scale = next((s for s in scales if s >= remaining), max(scales))
        candidate = realesrgan_pass(
            out, executable, models_dir, model, scale, tile, timeout,
        )
        if max(candidate.size) <= max(out.size):
            raise RuntimeError("Real-ESRGAN skilaði ekki stærri mynd")
        score = image_fidelity(candidate, out)
        if score < 0.97:
            raise RuntimeError(
                f"Real-ESRGAN skilaði skemmdri mynd (samsvörun {score:.2f})"
            )
        out = candidate
        passes += 1
    return resize_long_side(out, target), passes


def upscale(im: Image.Image, target: int, o) -> UpscaleResult:
    """Velur örugga eða AI-studda ofurupplausn eftir stillingum."""
    factor = target / max(im.size)
    use_ai = (
        factor > 1.01 and o.upscaler != "lanczos" and
        (o.upscaler == "realesrgan" or factor >= o.ai_min_scale)
    )
    executable = find_realesrgan_executable(o.realesrgan) if use_ai else None
    if executable is not None:
        try:
            image, passes = realesrgan_upscale(
                im, target, executable, o.ai_model, o.ai_tile,
                o.ai_timeout, o.ai_passes, o.ai_min_scale,
            )
        except RuntimeError as exc:
            return UpscaleResult(
                lanczos_upscale(im, target), factor, "Lanczos", False,
                f"AI-upplausn mistókst - Lanczos notað ({exc})",
            )
        if passes:
            method = "Real-ESRGAN" if passes == 1 else f"Real-ESRGAN x{passes}"
            return UpscaleResult(image, factor, method, True)
    note = ""
    if use_ai and executable is None:
        note = "Real-ESRGAN fannst ekki - Lanczos notað"
    return UpscaleResult(lanczos_upscale(im, target), factor, "Lanczos", False, note)


def sharpen(im: Image.Image, factor: float, strength: float,
            ai: bool = False) -> Image.Image:
    """Skerping stillt af uppskolunarstuðli - meira stokk, meiri skerping.

    AI-uppskolun skilar thegar skarpri mynd. Sama skerping og eftir Lanczos
    (allt ad 150% vid radius 1.6) gefur tha ljosa kanta um voruna og hardan,
    "unninn" flot, svo hun er dempud thegar AI var notad.
    """
    if strength <= 0:
        return im
    if ai:
        amount = int(np.clip(40 + 10 * max(factor - 1.0, 0.0), 40, 70) * strength)
        radius = 0.7
    else:
        amount = int(np.clip(55 + 45 * max(factor - 1.0, 0.0), 55, 150) * strength)
        radius = float(np.clip(0.8 + 0.35 * max(factor - 1.0, 0.0), 0.8, 1.6))
    return im.filter(ImageFilter.UnsharpMask(radius=radius, percent=amount, threshold=3))


def color_fix(im: Image.Image, contrast: float, saturation: float) -> Image.Image:
    if contrast != 1.0:
        im = ImageEnhance.Contrast(im).enhance(contrast)
    if saturation != 1.0:
        im = ImageEnhance.Color(im).enhance(saturation)
    return im


def square_canvas(im: Image.Image, size: int, margin: float, bg: tuple[int, int, int]):
    inner = max(1, int(round(size * (1 - 2 * margin))))
    im = ImageOps.contain(im, (inner, inner), Image.LANCZOS)
    canvas = Image.new("RGB", (size, size), bg)
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


def slugify(stem: str) -> str:
    table = str.maketrans({
        "á": "a", "ð": "d", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "ý": "y", "þ": "th", "æ": "ae", "ö": "o", " ": "-", "_": "-",
    })
    s = stem.lower().translate(table)
    s = "".join(c for c in s if c.isalnum() or c in "-.")
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-.") or "mynd"


# ---------------------------------------------------------------- ein mynd
def process(path: Path, out_dir: Path, o, report: Report) -> Path | None:
    try:
        src = load_rgb(path)
    except Exception as exc:
        report.add(skra=path.name, utkoma="VILLA", athugasemd=str(exc)[:120])
        return None

    orig = f"{src.width}x{src.height}"
    notes: list[str] = []

    content_target = int(round(o.size * (1 - 2 * o.margin)))
    small = max(src.size) < content_target

    im = denoise(src, o.denoise if small else max(0, o.denoise - 2))

    bg_desc = "haldid"
    if o.bg == "white":
        im, bg_desc = whiten_background(im, o.tol, o.feather)
        if bg_desc == "oskilgreindur":
            notes.append("bakgrunnur ekki einlitur - hvitun sleppt")

    box = None
    if o.trim:
        box = product_bbox(im)
        if box:
            pad = int(round(min(im.size) * 0.01))
            box = (max(0, box[0] - pad), max(0, box[1] - pad),
                   min(im.width, box[2] + pad), min(im.height, box[3] + pad))
            im = im.crop(box)
    prod_px = f"{im.width}x{im.height}"
    # Snyrting breytir ekki malum fyrri skrefa, svo box gildir i src-hnitum.
    sharp = product_sharpness(src, box)

    upscaled = upscale(im, content_target, o)
    im = upscaled.image
    factor = upscaled.factor
    if upscaled.note:
        notes.append(upscaled.note)
    im = sharpen(im, factor, o.sharpen, upscaled.ai)
    im = color_fix(im, o.contrast, o.saturation)
    im = square_canvas(im, o.size, o.margin, (255, 255, 255) if o.bg == "white" else (255, 255, 255))

    # Gaedamat: hversu mikid var toga
    if factor <= 1.0:
        grade = "gott (minnkad/oskert)"
    elif upscaled.ai:
        grade = ("AI-baett - skodadu texta handvirkt" if factor < 4.0
                 else "AI-baett en mikid togad - skodadu handvirkt")
    elif factor < 1.6:
        grade = "gott"
    elif factor < 2.5:
        grade = "vidunandi"
    elif factor < 4.0:
        grade = "veikt - skodadu handvirkt"
    else:
        grade = "ONOG - naestu betri mynd fra framleidanda"

    # Oskorp frummynd er annad vandamal en litil frummynd: uppskolun - hvorki
    # Lanczos ne AI - endurheimtir ekki smaatridi sem voru aldrei i skjalinu.
    # Threskuldurinn er varfaerinn: einkennalaus vara (hvitur svampur maelist
    # 78) hefur lagt gildi af edlilegum astaedum, svo thetta er visbending sem
    # tharf mannsauga - ekki dómur um skjalid.
    if 0 <= sharp < 80:
        notes.append(f"lag skerpa a voru ({sharp:.0f}) - athugadu hvort betri frummynd se til")

    stem = slugify(path.stem) if o.slug else path.stem
    out = out_dir / f"{stem}.jpg"
    n = 2
    while out.exists() and not o.overwrite:
        out = out_dir / f"{stem}-{n}.jpg"
        n += 1

    # Skrifum fyrst i timaskra i somu mottu svo hrun skilji ekki eftir
    # halfunna jpg. replace() yfirskrifar einungis þegar --overwrite er valt.
    with tempfile.NamedTemporaryFile(
        prefix=f".{out.stem}-", suffix=".jpg", dir=out.parent, delete=False,
    ) as temp_file:
        temp_out = Path(temp_file.name)
    try:
        im.save(temp_out, "JPEG", quality=o.quality, subsampling=0,
                optimize=True, progressive=True)
        temp_out.replace(out)
    finally:
        temp_out.unlink(missing_ok=True)

    report.add(skra=path.name, utkoma=out.name, upprunaleg=orig, vara_px=prod_px,
               skerpa=("" if sharp < 0 else f"{sharp:.0f}"),
               stokkun=f"{factor:.2f}x", uppskalari=upscaled.method,
               bakgrunnur=bg_desc, gaedi=grade,
               athugasemd="; ".join(notes))
    return out


# ---------------------------------------------------------------- CLI
def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Vorumyndir i 1000x1000 jpg")
    p.add_argument("inn", type=Path, help="mappa eda ein skra")
    p.add_argument("ut", type=Path, help="utmappa")
    p.add_argument("--size", type=int, default=1000)
    p.add_argument("--margin", type=float, default=0.04, help="hlutfall spassiu (0.04 = 4%%)")
    p.add_argument("--quality", type=int, default=88)
    p.add_argument("--bg", choices=["white", "keep"], default="white")
    p.add_argument("--tol", type=int, default=18, help="thol fyrir bakgrunnslit")
    p.add_argument("--feather", type=float, default=14.0, help="mjukt jadar bakgrunnsgrimu")
    p.add_argument("--denoise", type=int, default=4, help="0 = sleppt, 3-8 fyrir lelegar jpg")
    p.add_argument("--sharpen", type=float, default=1.0, help="0 = sleppt, 1 = sjalfgefid")
    p.add_argument("--contrast", type=float, default=1.04)
    p.add_argument("--saturation", type=float, default=1.05)
    p.add_argument("--upscaler", choices=["auto", "lanczos", "realesrgan"],
                   default="auto",
                   help="auto notar AI thegar hun er uppsett og stokkun >= --ai-min-scale; "
                        "lanczos slaer AI af")
    p.add_argument("--realesrgan", type=Path, metavar="EXE",
                   help="slod i realesrgan-ncnn-vulkan.exe (annars .tools eða REALESRGAN_EXE)")
    p.add_argument("--ai-model", default="realesrgan-x4plus", metavar="MODEL",
                   help="Real-ESRGAN model i models/ (sjalfgefid: realesrgan-x4plus)")
    p.add_argument("--ai-min-scale", type=float, default=1.5, metavar="X",
                   help="auto notar AI þegar stækkun er minnst X (sjalfgefid 1.5)")
    p.add_argument("--ai-tile", type=int, default=0, metavar="PX",
                   help="Real-ESRGAN tile-staerd; 0 velur sjaelfvirkt")
    p.add_argument("--ai-timeout", type=int, default=300, metavar="SEK",
                   help="haedsti keyrslutimi a hverja AI-umferd")
    p.add_argument("--ai-passes", type=int, default=2, metavar="N",
                   help="haedsti fjoldi AI-umferda; 2 skerpir litlar vorur sem "
                        "ein 4x-umferd naer ekki i endanlega staerd (sjalfgefid 2)")
    p.add_argument("--no-trim", dest="trim", action="store_false")
    p.add_argument("--slug", action="store_true", help="vefvaen skraarnofn (an islenskra stafa)")
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--flytja", nargs="?", const="unnid", default=None, metavar="MAPPA",
                   help="flytja unnar frummyndir i geymslu (sjalfgefid: ../unnid/AAAA-MM)")
    o = p.parse_args(argv)

    if not o.inn.exists() or not (o.inn.is_file() or o.inn.is_dir()):
        p.error(f"inntak finnst ekki eda er ekki skra/mappa: {o.inn}")
    if not 64 <= o.size <= 10000:
        p.error("--size verdur ad vera a bilinu 64-10000")
    if not 0 <= o.margin < 0.5:
        p.error("--margin verdur ad vera >= 0 og minni en 0.5")
    if not 1 <= o.quality <= 100:
        p.error("--quality verdur ad vera a bilinu 1-100")
    if o.tol < 0 or o.feather < 0 or o.denoise < 0:
        p.error("--tol, --feather og --denoise mega ekki vera neikvaed")
    if o.sharpen < 0 or o.contrast <= 0 or o.saturation < 0:
        p.error("--sharpen og --saturation mega ekki vera neikvaed; --contrast verdur ad vera > 0")
    if o.ai_min_scale < 1 or o.ai_tile < 0 or o.ai_timeout < 1:
        p.error("--ai-min-scale verdur ad vera >= 1; --ai-tile >= 0; --ai-timeout >= 1")
    if o.ai_passes < 1:
        p.error("--ai-passes verdur ad vera >= 1")

    source_root = o.inn.resolve()
    output_root = o.ut.resolve()
    if o.inn.is_dir() and (output_root == source_root or output_root.is_relative_to(source_root)):
        p.error("utmappa ma ekki vera inni i inntaksmoppu (tha eru utmyndir unnar aftur naest)")
    if o.inn.is_file() and o.overwrite and output_root == source_root.parent:
        p.error("--overwrite ma ekki nota thegar utmappa er sama mappa og frummynd")

    files = ([o.inn] if o.inn.is_file()
             else sorted(f for f in o.inn.rglob("*")
                         if f.is_file() and f.suffix.lower() in SUFFIXES))
    if not files:
        print(f"Engar myndir i {o.inn}", file=sys.stderr)
        return 1

    o.ut.mkdir(parents=True, exist_ok=True)

    archive = None
    if o.flytja is not None:
        base = Path(o.flytja)
        if not base.is_absolute() and base.parts[:1] != ("..",):
            base = o.inn.parent / base
        archive = base / date.today().strftime("%Y-%m")
        archive.mkdir(parents=True, exist_ok=True)

    report = Report()
    ok, moved = 0, 0
    for f in files:
        r = process(f, o.ut, o, report)
        if not r:
            print(f"VILLA  {f.name}")
            continue
        ok += 1
        line = f"OK  {f.name} -> {r.name}"
        if archive is not None:
            dest = archive / f.name
            n = 2
            while dest.exists():
                dest = archive / f"{f.stem}-{n}{f.suffix}"
                n += 1
            try:
                f.replace(dest)          # sama diskur
            except OSError:
                shutil.move(str(f), dest)
            moved += 1
            line += f"   (frummynd -> {archive.name}/)"
        print(line)

    report.write(o.ut / "vinnsluskra.csv")
    print(f"\n{ok}/{len(files)} myndir unnar -> {o.ut}")
    if archive is not None:
        print(f"{moved} frummyndir fluttar -> {archive}")
    print(f"Skra: {o.ut / 'vinnsluskra.csv'}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
